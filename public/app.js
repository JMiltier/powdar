import { createSnowMap, CREDITS } from './map.js?v=__V__';

const DATA_URL = 'data.json';
const STORE = {
  data: 'cs:data', favs: 'cs:favs', metric: 'cs:metric', snowDepth: 'cs:snowCover', openOnly: 'cs:openOnly', panel: 'cs:panel',
};
const RELOAD_AFTER_MS = 10 * 60_000;
const STALE_AFTER_MS = 3 * 3_600_000;
const WIDE = window.matchMedia('(min-width: 900px)');

const SURFACE = {
  P: 'Powder', PDR: 'Powder', PP: 'Packed powder', 'P/PP': 'Powder & packed powder', MG: 'Machine groomed',
  MMS: 'Machine-made snow', HP: 'Hard pack', SC: 'Spring conditions', SPR: 'Spring conditions', WP: 'Wet packed',
  VC: 'Variable', LG: 'Loose granular', LSGR: 'Loose granular', FG: 'Frozen granular', WG: 'Wet granular', ICY: 'Icy',
};
const SOURCE_NAMES = {
  nws: 'National Weather Service', ecmwf_ifs025: 'European ECMWF', gfs_seamless: 'American GFS/HRRR', gem_seamless: 'Canadian GEM', icon_seamless: 'German ICON',
};

// What the map and list show. `steps` are the upper bounds of each color level.
const METRICS = {
  // The resort's own report when it has one, otherwise the weather models' estimate.
  new24: {
    kind: 'snow', get: (r) => r.report?.new24 ?? r.forecast?.past24, est: (r) => r.report?.new24 == null && r.forecast?.past24 != null,
    steps: [1, 3, 6, 12], top: 'Most new snow, last 24 hrs',
  },
  next72: { kind: 'snow', get: (r) => r.forecast?.next72, range: (r) => r.forecast?.next72Range, steps: [1, 3, 6, 12], top: 'Most snow, next 3 days' },
  next7: { kind: 'snow', get: (r) => r.forecast?.next7, range: (r) => r.forecast?.next7Range, steps: [1, 3, 6, 12], top: 'Most snow, next 7 days' },
  // Snowpack at the nearest SNOTEL station as a % of normal for the date.
  season: { kind: 'season', get: (r) => station(r)?.pct ?? null },
  dates: { kind: 'dates' },
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: fine */ }
};

const state = {
  data: null,
  loadedAt: 0,
  favs: new Set(read(STORE.favs, [])),
  metric: METRICS[read(STORE.metric, 'new24')] ? read(STORE.metric, 'new24') : 'new24',
  openOnly: read(STORE.openOnly, false),
  snowDepth: read(STORE.snowDepth, true), // snow cover starts on
  selected: null,
  sheet: 'peek',
  pastSeason: null, // a past season like '2024-25' to show in the season chart, or null for this one
  panelOpen: read(STORE.panel, true), // wide screens: the resort list on the left
  map: null,
};

// ---------- formatting ----------

// 0 → 0″, a dusting → <1″, otherwise whole inches.
function inches(v) {
  if (v == null) return '–';
  if (v === 0) return '0″';
  if (v < 1) return '<1″';
  return `${Math.round(v)}″`;
}
// "2–5″", or nothing when the forecasts agree (or it's all under an inch).
function rangeText(range) {
  if (!range) return '';
  const [lo, hi] = range.map(Math.round);
  return hi >= 1 && hi !== lo ? `${lo}–${hi}″` : '';
}
const monthDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const weekday = (ymd, today) => (ymd === today ? 'Today' : new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }));

// "10:42 AM" in Colorado time.
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' });

