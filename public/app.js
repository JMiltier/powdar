import { createSnowMap } from './map.js';

const DATA_URL = 'data.json';
const STORE = {
  data: 'cs:data', favs: 'cs:favs', sort: 'cs:sort', openOnly: 'cs:openOnly',
  view: 'cs:view', metric: 'cs:metric', mapView: 'cs:mapView', snowDepth: 'cs:snowDepth',
};
const RELOAD_AFTER_MS = 10 * 60_000;
const STALE_AFTER_MS = 3 * 3_600_000;

const SURFACE = {
  P: 'Powder', PDR: 'Powder', PP: 'Packed powder', 'P/PP': 'Powder & packed powder', MG: 'Machine groomed',
  MMS: 'Machine-made snow', HP: 'Hard pack', SC: 'Spring conditions', SPR: 'Spring conditions', WP: 'Wet packed',
  VC: 'Variable', LG: 'Loose granular', LSGR: 'Loose granular', FG: 'Frozen granular', WG: 'Wet granular', ICY: 'Icy',
};
// What the map can show. `steps` are the upper bounds of each colour level.
const METRICS = {
  next72: { get: (r) => r.forecast?.next72, steps: [1, 3, 6, 12], hint: 'Snow forecast for the next 3 days' },
  next7: { get: (r) => r.forecast?.next7, steps: [1, 3, 6, 12], hint: 'Snow forecast for the next 7 days' },
  new24: { get: (r) => r.report?.new24, steps: [1, 3, 6, 12], hint: 'New snow in the last 24 hours (open resorts report it)' },
  depth: { get: (r) => r.report?.depth, steps: [12, 24, 36, 60], hint: 'Base depth, mid-mountain (open resorts report it)', base: true },
  dates: { hint: 'Green = open (until closing day) · blue = opening day', dates: true },
};
// Lower comes first when sorting by opening day.
const STATE_ORDER = { open: 0, likely: 1, soon: 2, late: 3, tba: 4, done: 5 };

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
  sort: read(STORE.sort, 'snow'),
  openOnly: read(STORE.openOnly, false),
  expanded: new Set(),
  view: read(STORE.view, 'map'),
  metric: read(STORE.metric, 'next72'),
  selected: null,
  map: null,
  snowDepth: read(STORE.snowDepth, false),
};

// 0 → 0″, a dusting → <1″, otherwise whole inches.
function inches(v) {
  if (v == null) return '—';
  if (v === 0) return '0″';
  if (v < 1) return '<1″';
  return `${Math.round(v)}″`;
}

const monthDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

// "Season: Oct 28 – May 10", or as much of it as we know.
function seasonText(r, today) {
  const { open, close, when, planned } = r.dates ?? {};
  if (open && close) return `Season: ${monthDay(open)} – ${monthDay(close)}`;
  if (open) return `${open > today ? 'Opens' : 'Opened'} ${when ?? monthDay(open)}${planned ? ' (planned)' : ''} · closing day TBA`;
  if (close) return `Opening day TBA · closes ${monthDay(close)}`;
  return '';
}

// Map bubble for the Dates view.
function dateBubble(r) {
  const { state: s, date } = r.status;
  const close = r.dates?.close;
  if (s === 'open') return { text: close ? `til ${monthDay(close)}` : 'Open', level: 'open', rank: 0 };
  if (s === 'likely') return { text: 'Likely open', level: 'likely', rank: 1 };
  if (s === 'soon') return { text: r.dates?.when ?? monthDay(date), level: 'soon', rank: 2 };
  if (s === 'late') return { text: 'Delayed', level: 'late', rank: 3 };
  if (s === 'done') return { text: 'Closed', level: 'tba', rank: 5 };
  return { text: 'TBA', level: 'tba', rank: 4 };
}

const dayName = (ymd, today, style = 'short') =>
  ymd === today ? 'Today' : new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: style });

const longDay = (ymd, today) =>
  `${dayName(ymd, today, 'long')}${ymd === today ? '' : `, ${new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}`}`;

