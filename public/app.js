import { createSnowMap, CREDITS } from './map.js?v=__V__';

// One data file per state (data/co.json, data/ut.json…), plus an index of states for the picker.
const dataUrl = (code) => `data/${code.toLowerCase()}.json`;
const STATES_URL = 'states.json';
// Colorado only for now. Set to true (and build with US_STATES=1) to bring back the state picker and
// every other state's map.
const ALL_STATES = false;
// Every state with resorts. Anything else in the address or storage is ignored (e.g. an old bad "#half").
const STATE_CODES = !ALL_STATES ? new Set(['CO']) : new Set(["CO", "AK", "AZ", "CA", "CT", "IA", "ID", "IL", "IN", "MA", "MD", "ME", "MI", "MN", "MO", "MT", "NC", "ND", "NH", "NJ", "NM", "NV", "NY", "OH", "OR", "PA", "SD", "TN", "UT", "VA", "VT", "WA", "WI", "WV", "WY"]);
const validCode = (c) => (c && STATE_CODES.has(String(c).toUpperCase()) ? String(c).toUpperCase() : null);
const STORE = {
  data: 'cs:data', favs: 'cs:favs', metric: 'cs:metric', snowDepth: 'cs:snowCover', layer: 'cs:layer', openOnly: 'cs:openOnly', favsOnly: 'cs:favsOnly', pass: 'cs:pass', panel: 'cs:panel',
  state: 'cs:state', states: 'cs:states', theme: 'cs:theme',
};
const RELOAD_AFTER_MS = 10 * 60_000;
const STALE_AFTER_MS = 3 * 3_600_000;
const WIDE = window.matchMedia('(min-width: 900px)');
const DARK = window.matchMedia('(prefers-color-scheme: dark)');