function timeAgo(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} days ago`;
}

function level(value, steps) {
  if (value == null) return 'none';
  if (value === 0) return 0;
  const i = steps.findIndex((s) => value < s);
  return i === -1 ? steps.length + 1 : i + 1;
}

// "Season Oct 28 – May 10", or as much of it as we know.
function seasonText(r, today) {
  const { open, close, when, planned } = r.dates ?? {};
  if (open && close) return `Season ${monthDay(open)} – ${monthDay(close)}`;
  if (open) return `${open > today ? 'Opens' : 'Opened'} ${when ?? monthDay(open)}${planned ? ' (announced)' : ''} · closing day TBA`;
  if (close) return `Opening day TBA · closes ${monthDay(close)}`;
  return '';
}

// One resort's value for the current metric, as both the map bubble and the list show it.
function valueFor(r, metricKey = state.metric) {
  const m = METRICS[metricKey];
  if (m.kind === 'dates') {
    const { state: s, date } = r.status;
    const close = r.dates?.close;
    const daysOut = date ? (Date.parse(date) - Date.parse(state.data.today)) / 864e5 : 0;
    if (s === 'open') return { text: r.status.pct != null ? `${r.status.pct}% open` : 'Open', level: 'open', sort: 1e5 + (r.status.pct ?? 0) };
    if (s === 'likely') return { text: 'Probably', level: 'likely', sort: 9e4 };
    if (s === 'soon') return { text: r.dates?.when ?? monthDay(date), level: 'soon', sort: 8e4 - daysOut };
    if (s === 'late') return { text: 'Delayed', level: 'late', sort: 7e4 };
    return { text: s === 'done' ? 'Closed' : 'TBA', level: 'tba', sort: 0 };
  }
  if (m.kind === 'season') {
    const pct = m.get(r);
    return { text: pct == null ? '–' : `${pct}%`, level: seasonLevel(pct), sort: pct ?? -1 };
  }
  const v = m.get(r) ?? null;
  return {
    text: v == null ? '–' : m.kind === 'base' ? `${Math.round(v)}″` : inches(v),
    sub: m.est?.(r) ? (v >= 0.5 ? 'est.' : '') : m.range ? rangeText(m.range(r)) : '',
    level: level(v, m.steps),
    sort: v ?? -1,
  };
}

const station = (r) => (r.station ? state.data.snowpack?.[r.station] : null);

// Color band for "% of normal": well below → below → normal → above → well above.
function seasonLevel(pct) {
  if (pct == null) return 'none';
  if (pct < 70) return 'pk-low';
  if (pct < 90) return 'pk-below';
  if (pct <= 110) return 'pk-normal';
  if (pct <= 130) return 'pk-above';
  return 'pk-high';
}

// A plain-words sky icon from the Weather Service's short forecast.
function skyIcon(text = '') {
  const t = text.toLowerCase();
  if (/thunder/.test(t)) return '⛈️';
  if (/snow|flurr|blizzard/.test(t)) return '🌨️';
  if (/rain|drizzle|showers/.test(t)) return '🌧️';
  if (/fog|haze|smoke/.test(t)) return '🌫️';
  if (/partly|mostly sunny|mostly clear/.test(t)) return '⛅';
  if (/sunny|clear/.test(t)) return '☀️';
  if (/cloud|overcast/.test(t)) return '☁️';
  if (/wind|breezy/.test(t)) return '💨';
  return '';
}

const isOpenish = (r) => r.status.state === 'open' || r.status.state === 'likely';

// Pinned first, then by the current metric.
function ordered() {
  return state.data.resorts
    .filter((r) => !state.openOnly || isOpenish(r))
    .map((r) => ({ r, v: valueFor(r) }))
    .sort((a, b) => state.favs.has(b.r.id) - state.favs.has(a.r.id) || b.v.sort - a.v.sort || a.r.name.localeCompare(b.r.name));
}

// ---------- rendering ----------

function renderHeadline() {
  const data = state.data;
  const m = METRICS[state.metric];
  let text;
  if (m.kind === 'dates') {
    const open = data.resorts.filter((r) => r.status.state === 'open').length;
    const next = data.resorts.filter((r) => r.status.state === 'soon').sort((a, b) => a.status.date.localeCompare(b.status.date))[0];
    text = `<strong>${open} open</strong>${next ? ` · next: <strong>${esc(next.name)}</strong> ${esc(next.status.label.replace('Opens ', ''))}` : ''}`;
  } else {
    const best = [...data.resorts].sort((a, b) => (m.get(b) ?? -1) - (m.get(a) ?? -1))[0];
    const v = best && m.get(best);
    if (m.kind === 'season') {
      const pcts = data.resorts.map((r) => m.get(r)).filter((p) => p != null);
      const above = pcts.filter((p) => p > 110).length;
      const below = pcts.filter((p) => p < 90).length;
      text = pcts.length
        ? `<strong>${above} above normal</strong> · ${below} below · top: <strong>${esc(best.name)} ${v}%</strong>`
        : 'Too early in the season to compare snowpack with normal';
    } else {
      const quiet = { new24: 'No new snow in the last 24 hrs', next72: 'No real snow in the next 3 days', next7: 'No real snow in the next 7 days' };
      text = v >= 1 ? `${m.top}: <strong>${esc(best.name)} ${inches(v)}</strong>` : quiet[state.metric];
    }
  }
  $('#headline').innerHTML = text;
}

// "Open · 3 of 24 lifts · 2% of runs", "Opens Fri, Nov 20", …
function rowSub(r) {
  const s = r.status;
  if (s.state !== 'open') return s.label;
  const lifts = r.report?.lifts;
  return ['Open', lifts?.total ? `${lifts.open} of ${lifts.total} lifts` : null, s.pct != null ? `${s.pct}% of runs` : null].filter(Boolean).join(' · ');
}

function renderList() {
  const rows = ordered().map(({ r, v }) => `
    <button type="button" class="row" data-open="${esc(r.id)}">
      <span class="dot dot-${esc(r.status.state)}" aria-hidden="true"></span>
      <span class="row-main">
        <span class="row-name">${state.favs.has(r.id) ? '<span class="fav">★</span> ' : ''}${esc(r.name)}</span>
        <span class="row-sub">${esc(rowSub(r))}</span>
      </span>
      <span class="val lvl-${v.level}">${esc(v.text)}${v.sub ? `<small>${esc(v.sub)}</small>` : ''}</span>
    </button>`).join('');
  $('#list').innerHTML = rows || '<p class="empty">Nothing open yet. Turn off “Open now” to see opening days.</p>';
}

function renderDetail(r) {
  const today = state.data.today;
  const f = r.forecast;
  const rep = r.report;
  const fav = state.favs.has(r.id);
  const scale = Math.max(4, ...(f?.days.map((d) => d.snow) ?? [0]));
  const stat = (num, label, sub = '') => `<div class="stat"><b>${num}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;

  const bars = f ? `
    <div class="days">${f.days.map((d) => `
      <div class="day">
        <span class="day-snow">${d.snow >= 1 ? inches(d.snow) : d.snow > 0 ? '<1″' : ''}</span>
        <span class="day-bar" style="height:${d.snow > 0 ? Math.max(4, Math.round((d.snow / scale) * 44)) : 0}px"></span>
        <span class="day-name">${weekday(d.date, today)}</span>
        <span class="day-sky" title="${esc(d.sky ?? d.night ?? '')}">${skyIcon(d.sky ?? d.night) || '&nbsp;'}</span>
        <span class="day-temp">${d.hi ?? '–'}°<i>${d.lo ?? '–'}°</i></span>
      </div>`).join('')}
    </div>
    ${f.week2 ? `<p class="week2"><b>Days 8–14:</b> about ${inches(f.week2.mid)} more${rangeText(f.week2.range) ? ` (${rangeText(f.week2.range)})` : ''} <span class="muted">· further out, less certain</span></p>` : ''}` : '<p class="muted">Forecast unavailable right now.</p>';

  // Plain-words weather for the next three days.
  const weather = f?.days.filter((d) => d.sky || d.night).slice(0, 3).map((d) => `
    <li><span class="w-day">${weekday(d.date, today)}</span>
      <span class="w-text">${skyIcon(d.sky ?? d.night)} ${esc(d.sky ?? `Tonight: ${d.night}`)}${d.pop >= 20 ? ` · ${d.pop}% chance` : ''}${d.wind ? ` · wind ${esc(d.wind.replace(' to ', '–'))}` : ''}</span></li>`).join('') ?? '';

  // How much of the mountain is open, as simple bars.
  const meter = (label, open, total) => (total ? `
    <div class="meter"><span>${label}</span><b>${open} of ${total}</b>
      <i style="--pct:${Math.max(open ? 2 : 0, Math.round((open / total) * 100))}%"></i></div>` : '');
  const report = rep ? `
    <h3 class="section">Open terrain</h3>
    ${meter('Lifts', rep.lifts?.open ?? 0, rep.lifts?.total)}
    ${meter('Runs', rep.trails?.open ?? 0, rep.trails?.total)}
    <ul class="report">
      ${rep.depth != null ? `<li><span>Base depth</span><b>${rep.depth}″</b></li>` : ''}
      <li><span>Reported new snow</span><b>${inches(rep.new24)} 24 hr · ${inches(rep.new48)} 48 hr</b></li>
      ${rep.surface ? `<li><span>Surface</span><b>${esc(SURFACE[rep.surface] ?? rep.surface)}</b></li>` : ''}
      ${rep.updated ? `<li class="muted"><span>Resort report</span><b>${esc(timeAgo(rep.updated))}</b></li>` : ''}
    </ul>
    ${rep.message ? `<p class="message">“${esc(rep.message.length > 260 ? `${rep.message.slice(0, 257).trimEnd()}…` : rep.message)}”</p>` : ''}` : '';
  // Live lift-by-lift status (when the resort publishes it): open, on hold and scheduled first.
  const L = r.lifts;
  const LIFT_WORDS = { open: 'Open', hold: 'On hold', scheduled: 'Scheduled', closed: 'Closed' };
  const liftRow = (l) => `<li class="lift lift-${esc(l.status)}"><i aria-hidden="true"></i><span>${esc(l.name)}</span>
    <small>${LIFT_WORDS[l.status]}${l.hours && l.status !== 'closed' ? ` · ${esc(l.hours)}` : ''}</small></li>`;
  const activeLifts = L ? L.lifts.filter((l) => l.status !== 'closed') : [];
  const closedLifts = L ? L.lifts.filter((l) => l.status === 'closed') : [];
  const recent = (iso) => iso && Date.now() - Date.parse(iso) < 2 * 864e5;
  const liftSection = L ? `
    <h3 class="section">Lifts <span class="section-count">${L.open} of ${L.total} open${L.hold ? ` · ${L.hold} on hold` : ''}${L.scheduled ? ` · ${L.scheduled} scheduled` : ''}</span></h3>
    ${activeLifts.length ? `<ul class="lifts">${activeLifts.map(liftRow).join('')}</ul>` : ''}
    ${closedLifts.length ? `<details class="more-lifts"><summary>${activeLifts.length ? `${closedLifts.length} closed` : `All ${closedLifts.length} lifts closed`}</summary>
      <ul class="lifts">${closedLifts.map(liftRow).join('')}</ul></details>` : ''}
    <p class="source">Live from ${sourceLink(L.page, `${r.name}’s lift status`)}, checked ${esc(clock(L.checked))}${recent(L.updated) ? `; the resort last changed it ${esc(timeAgo(L.updated))}` : ''}.</p>` : '';

  const new24 = rep?.new24 ?? f?.past24;
  const new24Label = rep?.new24 != null ? 'last 24 hrs' : f?.past24 != null ? 'last 24 hrs (est.)' : 'last 24 hrs';

  const sources = f?.sources?.map((s) => SOURCE_NAMES[s] ?? s) ?? [];
  $('#detail').innerHTML = `
    <div class="detail-head">
      <button type="button" class="icon" data-back aria-label="Back to all resorts">‹</button>
      <div class="detail-title">
        <h2><a href="${esc(r.url)}" target="_blank" rel="noopener" title="Official ${esc(r.name)} website">${esc(r.name)}<span class="ext" aria-hidden="true">↗</span></a></h2>
        <p><span class="pill pill-${esc(r.status.state)}">${esc(r.status.label)}</span> ${esc(seasonText(r, today))}</p>
      </div>
      <button type="button" class="icon star" data-fav="${esc(r.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Unpin' : 'Pin'} ${esc(r.name)}">${fav ? '★' : '☆'}</button>
    </div>
    ${r.status.detail && r.status.state !== 'open' ? `<p class="muted small">${esc(r.status.detail)}</p>` : ''}
    <div class="stats">
      ${stat(inches(new24), new24Label)}
      ${stat(inches(f?.next72), 'next 3 days', rangeText(f?.next72Range))}
      ${stat(inches(f?.next7), 'next 7 days', rangeText(f?.next7Range))}
    </div>
    ${bars}
    ${f ? `<p class="source">Snow forecast: the middle of ${sources.length > 1 ? `${sources.length} forecasts (${esc(sources.join(', '))})` : 'the National Weather Service forecast'}${sources.length > 1 ? `, via ${sourceLink('https://www.weather.gov', 'NWS')} and ${sourceLink('https://open-meteo.com', 'Open-Meteo')}` : ''}. Small numbers are the likely range.${state.data.sources.modelsReused ? ` Model forecast from ${esc(timeAgo(state.data.sources.modelsAt))}.` : ''}</p>` : ''}
    ${weather ? `<h3 class="section">Weather</h3><ul class="weather">${weather}</ul>
      <p class="source">Source: ${sourceLink(`https://forecast.weather.gov/MapClick.php?lat=${r.at[0]}&lon=${r.at[1]}`, 'National Weather Service forecast')}.</p>` : ''}
    ${liftSection}
    ${seasonSection(r)}
    ${report}
    ${report ? `<p class="source">Source: ${sourceLink('https://www.coloradoski.com/snow-report/', 'Colorado Ski Country USA')} snow report.</p>` : ''}
    ${r.dates?.planned && r.dates.open ? `<p class="source">Opening date as announced by the resort; no live status available.</p>` : ''}
    <a class="site" href="${esc(r.url)}" target="_blank" rel="noopener">Official ${esc(r.name)} site ↗</a>`;
}