function timeAgo(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} days ago`;
}

const isOpenish = (r) => r.status.state === 'open' || r.status.state === 'likely';
const snowNext = (r) => r.forecast?.next72 ?? -1;

function sorted(resorts) {
  const list = [...resorts];
  const byName = (a, b) => a.name.localeCompare(b.name);
  if (state.sort === 'name') return list.sort(byName);
  if (state.sort === 'opening') {
    return list.sort((a, b) =>
      STATE_ORDER[a.status.state] - STATE_ORDER[b.status.state] ||
      (a.status.date ?? '9999').localeCompare(b.status.date ?? '9999') ||
      byName(a, b));
  }
  return list.sort((a, b) => snowNext(b) - snowNext(a) || (b.forecast?.next7 ?? -1) - (a.forecast?.next7 ?? -1) || byName(a, b));
}

function renderSummary(data) {
  const open = data.resorts.filter((r) => r.status.state === 'open');
  const likely = data.resorts.filter((r) => r.status.state === 'likely');
  const snowiest = [...data.resorts].sort((a, b) => snowNext(b) - snowNext(a))[0];
  const nextUp = data.resorts
    .filter((r) => r.status.state === 'soon')
    .sort((a, b) => a.status.date.localeCompare(b.status.date))[0];

  const openText = open.length
    ? `<strong>${open.length}</strong> open${likely.length ? ` <span class="muted">+ ${likely.length} likely</span>` : ''}`
    : likely.length ? `<strong>${likely.length}</strong> likely open` : 'None open yet';
  const snowText = snowiest && snowNext(snowiest) >= 1
    ? `<strong>${inches(snowiest.forecast.next72)}</strong> at ${esc(snowiest.name)}`
    : 'No big storms';

  $('#summary').innerHTML = `
    <div class="tile"><span class="tile-label">Open now</span><span class="tile-value">${openText}</span></div>
    <div class="tile"><span class="tile-label">Most snow, next 3 days</span><span class="tile-value">${snowText}</span></div>
    ${nextUp ? `<div class="tile"><span class="tile-label">Next to open</span><span class="tile-value"><strong>${esc(nextUp.name)}</strong> <span class="muted">${esc(nextUp.status.label.replace('Opens ', ''))}</span></span></div>` : ''}`;
}

const BAR_MAX_PX = 40;

// Bars share one scale across every resort, so a 10″ day always looks bigger than a 5″ one.
function bars(r, today, scale) {
  if (!r.forecast) return '<p class="muted small">Forecast unavailable right now.</p>';
  return `<div class="bars" aria-hidden="true">${r.forecast.days.map((d) => `
    <div class="bar-col">
      <span class="bar-num">${d.snow >= 1 ? Math.round(d.snow) : d.snow > 0 ? '·' : ''}</span>
      <span class="bar" style="height:${d.snow > 0 ? Math.max(3, Math.round((Math.min(d.snow, scale) / scale) * BAR_MAX_PX)) : 0}px"></span>
      <span class="bar-day">${dayName(d.date, today)}</span>
    </div>`).join('')}</div>`;
}

function details(r, today) {
  const rows = r.forecast?.days.map((d) => `
    <tr><th scope="row">${esc(longDay(d.date, today))}</th>
      <td class="${d.snow >= 1 ? 'snowy' : ''}">${d.snow > 0 ? `❄ ${inches(d.snow)}` : '—'}</td>
      <td>${d.hi ?? '–'}° / ${d.lo ?? '–'}°</td></tr>`).join('') ?? '';
  const rep = r.report;
  const repBits = rep ? [
    `New snow: <strong>${inches(rep.new24)}</strong> in 24 hrs, <strong>${inches(rep.new48)}</strong> in 48 hrs`,
    rep.depth != null ? `Base (mid-mountain): <strong>${rep.depth}″</strong>` : '',
    rep.surface ? `Surface: ${esc(SURFACE[rep.surface] ?? rep.surface)}` : '',
    rep.updated ? `<span class="muted">Resort report ${esc(timeAgo(rep.updated))}</span>` : '',
  ].filter(Boolean).map((b) => `<li>${b}</li>`).join('') : '';
  return `
    <div class="details">
      ${repBits ? `<ul class="report">${repBits}</ul>` : ''}
      ${rows ? `<table class="days"><caption>7-day forecast (high / low °F)</caption><tbody>${rows}</tbody></table>` : ''}
      <a class="site" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)} website ↗</a>
    </div>`;
}

function card(r, today, scale) {
  const fav = state.favs.has(r.id);
  const n72 = r.forecast?.next72;
  const third = r.report
    ? `<div class="stat"><span class="stat-num">${inches(r.report.new24)}</span><span class="stat-label">last 24 hrs</span></div>`
    : `<div class="stat"><span class="stat-num muted">—</span><span class="stat-label">${r.live ? 'not reporting' : 'no live report'}</span></div>`;
  return `
    <details class="card" data-id="${esc(r.id)}" ${state.expanded.has(r.id) ? 'open' : ''}>
      <summary>
        <div class="card-head">
          <button type="button" class="star" data-fav="${esc(r.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Unpin' : 'Pin'} ${esc(r.name)}">${fav ? '★' : '☆'}</button>
          <div class="names">
            <h3>${esc(r.name)}</h3>
            <p class="sub">${esc(r.region)}${r.status.detail ? ` · ${esc(r.status.detail)}` : ''}</p>
            ${seasonText(r, today) ? `<p class="season">${esc(seasonText(r, today))}</p>` : ''}
          </div>
          <span class="pill pill-${esc(r.status.state)}">${esc(r.status.label)}</span>
        </div>
        <div class="stats">
          <div class="stat ${n72 >= 3 ? 'stat-hot' : ''}"><span class="stat-num">${inches(n72)}</span><span class="stat-label">next 3 days</span></div>
          <div class="stat"><span class="stat-num">${inches(r.forecast?.next7)}</span><span class="stat-label">next 7 days</span></div>
          ${third}
        </div>
        ${bars(r, today, scale)}
      </summary>
      ${details(r, today)}
    </details>`;
}

function render() {
  const data = state.data;
  if (!data) return;
  const today = data.today;
  const scale = Math.max(4, ...data.resorts.flatMap((r) => r.forecast?.days.map((d) => d.snow) ?? [0]));

  renderSummary(data);
  const visible = sorted(data.resorts).filter((r) => !state.openOnly || isOpenish(r));
  const favs = visible.filter((r) => state.favs.has(r.id));
  const rest = visible.filter((r) => !state.favs.has(r.id));

  $('#favorites').hidden = favs.length === 0;
  $('#fav-list').innerHTML = favs.map((r) => card(r, today, scale)).join('');
  $('#all-title').textContent = favs.length ? 'Other resorts' : state.openOnly ? 'Open resorts' : 'All resorts';
  $('#list').innerHTML = rest.map((r) => card(r, today, scale)).join('') ||
    '<p class="empty">No resorts are open yet. Turn off “Open only” to see opening days.</p>';

  document.querySelectorAll('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === state.sort)));
  $('#open-only').checked = state.openOnly;
  $('#updated').textContent = `Updated ${timeAgo(data.generated)}`;
  renderMap();
}

function level(value, steps) {
  if (value == null) return 'none';
  if (value === 0) return 0;
  const i = steps.findIndex((s) => value < s);
  return i === -1 ? steps.length + 1 : i + 1;
}

function renderMap() {
  const data = state.data;
  document.querySelectorAll('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric)));
  if (state.view !== 'map' || !data) return;
  if (!state.map) {
    state.map = createSnowMap($('#map'), {
      saved: read(STORE.mapView, null),
      onMove: (v) => write(STORE.mapView, v),
      onZoom: () => renderHint(),
      onSelect: (id) => {
        state.selected = id;
        renderMap();
      },
    });
    state.map.setSnowDepth(state.snowDepth);
  }
  $('#snow-toggle').setAttribute('aria-pressed', String(state.snowDepth));
  $('#snow-legend').hidden = !state.snowDepth;
  $('#map').classList.toggle('snow-on', state.snowDepth);
  const metric = METRICS[state.metric] ?? METRICS.next72;
  const items = data.resorts.map((r) => {
    const base = { r, open: r.status.state === 'open', selected: r.id === state.selected, fav: state.favs.has(r.id) };
    if (metric.dates) {
      const b = dateBubble(r);
      // Open resorts first, then the soonest opening days.
      const daysOut = r.status.date ? (Date.parse(r.status.date) - Date.parse(data.today)) / 864e5 : 0;
      return { ...base, text: b.text, label: b.text, level: b.level, sortKey: -b.rank * 1e4 - daysOut };
    }
    const value = metric.get(r) ?? null;
    const text = value == null ? '–' : metric.base ? `${Math.round(value)}″` : inches(value);
    return { ...base, text, label: value == null ? 'not reported' : text, level: level(value, metric.steps), sortKey: value ?? -1 };
  });
  // Most important first (pinned, then open resorts), so they win the space on a crowded map.
  items.sort((a, b) => b.selected - a.selected || b.fav - a.fav || b.open - a.open || b.sortKey - a.sortKey);
  state.map.update(items);
  renderHint();

  const r = data.resorts.find((x) => x.id === state.selected);
  $('#sheet').hidden = !r;
  if (r) {
    const scale = Math.max(4, ...data.resorts.flatMap((x) => x.forecast?.days.map((d) => d.snow) ?? [0]));
    $('#sheet-body').innerHTML = card(r, data.today, scale);
  }
}

function renderHint() {
  const data = state.data;
  if (!data || !state.map) return;
  const metric = METRICS[state.metric] ?? METRICS.next72;
  const parts = [metric.hint];
  if (metric.get) {
    const reporting = data.resorts.filter((r) => metric.get(r) != null).length;
    if (reporting < data.resorts.length) parts.push(`${reporting} of ${data.resorts.length} resorts`);
  }
  if (!metric.dates) parts.push('green ring = open');
  const hidden = state.map.hiddenCount();
  if (!state.map.namesShown()) parts.push('zoom in for names');
  else if (hidden) parts.push(`zoom in to see ${hidden} more`);
  $('#map-hint').textContent = parts.join(' · ');
}

// The map fills the screen under the header, whose height changes with the notice line.
function sizeMap() {
  document.documentElement.style.setProperty('--header-h', `${$('.top').offsetHeight}px`);
  state.map?.resize();
}

function setView(view) {
  state.view = view;
  write(STORE.view, view);
  document.body.classList.toggle('map-mode', view === 'map');
  $('#map-view').hidden = view !== 'map';
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  if (view === 'map') {
    renderMap();
    sizeMap();
  } else {
    window.scrollTo(0, 0);
  }
}

function showNotice(text) {
  const el = $('#notice');
  el.hidden = !text;
  el.textContent = text ?? '';
  sizeMap();
}

async function load() {
  const btn = $('#refresh');
  btn.classList.add('spinning');
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
    state.loadedAt = Date.now();
    write(STORE.data, state.data);
    const age = Date.now() - Date.parse(state.data.generated);
    const partial = !state.data.sources.coloradoSki
      ? 'Live open status is unavailable right now. Showing forecasts only.'
      : null;
    showNotice(age > STALE_AFTER_MS ? `Heads up: this data is ${timeAgo(state.data.generated).replace(' ago', '')} old.` : partial);
  } catch {
    const saved = read(STORE.data, null);
    if (saved) {
      state.data = saved;
      showNotice(`You're offline. Showing data from ${timeAgo(saved.generated)}.`);
    } else {
      showNotice("Couldn't load snow data. Check your connection and tap ↻.");
      $('#updated').textContent = '';
    }
  } finally {
    btn.classList.remove('spinning');
    render();
  }
}