// Light, dark, or "auto" (follow the phone). index.html applies the saved choice before first paint.
function applyTheme(pick) {
  let choice = pick ?? 'auto';
  try {
    if (pick) localStorage.setItem(STORE.theme, pick);
    else choice = localStorage.getItem(STORE.theme) ?? 'auto';
  } catch { /* storage blocked: this visit only */ }
  const dark = choice === 'dark' || (choice === 'auto' && DARK.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#161e29' : '#ffffff';
  state.map?.setTheme(); // (only called once `state` exists: at startup's end and on changes)
  for (const b of document.querySelectorAll('[data-theme-pick]')) b.setAttribute('aria-pressed', String(b.dataset.themePick === choice));
}

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
  // Base depth: the resort's own report when it gives one (usually once open), otherwise NOAA's
  // modelled snow depth at the resort (marked est.).
  base: {
    // (Last resort: the nearest snow station's depth.)
    kind: 'base', get: (r) => r.report?.depth ?? r.noaa?.depth ?? station(r)?.latest?.depth ?? null, est: (r) => r.report?.depth == null,
    steps: [6, 12, 24, 48], top: 'Deepest base',
  },
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
  favsOnly: read(STORE.favsOnly, false),
  pass: read(STORE.pass, 'all'), // 'all', 'epic', 'ikon', 'indy' or 'other'
  // The map overlay: 'snow' (on the ground; the default), 'radar', 'outlook' or 'none'.
  layer: read(STORE.layer, null) ?? (read(STORE.snowDepth, true) ? 'snow' : 'none'),
  outlookSeason: null, // e.g. "NDJ 2026-2027", once the outlook has loaded
  radar: { time: null, playing: false, count: 0 }, // the radar loop's current frame
  selected: null,
  sheet: 'peek',
  pastSeason: null, // a past season like '2024-25' to show in the season chart, or null for this one
  panelOpen: read(STORE.panel, true), // wide screens: the resort list on the left
  map: null,
  // Which state: from the address, else the one picked last time on this device. A first-time visitor
  // gets the state picker (Colorado shows behind it).
  code: validCode(location.hash.slice(1)) ?? validCode(read(STORE.state, null)) ?? 'CO',
  firstVisit: ALL_STATES && !validCode(location.hash.slice(1)) && !validCode(read(STORE.state, null)),
  states: read(STORE.states, null), // the picker's list
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
// The resort's website as people say it: "vail.com", "skiloveland.com".
const siteName = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Website'; } };
// The usual "opens in a new tab" icon: a box with an arrow leaving it.
const EXT_ICON = '<svg class="ext-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------- filters ----------
// Which multi-resort pass each Colorado resort is on, 2026–27 (the rest are "Other": their own passes).
// Telluride is 7 days on Epic; Aspen Snowmass's four mountains share 7 days on Ikon.
const PASSES = {
  epic: ['vail', 'beaver-creek', 'breckenridge', 'keystone', 'crested-butte', 'telluride'],
  ikon: ['arapahoe-basin', 'copper-mountain', 'winter-park', 'steamboat', 'eldora', 'aspen-mountain', 'aspen-highlands', 'buttermilk', 'snowmass'],
  indy: ['loveland', 'sunlight', 'powderhorn', 'granby-ranch', 'echo-mountain', 'howelsen-hill'],
};
const PASS_NAMES = { all: 'All', epic: 'Epic', ikon: 'Ikon', indy: 'Indy', other: 'Other' };
const passOf = (r) => Object.keys(PASSES).find((p) => PASSES[p].includes(r.id)) ?? 'other';
const filtering = () => state.openOnly || state.favsOnly || state.pass !== 'all';
function matches(r) {
  return (!state.openOnly || isOpenish(r)) && (!state.favsOnly || state.favs.has(r.id)) && (state.pass === 'all' || passOf(r) === state.pass);
}
// The chip says what's on: "Filter", or e.g. "Ikon · Open · ★".
function syncFilters() {
  const parts = [state.pass !== 'all' && PASS_NAMES[state.pass], state.openOnly && 'Open', state.favsOnly && '★'].filter(Boolean);
  const btn = $('#filter-btn');
  btn.querySelector('span').textContent = parts.length ? parts.join(' · ') : 'Filter';
  btn.classList.toggle('on', parts.length > 0);
  $('#f-open').checked = state.openOnly;
  $('#f-favs').checked = state.favsOnly;
  for (const b of document.querySelectorAll('[data-pass]')) b.setAttribute('aria-pressed', String(b.dataset.pass === state.pass));
}
function openFilters(open) {
  const pop = $('#filters');
  pop.hidden = !open;
  $('#filter-btn').setAttribute('aria-expanded', String(open));
  if (!open) return;
  // Below the chip when there's room, otherwise above it.
  const r = $('#filter-btn').getBoundingClientRect();
  const h = pop.offsetHeight;
  pop.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  pop.style.top = r.bottom + 8 + h < innerHeight ? `${r.bottom + 8}px` : `${Math.max(8, r.top - 8 - h)}px`;
}

// ---------- map overlay ----------

function openLayers(open) {
  $('#layers').hidden = !open;
  $('#snow-btn').setAttribute('aria-expanded', String(open));
}

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>';
// "3:05 PM" for the frame showing, plus "now" on the newest.
function radarTimeText() {
  const { time, index, count } = state.radar;
  if (!time) return 'Latest';
  const t = new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return index === count - 1 ? `${t} · now` : t;
}
function syncRadarKey() {
  const btn = $('#radar-play');
  if (!btn) return;
  btn.innerHTML = state.radar.playing ? PAUSE_ICON : PLAY_ICON;
  btn.setAttribute('aria-label', state.radar.playing ? 'Pause' : 'Play the last hour');
  btn.disabled = state.radar.count < 2;
  $('#radar-time').textContent = radarTimeText();
}

// "NDJ 2026-2027" → "Nov–Jan".
const MONTH_LETTERS = ['JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ', 'DJF'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function seasonSpan(valid) {
  const i = MONTH_LETTERS.indexOf(String(valid ?? '').slice(0, 3));
  return i < 0 ? 'next 3 months' : `${MONTH_NAMES[i]}–${MONTH_NAMES[(i + 2) % 12]}`;
}

// The key along the bottom of the map, for whichever overlay is showing.
function legendFor(layer) {
  if (layer === 'radar') {
    return `<button type="button" class="radar-play" id="radar-play" aria-label="Play the last hour" ${state.radar.count > 1 ? '' : 'disabled'}>${state.radar.playing ? PAUSE_ICON : PLAY_ICON}</button>
      <span class="radar-time" id="radar-time">${radarTimeText()}</span>
      <span class="legend-keys"><span>Light</span><i class="ramp ramp-radar" aria-hidden="true"></i><span>Heavy</span></span>`;
  }
  if (layer === 'outlook') {
    return `<span class="legend-title">${esc(seasonSpan(state.outlookSeason))} outlook</span><span class="legend-keys"><span>Drier</span><i class="ramp ramp-outlook" aria-hidden="true"></i><span>Wetter</span><span class="muted">· ${esc(seasonSpan(state.outlookSeason))}</span></span>`;
  }
  return '<span class="legend-title">Snow on the ground</span><span class="legend-keys"><span>1″</span><i class="ramp" aria-hidden="true"></i><span>8 ft+</span></span>';
}

function seasonText(r, today) {
  const { open, close, when, planned } = r.dates ?? {};
  if (open && close) return `Season ${monthDay(open)} – ${monthDay(close)}`;
  if (open) {
    // The pill already says when it opens; once past the date, say what happened.
    if (r.status.state === 'soon') return '';
    if (r.status.state === 'late') return `Was set for ${when ?? monthDay(open)}`;
    if (r.status.state === 'likely') return `Set to open ${when ?? monthDay(open)}`;
    return `Opened ${when ?? monthDay(open)}`;
  }
  if (close) return `Closes ${monthDay(close)}`;
  return '';
}

// One resort's value for the current metric, as both the map bubble and the list show it.
function valueFor(r, metricKey = state.metric) {
  const m = METRICS[metricKey];
  if (m.kind === 'dates') {
    const { state: s, date } = r.status;
    const close = r.dates?.close;
    const daysOut = date ? (Date.parse(date) - Date.parse(state.data.today)) / 864e5 : 0;
    // Short on the map; the list and details say how much is open.
    if (s === 'open') return { text: 'Open', sub: r.status.pct != null ? `${r.status.pct}% of runs` : '', level: 'open', sort: 1e5 + (r.status.pct ?? 0) };
    if (s === 'likely') return { text: 'Open?', level: 'likely', sort: 9e4 };
    if (s === 'soon') return { text: daysOut <= 0 ? 'Today' : r.dates?.when ?? monthDay(date), level: 'soon', sort: 8e4 - daysOut };
    if (s === 'late') return { text: 'Late', level: 'late', sort: 7e4 };
    return { text: s === 'done' ? 'Closed' : 'TBA', level: 'tba', sort: 0 };
  }
  if (m.kind === 'season') {
    const pct = m.get(r);
    // A station whose normal is still near zero (early season, lower elevations): say so rather than
    // dropping the label.
    if (pct == null && station(r)) return { text: 'Early', level: 'tba', sort: -0.5 };
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

// Buttons depend on what the state has: Dates only where opening dates exist (Colorado); Season where
// there are snow stations, NOAA snow Depth where there aren't.
function availableMetrics() {
  const rs = state.data?.resorts ?? [];
  const hasDates = rs.some((r) => r.dates?.open || r.dates?.close);
  const hasStations = rs.some((r) => r.station);
  return ['new24', 'next72', 'next7', 'base', ...(hasStations ? ['season'] : []), ...(hasDates ? ['dates'] : [])];
}
function syncRibbon() {
  const avail = availableMetrics();
  if (state.metric === 'depth') state.metric = 'base'; // its old name
  if (!avail.includes(state.metric)) state.metric = 'new24';
  document.querySelector('[data-metric="season"]').hidden = !avail.includes('season');
  document.querySelector('[data-metric="dates"]').hidden = !avail.includes('dates');
}

const isOpenish = (r) => r.status.state === 'open' || r.status.state === 'likely';

// Pinned first, then by the current metric.
// all: every resort regardless of "Open now" (the map always shows them all, so it never moves).
function ordered(all = false) {
  return state.data.resorts
    .filter((r) => all || matches(r))
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
    if (m.kind === 'base') {
      text = v ? `${m.top}: <strong>${esc(best.name)} ${Math.round(v)}″</strong>` : 'No snow on the ground yet';
    } else if (m.kind === 'season') {
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
  $('#list').innerHTML = rows || `<p class="empty">${state.openOnly && !state.favsOnly && state.pass === 'all' ? 'Nothing open yet.' : 'No resorts match these filters.'} <button type="button" class="link" data-clear-filters>Show all</button></p>`;
}

function renderDetail(r) {
  const today = state.data.today;
  const f = r.forecast;
  const rep = r.report;
  const fav = state.favs.has(r.id);
  const stat = (num, label, sub = '') => `<div class="stat"><b>${num}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;

  const bars = f ? `
    <div class="days">${f.days.map((d) => `
      <div class="day${d.snow >= 1 ? ' has-snow' : ''}">
        <span class="day-name">${weekday(d.date, today)}</span>
        <span class="day-sky" title="${esc(d.sky ?? d.night ?? '')}">${skyIcon(d.sky ?? d.night) || '&nbsp;'}</span>
        <span class="day-temp">${d.hi ?? '–'}°<i>${d.lo ?? '–'}°</i></span>
        <span class="day-snow">${d.snow >= 1 ? inches(d.snow) : d.snow > 0 ? '<1″' : ''}</span>
      </div>`).join('')}
    </div>
    ${f.week2 ? `<p class="week2"><b>Days 8–14:</b> about ${inches(f.week2.mid)} more${rangeText(f.week2.range) ? ` (${rangeText(f.week2.range)})` : ''}</p>` : ''}` : '<p class="muted">Forecast unavailable right now.</p>';

  // Where every number comes from, gathered at the very bottom for anyone curious.
  const notes = [];

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
    <p class="source">Checked ${esc(clock(L.checked))}${recent(L.updated) ? ` · changed ${esc(timeAgo(L.updated))}` : ''}</p>` : '';
  if (L) notes.push(`Lifts: live from ${sourceLink(L.page, `${r.name}’s lift status`)}.`);

  const new24 = rep?.new24 ?? f?.past24;
  const new24Label = rep?.new24 != null ? 'last 24 hrs' : f?.past24 != null ? 'last 24 hrs (est.)' : 'last 24 hrs';

  const sources = f?.sources?.map((s) => SOURCE_NAMES[s] ?? s) ?? [];
  $('#grab-detail').innerHTML = `
    <div class="detail-head">
      <button type="button" class="icon" data-back aria-label="Back to all resorts">‹</button>
      <div class="detail-title">
        <h2><span>${esc(r.name)}<a class="site-link" href="${esc(r.url)}" target="_blank" rel="noopener" aria-label="${esc(r.name)} website (${esc(siteName(r.url))})" title="${esc(siteName(r.url))}">${EXT_ICON}</a></span>
          <span class="pill pill-${esc(r.status.state)}">${esc(r.status.label)}</span></h2>
        ${seasonText(r, today) ? `<p>${esc(seasonText(r, today))}</p>` : ''}
      </div>
      <button type="button" class="icon star" data-fav="${esc(r.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Unpin' : 'Pin'} ${esc(r.name)}">${fav ? '★' : '☆'}</button>
    </div>`;
  const top = `
    <div class="stats">
      ${stat(inches(new24), new24Label)}
      ${stat(inches(f?.next72), 'next 3 days', rangeText(f?.next72Range))}
      ${stat(inches(f?.next7), 'next 7 days', rangeText(f?.next7Range))}
    </div>
    ${bars}
  `;
  if (f) notes.push(`Snow forecast: the middle of ${sources.length > 1 ? `${sources.length} forecasts (${esc(sources.join(', '))})` : 'the National Weather Service forecast'}${sources.length > 1 ? `, via ${sourceLink('https://www.weather.gov', 'NWS')} and ${sourceLink('https://open-meteo.com', 'Open-Meteo')}` : ''}. Small numbers are the likely range.${state.data.sources.modelsReused ? ` Model forecast from ${esc(timeAgo(state.data.sources.modelsAt))}.` : ''}`);
  if (f) notes.push(`Weather: ${sourceLink(`https://forecast.weather.gov/MapClick.php?lat=${r.at[0]}&lon=${r.at[1]}`, 'National Weather Service forecast')}.`);
  const season = seasonSection(r, notes);
  if (report) notes.push(`Snow report: ${sourceLink('https://www.coloradoski.com/snow-report/', 'Colorado Ski Country USA')}${rep.updated ? `, updated ${esc(timeAgo(rep.updated))}` : ''}.`);
  if (r.dates?.planned && r.dates.open) notes.push('Opening date as announced by the resort.');

  $('#detail').innerHTML = `${top}
    ${liftSection}
    ${report}
    ${season}
    ${notes.length ? `<h3 class="section">About the data</h3><ul class="notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}`;
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
  const pad = { l: 4, r: 4, t: 20, b: 18 }; // room above for the "normal peak" label
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
      ${st.peak ? `<circle class="peak-dot" cx="${x(dayOfSeason(st.peak.date)).toFixed(1)}" cy="${y(st.peak.swe).toFixed(1)}" r="2.4"/>
        <text class="peak" x="${x(dayOfSeason(st.peak.date)).toFixed(1)}" y="${(y(st.peak.swe) - 6).toFixed(1)}">normal peak ${st.peak.swe}″</text>` : ''}
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
const seasonHistory = new Map();
async function loadHistory(triplet) {
  if (seasonHistory.has(triplet)) return seasonHistory.get(triplet);
  const req = fetch(`history/${triplet.split(':')[0]}.json`).then((res) => (res.ok ? res.json() : null)).catch(() => null);
  seasonHistory.set(triplet, req);
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

function seasonSection(r, notes) {
  const st = station(r);
  if (!st && !r.avgSnow) return '';
  const pick = state.pastSeason;
  let past = null;
  let head;
  // Past winters (for the color bands and the season picker) load in the background.
  const h = st ? seasonHistory.get(r.station) : null;
  const data = h && !(h instanceof Promise) ? h : null;
  if (st && !h) {
    loadHistory(r.station).then((loaded) => {
      seasonHistory.set(r.station, loaded);
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
  if (st) {
    notes.push(`Snowpack: snow water at the ${sourceLink(SNOTEL_SITE(r.station), `${st.name} SNOTEL station`)} (USDA NRCS Snow Survey). Normal is the 1991–2020 median${bands ? `; color bands show how the ${bands.years} winters from ${esc(bands.first)} to ${esc(bands.last)} ranged` : ''}.`);
  }
  const fact = (label, value) => `<li><span>${label}</span><b>${value}</b></li>`;
  const facts = [];
  if (r.noaa?.depth != null) {
    facts.push(fact('Snow on the ground', `about ${Math.round(r.noaa.depth)}″`));
    notes.push(`Snow on the ground: ${sourceLink('https://www.nohrsc.noaa.gov/nsa/', 'NOAA NOHRSC')} SNODAS snow model, updated daily${r.noaa.water != null ? ` (${r.noaa.water}″ of water here)` : ''}.`);
  } else if (st?.latest.depth != null && !past) {
    facts.push(fact('Snow on the ground', `${st.latest.depth}″ at the station`));
  }
  if (r.avgSnow) {
    facts.push(fact('Typical season', `about ${r.avgSnow}″ of snow`));
    notes.push(`Typical season: ${sourceLink('https://www.zrankings.com/articles/best-snow-in-colorado', 'ZRankings')} (patrol and avalanche-center records).`);
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
` : ''}
    ${facts.length ? `<ul class="report">${facts.join('')}</ul>` : ''}`;
}

function renderMap() {
  if (!state.map) return;
  // Every resort, always: "Open now" filters the list and only dims closed resorts on the map.
  $('#map').classList.toggle('filtering', filtering());
  const items = ordered(true).map(({ r, v }) => {
    const selected = r.id === state.selected;
    const fav = state.favs.has(r.id);
    const open = r.status.state === 'open';
    return {
      r, text: v.text, label: v.text, level: v.level, selected, match: matches(r),
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
  syncRibbon();
  $('#state-btn').textContent = `${state.data.stateName ?? 'Colorado'} ▾`;
  document.querySelectorAll('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric)));
  syncFilters();
  $('#snow-btn').setAttribute('aria-pressed', String(state.layer !== 'none'));
  for (const b of document.querySelectorAll('[data-layer]')) b.setAttribute('aria-checked', String(b.dataset.layer === state.layer));
  // Hidden but still taking its space, so changing the overlay never shifts the map.
  $('#legend').classList.toggle('off', state.layer === 'none');
  $('#legend').innerHTML = legendFor(state.layer);
  $('#updated').textContent = `Updated ${timeAgo(state.data.generated)}`;

  const r = state.data.resorts.find((x) => x.id === state.selected);
  $('#list').hidden = Boolean(r);
  $('#detail').hidden = !r;
  $('.foot').hidden = Boolean(r); // a resort's own sources sit at the bottom of its details
  grabEl.classList.toggle('has-detail', Boolean(r));
  if (!r) $('#grab-detail').innerHTML = '';
  if (r) renderDetail(r);
  else renderList();
  renderHeadline();
  renderMap();
}

// ---------- bottom sheet ----------
// Three heights on phones: a peek (header only), half, and full. On wide screens it's a side panel.

const sheetEl = $('#sheet');
const grabEl = $('#grab');
// The list header's height decides how much the collapsed sheet shows. It can change after the first
// layout (data arriving, fonts loading, the headline wrapping): re-measure then, so the sheet never
// rides up over the snow key or the map's lowest resorts.
new ResizeObserver(() => {
  if (grabEl.classList.contains('has-detail')) return;
  const before = peekHeight;
  peekHeight = 0;
  if (!before || sheetSizes().visible.peek === before) return;
  setSheet(state.sheet, false);
  state.map?.refit();
}).observe(grabEl);
let sheetY = 0;

let peekHeight = 0;
// env(safe-area-inset-bottom) in pixels (0 on phones without a gesture bar, and on laptops).
const safeProbe = Object.assign(document.createElement('div'), { style: 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none' });
document.body.append(safeProbe);
const safeBottom = () => safeProbe.offsetHeight;
function sheetSizes() {
  const h = sheetEl.offsetHeight;
  // The collapsed sheet's height comes from the list header, so opening a resort (whose header is
  // a little different) never shifts the map.
  // Plus the phone's gesture bar, which Chrome now draws the page underneath.
  if (!grabEl.classList.contains('has-detail') || !peekHeight) peekHeight = grabEl.offsetHeight + 12 + safeBottom();
  const peek = peekHeight;
  return { h, visible: { peek, half: Math.round(window.innerHeight * 0.5), full: h } };
}

// Pixels of map covered by the top bar and the list, so the map fits every resort in what's left:
// above the collapsed sheet on phones, beside the side panel (if open) on wide screens.
let legendHeight = 0;
function coveredPadding() {
  const top = $('.ribbon').getBoundingClientRect().bottom; // (not .top: a toast there would shift the map)
  // The snow-cover key sits along the bottom of the map: keep resorts and labels clear of it.
  // Its space is kept whether or not it's showing (snow cover off, sheet pulled up), so the map never
  // shifts when it comes and goes.
  legendHeight = $('#legend').offsetHeight || legendHeight;
  const legend = legendHeight + 12;
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
  // The snow key only while the sheet is down: pulled up, it would ride over the labels.
  document.body.classList.toggle('sheet-up', name !== 'peek' && !WIDE.matches);
  if (WIDE.matches) return setSheetY(0, false);
  const { h, visible } = sheetSizes();
  setSheetY(h - visible[name], animate);
}

let drag = null;
grabEl.addEventListener('pointerdown', (e) => {
  if (WIDE.matches || e.target.closest('input, label, button, a')) return;
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
  // Let go of the finger explicitly so the next tap goes wherever it lands.
  if (grabEl.hasPointerCapture?.(e.pointerId)) grabEl.releasePointerCapture(e.pointerId);
  if (!d.moved) return setSheet(state.sheet === 'peek' ? 'half' : 'peek');
  snapSheet((e.clientY - d.y) / (performance.now() - d.t)); // px per ms, + is down
});
// Let go of a sheet drag: settle on the nearest height (peek, half, full), or one step on in the
// direction of a quick flick.
function snapSheet(velocity) {
  const { h, visible } = sheetSizes();
  const shown = h - sheetY;
  const names = ['peek', 'half', 'full'];
  let i = names.reduce((best, n, k) => (Math.abs(visible[n] - shown) < Math.abs(visible[names[best]] - shown) ? k : best), 0);
  if (velocity < -0.5) i = Math.min(2, names.indexOf(state.sheet) + 1);
  if (velocity > 0.5) i = Math.max(0, names.indexOf(state.sheet) - 1);
  setSheet(names[i]);
}

// Swipes on the sheet's content (phones):
//  - up while the sheet isn't full: pulls the sheet up first (then the content scrolls as usual);
//  - down while the content is at its top: pulls the sheet down instead of bouncing;
//  - left/right: next/previous resort when one is open, else the next/previous map view.
const bodyEl = $('#sheet-body');
let swipe = null;
const sideTarget = () => (state.selected ? $('#detail') : $('#list'));
bodyEl.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) { swipe = null; return; }
  const t = e.touches[0];
  const now = performance.now();
  swipe = { x: t.clientX, y: t.clientY, start: sheetY, mode: null, lastY: t.clientY, lastT: now, vy: 0 };
}, { passive: true });
bodyEl.addEventListener('touchmove', (e) => {
  if (!swipe) return;
  const t = e.touches[0];
  const dx = t.clientX - swipe.x;
  const dy = t.clientY - swipe.y;
  if (!swipe.mode) {
    if (Math.hypot(dx, dy) < 7) return;
    if (Math.abs(dx) > Math.abs(dy) * 1.4 && !e.target.closest('select, input, .chart')) swipe.mode = 'side';
    else if (!WIDE.matches && ((dy > 0 && bodyEl.scrollTop <= 0) || (dy < 0 && state.sheet !== 'full'))) swipe.mode = 'sheet';
    else swipe.mode = 'scroll';
  }
  // Scrolling back up hits the top mid-swipe: from there the same swipe pulls the sheet down.
  if (swipe.mode === 'scroll' && !WIDE.matches && t.clientY > swipe.lastY && bodyEl.scrollTop <= 0) {
    Object.assign(swipe, { mode: 'sheet', y: t.clientY, start: sheetY });
  }
  if (swipe.mode === 'scroll') { swipe.lastY = t.clientY; swipe.lastT = performance.now(); return; }
  if (e.cancelable) e.preventDefault();
  if (swipe.mode === 'sheet') {
    const { h, visible } = sheetSizes();
    setSheetY(Math.min(h - visible.peek, Math.max(0, swipe.start + (t.clientY - swipe.y))), false);
    const now = performance.now();
    swipe.vy = (t.clientY - swipe.lastY) / Math.max(1, now - swipe.lastT);
    swipe.lastY = t.clientY;
    swipe.lastT = now;
  } else {
    // A hint of the content following the finger.
    sideTarget().style.transform = `translateX(${Math.max(-60, Math.min(60, dx * 0.35))}px)`;
  }
}, { passive: false });
const endSwipe = (e, cancelled) => {
  const s = swipe;
  swipe = null;
  if (!s) return;
  if (s.mode === 'sheet') return cancelled ? setSheet(state.sheet) : snapSheet(s.vy);
  if (s.mode !== 'side') return;
  const el = sideTarget();
  el.style.transform = '';
  const dx = (e.changedTouches?.[0]?.clientX ?? s.x) - s.x;
  if (!cancelled && Math.abs(dx) > 70) sideSwipe(dx < 0 ? 1 : -1);
};
bodyEl.addEventListener('touchend', (e) => endSwipe(e, false));
bodyEl.addEventListener('touchcancel', (e) => endSwipe(e, true));

// dir: +1 next, -1 previous (wraps around).
function sideSwipe(dir) {
  if (state.selected) {
    const ids = ordered().map((o) => o.r.id);
    const i = ids.indexOf(state.selected);
    if (i < 0 || ids.length < 2) return;
    state.selected = ids[(i + dir + ids.length) % ids.length];
    render();
    bodyEl.scrollTop = 0;
    slideIn($('#detail'), dir);
    $('#grab-detail').firstElementChild && slideIn($('#grab-detail'), dir);
  } else {
    const views = availableMetrics();
    state.metric = views[(views.indexOf(state.metric) + dir + views.length) % views.length];
    write(STORE.metric, state.metric);
    render();
    slideIn($('#list'), dir);
  }
}
// New content slides in from the side it came from.
function slideIn(el, dir) {
  el.classList.remove('slide-next', 'slide-prev');
  void el.offsetWidth; // restart the animation
  el.classList.add(dir > 0 ? 'slide-next' : 'slide-prev');
}
grabEl.addEventListener('pointercancel', (e) => {
  if (grabEl.hasPointerCapture?.(e.pointerId)) grabEl.releasePointerCapture(e.pointerId);
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

// Towns for orientation on the Colorado map, most important first. `true`: always shown (the
// resort labels make room for it); the rest show where there's space.
const CO_TOWNS = [
  ['Denver', 39.7392, -104.9903, true], ['Colorado Springs', 38.8339, -104.8214, true], ['Fort Collins', 40.5853, -105.0844, true],
  ['Durango', 37.2753, -107.8801, true], ['Grand Junction', 39.0639, -108.5506],
  ['Boulder', 40.015, -105.2705], ['Pueblo', 38.2544, -104.6091], ['Glenwood Springs', 39.5505, -107.3248], ['Gunnison', 38.5458, -106.9253],
  ['Montrose', 38.4783, -107.8762], ['Alamosa', 37.4695, -105.87], ['Salida', 38.5347, -105.9989],
  ['Leadville', 39.2508, -106.2925], ['Craig', 40.5153, -107.5464],
];

function startMap() {
  if (state.map || !state.data) return;
  state.map = createSnowMap($('#map'), {
    resorts: state.data.resorts,
    getPadding: coveredPadding,
    onSelect: (id) => select(id),
    onOutlook: (season) => { state.outlookSeason = season; render(); },
    // Each radar frame: just update the key's button and time (no full re-render while playing).
    onRadar: (r) => { state.radar = r; syncRadarKey(); },
    places: state.code === 'CO' ? CO_TOWNS : [],
  });
  state.map.setLayer(state.layer);
  // Major highways (I-70, I-25, US-285…), Colorado only for now.
  if (state.code === 'CO') {
    const map = state.map;
    fetch('roads.json?v=__V__').then((r) => r.json()).then((d) => { if (state.map === map) map.setRoads(d); }).catch(() => {});
  }
}

async function load() {
  const code = state.code;
  try {
    const res = await fetch(`${dataUrl(code)}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (code !== state.code) return; // switched states while this was loading
    state.data = data;
    state.loadedAt = Date.now();
    write(`${STORE.data}:${code}`, state.data);
    const age = Date.now() - Date.parse(state.data.generated);
    showNotice(age > STALE_AFTER_MS ? `Heads up: this data is ${timeAgo(state.data.generated).replace(' ago', '')} old.`
      : code === 'CO' && !state.data.sources.coloradoSki ? 'Live open status is unavailable right now. Showing forecasts only.' : null);
  } catch {
    if (code !== state.code) return;
    const saved = read(`${STORE.data}:${code}`, null);
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

// ---------- states ----------

async function loadStates() {
  try {
    const res = await fetch(`${STATES_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    state.states = await res.json();
    write(STORE.states, state.states);
  } catch { /* keep the saved list */ }
  renderPicker();
}

function renderPicker() {
  const list = state.states;
  if (!list) return;
  $('#picker-list').innerHTML = list.regions.map((region) => {
    const states = list.states.filter((x) => x.region === region);
    if (!states.length) return '';
    return `<h3 class="picker-region">${esc(region)}</h3><div class="picker-grid">${states.map((x) => `
      <button type="button" class="picker-state${x.code === state.code ? ' is-current' : ''}" data-pick-state="${esc(x.code)}">
        <b>${esc(x.name)}</b><small>${x.count} resort${x.count === 1 ? '' : 's'}${x.open ? ` · <span class="open-now">${x.open} open</span>` : ''}</small>
      </button>`).join('')}</div>`;
  }).join('');
}

function openPicker(open) {
  // First visit: the picker is the welcome, so it can't be dismissed without choosing.
  if (!open && state.firstVisit) return;
  $('#picker').hidden = !open;
  $('#picker-title span').textContent = state.firstVisit ? 'Where are you skiing?' : 'Choose a state';
  $('#picker-close').hidden = state.firstVisit;
  $('#state-btn').setAttribute('aria-expanded', String(open));
  if (open) renderPicker();
}

function setState(code) {
  code = validCode(code);
  if (!code) return;
  state.firstVisit = false;
  openPicker(false);
  write(STORE.state, code.toLowerCase());
  if (code === state.code && state.data && (state.data.state ?? 'CO') === code) {
    history.replaceState(null, '', `#${code.toLowerCase()}`);
    return;
  }
  state.code = code;
  write(STORE.state, code.toLowerCase());
  history.replaceState(null, '', `#${code.toLowerCase()}`);
  state.selected = null;
  state.pastSeason = null;
  state.map?.destroy();
  state.map = null;
  // Show the last saved copy of this state instantly (if any), then fetch fresh data.
  state.data = read(`${STORE.data}:${code}`, null);
  setSheet('peek');
  startMap();
  render();
  load();
}

window.addEventListener('hashchange', () => {
  const code = validCode(location.hash.slice(1));
  if (code && code !== state.code) setState(code);
  else if (!code) history.replaceState(null, '', `#${state.code.toLowerCase()}`);
});

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('#state-btn')) return openPicker($('#picker').hidden);
  if (t.closest('#picker-close') || t.id === 'picker') return openPicker(false);
  // (Not [data-state]: the sheet itself uses that attribute for its height.)
  const pickState = t.closest('[data-pick-state]');
  if (pickState) return setState(pickState.dataset.pickState);
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
  if (t.closest('#filter-btn')) return openFilters($('#filters').hidden);
  const passBtn = t.closest('[data-pass]');
  if (passBtn) {
    state.pass = passBtn.dataset.pass;
    write(STORE.pass, state.pass);
    return render();
  }
  if (t.closest('[data-clear-filters]')) {
    Object.assign(state, { openOnly: false, favsOnly: false, pass: 'all' });
    [STORE.openOnly, STORE.favsOnly].forEach((k) => write(k, false));
    write(STORE.pass, 'all');
    openFilters(false);
    return render();
  }
  if (!t.closest('#filters')) openFilters(false);
  if (t.closest('#radar-play')) return state.map?.playRadar(!state.radar.playing);
  if (t.closest('#snow-btn')) return openLayers($('#layers').hidden);
  const layer = t.closest('[data-layer]');
  if (layer) {
    state.layer = layer.dataset.layer;
    write(STORE.layer, state.layer);
    state.map?.setLayer(state.layer);
    openLayers(false);
    return render();
  }
  if (!t.closest('#layers')) openLayers(false);
  if (t.closest('#panel-close')) return setPanel(false);
  if (t.closest('#panel-open')) return setPanel(true);
  if (t.closest('#info-btn')) {
    const c = $('#credits');
    c.hidden = !c.hidden;
    $('#info-btn').setAttribute('aria-expanded', String(!c.hidden));
    return;
  }
  if (t.closest('[data-theme-pick]')) return applyTheme(t.closest('[data-theme-pick]').dataset.themePick);
  if (t.closest('#updated')) return load();
});

document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-season]')) return;
  state.pastSeason = e.target.value || null;
  render();
});

for (const [id, key] of [['#f-open', 'openOnly'], ['#f-favs', 'favsOnly']]) {
  $(id).addEventListener('change', (e) => {
    state[key] = e.target.checked;
    write(STORE[key], state[key]);
    render();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#picker').hidden) openPicker(false);
  else if (state.selected) select(null);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > RELOAD_AFTER_MS) load();
});
let lastSize = [innerWidth, innerHeight];
const onResize = () => {
  // A phone's address bar sliding in and out only nudges the height: the map below stays as it is.
  const [w, h] = lastSize;
  if (innerWidth === w && Math.abs(innerHeight - h) < 120 && !WIDE.matches) return;
  lastSize = [innerWidth, innerHeight];
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

$('#credit-text').innerHTML = CREDITS;
applyTheme();
DARK.addEventListener('change', () => applyTheme());
setSheet('peek', false);
document.body.classList.toggle('panel-hidden', WIDE.matches && !state.panelOpen);
$('#panel-open').hidden = !WIDE.matches || state.panelOpen;
// Show the last copy instantly, then fetch fresh data.
if (!state.firstVisit) {
  history.replaceState(null, '', `#${state.code.toLowerCase()}`);
  write(STORE.state, state.code.toLowerCase());
} else if (location.hash) {
  history.replaceState(null, '', location.pathname);
}
state.data = read(`${STORE.data}:${state.code}`, null) ?? (state.code === 'CO' ? read(STORE.data, null) : null);
startMap();
render();
load();
$('#state-btn').hidden = !ALL_STATES;
if (ALL_STATES) loadStates().then(() => { if (state.firstVisit) openPicker(true); });