// ---------- season chart ----------
// Snowpack (inches of water) this season vs the 1991–2020 normal, plus the next two weeks' forecast.

const SEASON_DAYS = 273; // Oct 1 → Jun 30
const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const MONTH_STARTS = [0, 31, 61, 92, 123, 151, 182, 212, 243];

// `shown`: the season line to draw ([day, inches] points). For this season it's st.season plus the
// dashed 2-week projection; for a past season, that season's line with this season faintly behind it.
function seasonChart(st, ahead, past, bands) {
  const W = 320;
  const H = 128;
  const pad = { l: 4, r: 4, t: 14, b: 18 };
  const last = st.season.at(-1);
  const proj = !past && last && ahead?.length ? [last, ...ahead.map((w, i) => [last[0] + i + 1, last[1] + w])] : [];
  const shown = past ? past.points : st.season;
  const maxY = Math.max(1, ...st.normal.map((p) => p[1]), ...shown.map((p) => p[1]), ...st.season.map((p) => p[1]), ...proj.map((p) => p[1]),
    ...(bands ? bands.p90.map((p) => p[1]) : [])) * 1.08;
  const x = (d) => pad.l + (d / SEASON_DAYS) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / maxY) * (H - pad.t - pad.b);
  const line = (pts) => pts.filter((p) => p[0] <= SEASON_DAYS).map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  const area = st.normal.length ? `${line(st.normal)} L${x(Math.min(SEASON_DAYS, st.normal.at(-1)[0])).toFixed(1)} ${y(0)} L${x(st.normal[0][0]).toFixed(1)} ${y(0)} Z` : '';
  const months = MONTHS.map((m, i) => `<text x="${x(MONTH_STARTS[i] + 2).toFixed(1)}" y="${H - 4}">${m}</text>`).join('');
  const end = past ? null : last;
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Snowpack ${past ? `in ${past.season}` : 'this season'} compared with normal">
      ${MONTH_STARTS.slice(1).map((d) => `<line class="grid" x1="${x(d)}" x2="${x(d)}" y1="${pad.t}" y2="${H - pad.b}"/>`).join('')}
      ${bands ? bandPaths(bands, x, y) : `<path class="normal" d="${area}"/>`}
      ${bands && st.normal.length ? `<path class="median" d="${line(st.normal)}"/>` : ''}
      ${past ? `<path class="now faint" d="${line(st.season)}"/>` : ''}
      ${proj.length ? `<path class="halo" d="${line(proj)}"/><path class="proj" d="${line(proj)}"/>` : ''}
      <path class="halo" d="${line(shown)}"/><path class="now" d="${line(shown)}"/>
      ${end ? `<circle class="now-dot" cx="${x(end[0])}" cy="${y(end[1])}" r="3"/>
        <text class="now-label" text-anchor="end" x="${(x(end[0]) - 6).toFixed(1)}" y="${(y(end[1]) - 8).toFixed(1)}">now ${end[1].toFixed(1)}″</text>` : ''}
      ${proj.length > 1 ? (() => {
        const p = proj.at(-1);
        // Keep the label inside the chart: it flips to the left near the right edge.
        const flip = x(p[0]) > W - 70;
        return `<circle class="proj-dot" cx="${x(p[0])}" cy="${y(p[1])}" r="2.6"/>
          <text class="now-label" text-anchor="${flip ? 'end' : 'start'}" x="${(x(p[0]) + (flip ? -7 : 7)).toFixed(1)}" y="${(y(p[1]) - 6).toFixed(1)}">in 2 wks ${p[1].toFixed(1)}″</text>`;
      })() : ''}
      ${st.peak ? `<text class="peak" x="${x(dayOfSeason(st.peak.date)).toFixed(1)}" y="${(y(st.peak.swe) - 4).toFixed(1)}">normal peak ${st.peak.swe}″</text>` : ''}
      ${months}
    </svg>`;
}

// Filled areas between percentile curves, driest to snowiest.
function bandPaths(b, x, y) {
  const strip = (lo, hi, cls) => {
    const top = hi.map((p) => `${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`);
    const bottom = [...lo].reverse().map((p) => `${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`);
    return `<path class="band ${cls}" d="M${top.join(' L')} L${bottom.join(' L')} Z"/>`;
  };
  const zero = b.p10.map(([d]) => [d, 0]);
  return strip(zero, b.p10, 'b-low') + strip(b.p10, b.p25, 'b-below') + strip(b.p25, b.p75, 'b-normal')
    + strip(b.p75, b.p90, 'b-above') + strip(b.p90, b.max, 'b-high');
}

function dayOfSeason(ymd) {
  const [yr, m] = ymd.split('-').map(Number);
  const start = Date.parse(`${m >= 10 ? yr : yr - 1}-10-01T12:00:00Z`);
  return Math.round((Date.parse(`${ymd}T12:00:00Z`) - start) / 864e5);
}

// Past seasons, one small file per snow station, loaded the first time someone picks one.
const history = new Map();
async function loadHistory(triplet) {
  if (history.has(triplet)) return history.get(triplet);
  const req = fetch(`history/${triplet.split(':')[0]}.json`).then((res) => (res.ok ? res.json() : null)).catch(() => null);
  history.set(triplet, req);
  return req;
}

// Color bands from the saved winters: for each day of the season, the 10th/25th/50th/75th/90th
// percentile and the snowiest year's value. Cached per station.
const bandCache = new Map();
function bandsFor(triplet, hist) {
  if (bandCache.has(triplet)) return bandCache.get(triplet);
  const daily = Array.from({ length: SEASON_DAYS + 1 }, () => []);
  for (const { points } of hist.seasons) {
    for (let i = 0; i + 1 < points.length; i++) {
      const [d0, v0] = points[i];
      const [d1, v1] = points[i + 1];
      for (let d = d0; d < d1 && d <= SEASON_DAYS; d++) daily[d].push(v0 + ((v1 - v0) * (d - d0)) / (d1 - d0 || 1));
    }
  }
  const q = (arr, p) => {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const i = (sorted.length - 1) * p;
    return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
  };
  const days = [];
  for (let d = 0; d <= SEASON_DAYS; d += 3) days.push(d);
  const curve = (p) => days.map((d) => [d, q(daily[d], p)]);
  const bands = {
    p10: curve(0.1), p25: curve(0.25), p75: curve(0.75), p90: curve(0.9), max: curve(1),
    years: hist.seasons.length, first: hist.seasons.at(-1)?.season, last: hist.seasons[0]?.season,
  };
  bandCache.set(triplet, bands);
  return bands;
}

// "2025-26", "2024-25", … back to 2005-06 (where the saved history starts).
function pastSeasons() {
  const [y, m] = state.data.today.split('-').map(Number);
  const start = m >= 10 ? y : y - 1;
  const out = [];
  for (let s = start - 1; s >= 2005; s--) out.push(`${s}-${String(s + 1).slice(2)}`);
  return out;
}

const SNOTEL_SITE = (triplet) => `https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${triplet.split(':')[0]}`;
const sourceLink = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

function seasonSection(r) {
  const st = station(r);
  if (!st && !r.avgSnow) return '';
  const pick = state.pastSeason;
  let past = null;
  let head;
  // Past winters (for the color bands and the season picker) load in the background.
  const h = st ? history.get(r.station) : null;
  const data = h && !(h instanceof Promise) ? h : null;
  if (st && !h) {
    loadHistory(r.station).then((loaded) => {
      history.set(r.station, loaded);
      if (state.selected === r.id) render();
    });
  }
  const bands = data ? bandsFor(r.station, data) : null;
  if (st && pick) {
    past = data?.seasons.find((x) => x.season === pick) ?? null;
    if (!data) head = 'Loading past seasons…';
    else if (!past) head = `No record from ${esc(pick)} at this station.`;
    else {
      const ofNormal = st.peak ? Math.round((past.peak.swe / st.peak.swe) * 100) : null;
      head = `${esc(pick)} peaked at <b>${past.peak.swe}″</b> of snow water on ${monthDay(past.peak.date)}`
        + (ofNormal != null ? ` · <span class="pct lvl-${seasonLevel(ofNormal)}">${ofNormal}%</span> of a normal peak` : '');
    }
  } else if (st) {
    head = st.pct != null
      ? `<span class="pct lvl-${seasonLevel(st.pct)}">${st.pct}%</span> of normal snowpack for this date`
      : 'Too early in the season to compare with normal';
  }
  const options = ['<option value="">This season</option>', ...pastSeasons().map((v) => `<option value="${v}"${v === pick ? ' selected' : ''}>${v}</option>`)].join('');
  return `
    <div class="season-title">
      <h3 class="section">Season</h3>
      ${st ? `<label class="season-pick"><span class="sr">Show season</span><select data-season>${options}</select></label>` : ''}
    </div>
    ${st ? `<p class="season-head">${head}</p>
      ${seasonChart(st, r.forecast?.waterAhead, past, bands)}
      <p class="legend-line">${past
        ? `<i class="k-now"></i>${esc(pick)} <i class="k-faint"></i>This season`
        : '<i class="k-now"></i>This season <i class="k-proj"></i>Next 2 weeks'}${bands ? ' <i class="k-median"></i>Normal' : ' <i class="k-normal"></i>Normal'}</p>
      ${bands ? `<p class="band-key"><span class="b-high">Snowiest 10%</span><span class="b-above">Above</span><span class="b-normal">Typical</span><span class="b-below">Below</span><span class="b-low">Driest 10%</span></p>` : ''}
      <p class="source">Snow water at the ${sourceLink(SNOTEL_SITE(r.station), `${st.name} SNOTEL station`)}${st.latest.depth != null && !past ? ` (${st.latest.depth}″ of snow on the ground)` : ''}.
        Normal is the 1991–2020 median${bands ? `; color bands show how the ${bands.years} winters from ${esc(bands.first)} to ${esc(bands.last)} ranged` : ''}. Source: USDA NRCS Snow Survey.</p>` : ''}
    ${r.noaa?.depth != null ? `<p class="avg">NOAA's snow model shows about <b>${Math.round(r.noaa.depth)}″</b> of snow on the ground here${r.noaa.water != null ? ` (${r.noaa.water}″ of water)` : ''}.
      <span class="source">Source: ${sourceLink('https://www.nohrsc.noaa.gov/nsa/', 'NOAA NOHRSC')} SNODAS snow model, updated daily.</span></p>` : ''}
    ${r.avgSnow ? `<p class="avg">A typical season brings about <b>${r.avgSnow}″</b> of snow here.
      <span class="source">Source: ${sourceLink('https://www.zrankings.com/articles/best-snow-in-colorado', 'ZRankings')} (patrol and avalanche-center records).</span></p>` : ''}`;
}

function renderMap() {
  if (!state.map) return;
  const items = ordered().map(({ r, v }) => {
    const selected = r.id === state.selected;
    const fav = state.favs.has(r.id);
    const open = r.status.state === 'open';
    return {
      r, text: v.text, label: v.text, level: v.level, selected,
      open: open && !['dates', 'season'].includes(METRICS[state.metric].kind),
      important: selected || fav || open,
      rank: [selected, fav, open, v.sort],
    };
  });
  // Most important first (selected, pinned, open), so they win the space on a crowded map.
  items.sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || b.rank[2] - a.rank[2] || b.rank[3] - a.rank[3]);
  state.map.update(items);
}

function render() {
  if (!state.data) return;
  document.querySelectorAll('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric)));
  $('#open-only').checked = state.openOnly;
  $('#snow-btn').setAttribute('aria-pressed', String(state.snowDepth));
  $('#legend').hidden = !state.snowDepth;
  $('#map').classList.toggle('snow-on', state.snowDepth);
  $('#updated').textContent = `Updated ${timeAgo(state.data.generated)}`;

  const r = state.data.resorts.find((x) => x.id === state.selected);
  $('#list').hidden = Boolean(r);
  $('#detail').hidden = !r;
  if (r) renderDetail(r);
  else renderList();
  renderHeadline();
  renderMap();
}

// ---------- bottom sheet ----------
// Three heights on phones: a peek (header only), half, and full. On wide screens it's a side panel.

const sheetEl = $('#sheet');
const grabEl = $('#grab');
let sheetY = 0;

function sheetSizes() {
  const h = sheetEl.offsetHeight;
  const peek = grabEl.offsetHeight + 12;
  return { h, visible: { peek, half: Math.round(window.innerHeight * 0.5), full: h } };
}

// Pixels of map covered by the top bar and the list, so the map fits every resort in what's left:
// above the collapsed sheet on phones, beside the side panel (if open) on wide screens.
function coveredPadding() {
  const top = $('.top').getBoundingClientRect().bottom;
  // The snow-cover key sits along the bottom of the map: keep resorts and labels clear of it.
  const legend = state.snowDepth ? $('#legend').offsetHeight + 12 : 0;
  if (WIDE.matches) return { top, left: state.panelOpen ? sheetEl.offsetWidth + 24 : 0, right: 0, bottom: legend };
  return { top, left: 0, right: 0, bottom: sheetSizes().visible.peek + legend };
}

function setSheetY(y, animate) {
  sheetY = y;
  sheetEl.classList.toggle('dragging', !animate);
  sheetEl.style.transform = WIDE.matches ? '' : `translateY(${y}px)`;
  const visible = WIDE.matches ? 0 : sheetEl.offsetHeight - y;
  document.documentElement.style.setProperty('--sheet-visible', `${visible}px`);
  // The part of the sheet below the screen edge: the list gets that much extra room at the end,
  // so the last resorts can always be scrolled into view, whatever the sheet's height.
  document.documentElement.style.setProperty('--sheet-hidden', `${WIDE.matches ? 0 : Math.max(0, y)}px`);
}

function setSheet(name, animate = true) {
  state.sheet = name;
  sheetEl.dataset.state = name;
  // With the sheet all the way up there's no map to caption: tuck the key and ⓘ away.
  document.body.classList.toggle('sheet-full', name === 'full' && !WIDE.matches);
  if (WIDE.matches) return setSheetY(0, false);
  const { h, visible } = sheetSizes();
  setSheetY(h - visible[name], animate);
}

let drag = null;
grabEl.addEventListener('pointerdown', (e) => {
  if (WIDE.matches || e.target.closest('input, label, button')) return;
  drag = { y: e.clientY, t: performance.now(), start: sheetY, moved: false };
  grabEl.setPointerCapture(e.pointerId);
});
grabEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  if (Math.abs(dy) > 6) drag.moved = true;
  if (!drag.moved) return;
  const { h, visible } = sheetSizes();
  setSheetY(Math.min(h - visible.peek, Math.max(0, drag.start + dy)), false);
});
grabEl.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) return setSheet(state.sheet === 'peek' ? 'half' : 'peek');
  const { h, visible } = sheetSizes();
  const velocity = (e.clientY - d.y) / (performance.now() - d.t); // px per ms, + is down
  const shown = h - sheetY;
  const names = ['peek', 'half', 'full'];
  let i = names.reduce((best, n, k) => (Math.abs(visible[n] - shown) < Math.abs(visible[names[best]] - shown) ? k : best), 0);
  if (velocity < -0.5) i = Math.min(2, names.indexOf(state.sheet) + 1);
  if (velocity > 0.5) i = Math.max(0, names.indexOf(state.sheet) - 1);
  setSheet(names[i]);
});
grabEl.addEventListener('pointercancel', () => {
  drag = null;
  setSheet(state.sheet);
});

// ---------- actions ----------

function select(id) {
  state.selected = id;
  if (id && WIDE.matches && !state.panelOpen) setPanel(true);
  render();
  $('#sheet-body').scrollTop = 0;
  if (id && (state.sheet === 'peek' || state.sheet === 'full')) setSheet('half');
}

// Wide screens: show or hide the resort list; the map refits to the space it gets.
function setPanel(open) {
  state.panelOpen = open;
  write(STORE.panel, open);
  document.body.classList.toggle('panel-hidden', !open);
  $('#panel-open').hidden = open || !WIDE.matches;
  state.map?.refit();
}

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

function showNotice(text) {
  $('#notice').hidden = !text;
  $('#notice').textContent = text ?? '';
}

function startMap() {
  if (state.map || !state.data) return;
  state.map = createSnowMap($('#map'), {
    resorts: state.data.resorts,
    getPadding: coveredPadding,
    onSelect: (id) => select(id),
  });
  state.map.setSnowDepth(state.snowDepth);
}

async function load() {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
    state.loadedAt = Date.now();
    write(STORE.data, state.data);
    const age = Date.now() - Date.parse(state.data.generated);
    showNotice(age > STALE_AFTER_MS ? `Heads up: this data is ${timeAgo(state.data.generated).replace(' ago', '')} old.`
      : !state.data.sources.coloradoSki ? 'Live open status is unavailable right now. Showing forecasts only.' : null);
  } catch {
    const saved = read(STORE.data, null);
    if (saved) {
      state.data = saved;
      showNotice(`You're offline. Showing data from ${timeAgo(saved.generated)}.`);
    } else {
      showNotice("Couldn't load snow data. Check your connection, then tap “Updated” to retry.");
    }
  }
  startMap();
  render();
}