document.addEventListener('click', (e) => {
  const star = e.target.closest('[data-fav]');
  if (star) {
    e.preventDefault(); // don't also open/close the card
    const id = star.dataset.fav;
    state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
    write(STORE.favs, [...state.favs]);
    render();
    return;
  }
  const sortBtn = e.target.closest('[data-sort]');
  if (sortBtn) {
    state.sort = sortBtn.dataset.sort;
    write(STORE.sort, state.sort);
    render();
    return;
  }
  const viewBtn = e.target.closest('[data-view]');
  if (viewBtn) {
    setView(viewBtn.dataset.view);
    return;
  }
  const metricBtn = e.target.closest('[data-metric]');
  if (metricBtn) {
    state.metric = metricBtn.dataset.metric;
    write(STORE.metric, state.metric);
    renderMap();
    return;
  }
  if (e.target.closest('#snow-toggle')) {
    state.snowDepth = !state.snowDepth;
    write(STORE.snowDepth, state.snowDepth);
    state.map?.setSnowDepth(state.snowDepth);
    renderMap();
    return;
  }
  if (e.target.closest('#sheet-close')) {
    state.selected = null;
    renderMap();
  }
});

// Remember which cards are open so a re-render doesn't collapse them.
document.addEventListener('toggle', (e) => {
  const id = e.target.dataset?.id;
  if (!id) return;
  e.target.open ? state.expanded.add(id) : state.expanded.delete(id);
}, true);

$('#open-only').addEventListener('change', (e) => {
  state.openOnly = e.target.checked;
  write(STORE.openOnly, state.openOnly);
  render();
});
$('#refresh').addEventListener('click', load);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > RELOAD_AFTER_MS) load();
});

window.addEventListener('resize', sizeMap);

// Show the last copy instantly, then fetch fresh data.
state.data = read(STORE.data, null);
setView(state.view === 'list' ? 'list' : 'map');
render();
load();