document.addEventListener('click', (e) => {
  const t = e.target;
  const metric = t.closest('[data-metric]');
  if (metric) {
    state.metric = metric.dataset.metric;
    write(STORE.metric, state.metric);
    return render();
  }
  const row = t.closest('[data-open]');
  if (row) return select(row.dataset.open);
  if (t.closest('[data-back]')) return select(null);
  const star = t.closest('[data-fav]');
  if (star) {
    const id = star.dataset.fav;
    state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
    write(STORE.favs, [...state.favs]);
    toast(state.favs.has(id) ? 'Pinned to the top of the list' : 'Unpinned');
    return render();
  }
  if (t.closest('#snow-btn')) {
    state.snowDepth = !state.snowDepth;
    write(STORE.snowDepth, state.snowDepth);
    state.map?.setSnowDepth(state.snowDepth);
    render();
    return state.map?.refit();
  }
  if (t.closest('#panel-close')) return setPanel(false);
  if (t.closest('#panel-open')) return setPanel(true);
  if (t.closest('#info-btn')) {
    const c = $('#credits');
    c.hidden = !c.hidden;
    $('#info-btn').setAttribute('aria-expanded', String(!c.hidden));
    return;
  }
  if (t.closest('#updated')) return load();
});

document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-season]')) return;
  state.pastSeason = e.target.value || null;
  render();
});
$('#open-only').addEventListener('change', (e) => {
  state.openOnly = e.target.checked;
  write(STORE.openOnly, state.openOnly);
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selected) select(null);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > RELOAD_AFTER_MS) load();
});
const onResize = () => {
  setSheet(state.sheet, false);
  document.body.classList.toggle('panel-hidden', WIDE.matches && !state.panelOpen);
  $('#panel-open').hidden = !WIDE.matches || state.panelOpen;
  state.map?.refit();
};
// Laying labels out takes ~0.1 s, so while a window is being dragged to a new size, wait for a pause.
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 120);
});
WIDE.addEventListener('change', onResize);

$('#credits').innerHTML = CREDITS;
setSheet('peek', false);
document.body.classList.toggle('panel-hidden', WIDE.matches && !state.panelOpen);
$('#panel-open').hidden = !WIDE.matches || state.panelOpen;
// Show the last copy instantly, then fetch fresh data.
state.data = read(STORE.data, null);
startMap();
render();
load();
