import { createSnowMap, CREDITS } from './map.js?v=__V__';

const DATA_URL = 'data.json';
const STORE = {
  data: 'cs:data', favs: 'cs:favs', metric: 'cs:metric', home: 'cs:home', snowDepth: 'cs:snowDepth', openOnly: 'cs:openOnly',
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
  nws: 'National Weather Service', ecmwf_ifs025: 'European', gfs_seamless: 'American', gem_seamless: 'Canadian', icon_seamless: 'German',
};

// What the map and list show. `steps` are the upper bounds of each colour level.
const METRICS = {
  // The resort's own report when it has one, otherwise the weather models' estimate.
  new24: {
    kind: 'snow', get: (r) => r.report?.new24 ?? r.forecast?.past24, est: (r) => r.report?.new24 == null && r.forecast?.past24 != null,
    steps: [1, 3, 6, 12], top: 'Most new snow, last 24 hrs',
  },
  next72: { kind: 'snow', get: (r) => r.forecast?.next72, range: (r) => r.forecast?.next72Range, steps: [1, 3, 6, 12], top: 'Most snow, next 3 days' },
  next7: { kind: 'snow', get: (r) => r.forecast?.next7, range: (r) => r.forecast?.next7Range, steps: [1, 3, 6, 12], top: 'Most snow, next 7 days' },
  depth: { kind: 'base', get: (r) => r.report?.depth, steps: [12, 24, 36, 60], top: 'Deepest base' },
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
  snowDepth: read(STORE.snowDepth, false),
  selected: null,
  sheet: 'peek',
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
  const v = m.get(r) ?? null;
  return {
    text: v == null ? '–' : m.kind === 'base' ? `${Math.round(v)}″` : inches(v),
    sub: m.est?.(r) ? (v >= 0.5 ? 'est.' : '') : m.range ? rangeText(m.range(r)) : '',
    level: level(v, m.steps),
    sort: v ?? -1,
  };
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
    if (m.kind === 'base') {
      const n = data.resorts.filter((r) => m.get(r) != null).length;
      text = v ? `${m.top}: <strong>${esc(best.name)} ${Math.round(v)}″</strong> · ${n} resorts reporting` : 'No base reports yet: resorts report once open';
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
        <span class="day-temp">${d.hi ?? '–'}°<i>${d.lo ?? '–'}°</i></span>
      </div>`).join('')}
    </div>` : '<p class="muted">Forecast unavailable right now.</p>';

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
    ${report}
    ${sources.length > 1 ? `<p class="muted small">Forecast blends ${sources.length} sources: ${esc(sources.join(', '))}. Big number = middle forecast, small = likely range.</p>` : ''}
    <a class="site" href="${esc(r.url)}" target="_blank" rel="noopener">Official ${esc(r.name)} site ↗</a>`;
}

function renderMap() {
  if (!state.map) return;
  const items = ordered().map(({ r, v }) => {
    const selected = r.id === state.selected;
    const fav = state.favs.has(r.id);
    const open = r.status.state === 'open';
    return {
      r, text: v.text, label: v.text, level: v.level, selected,
      open: open && METRICS[state.metric].kind !== 'dates',
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

// Pixels of map the panels cover. Fitting plans for the collapsed sheet; centring a resort uses
// the sheet's current height so the resort lands in the part of the map you can see.
function coveredPadding(current = false) {
  const top = $('.top').getBoundingClientRect().bottom;
  if (WIDE.matches) return { top, left: sheetEl.offsetWidth + 24, right: 0, bottom: 0 };
  return { top, left: 0, right: 0, bottom: current ? sheetEl.offsetHeight - sheetY : sheetSizes().visible.peek };
}

function setSheetY(y, animate) {
  sheetY = y;
  sheetEl.classList.toggle('dragging', !animate);
  sheetEl.style.transform = WIDE.matches ? '' : `translateY(${y}px)`;
  const visible = WIDE.matches ? 0 : sheetEl.offsetHeight - y;
  document.documentElement.style.setProperty('--sheet-visible', `${visible}px`);
}

function setSheet(name, animate = true) {
  state.sheet = name;
  sheetEl.dataset.state = name;
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

function select(id, { pan = true } = {}) {
  state.selected = id;
  render();
  $('#sheet-body').scrollTop = 0;
  if (!id) return;
  if (state.sheet === 'peek' || state.sheet === 'full') setSheet('half');
  const r = state.data.resorts.find((x) => x.id === id);
  if (pan && r) requestAnimationFrame(() => state.map?.focus(r));
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
    home: read(STORE.home, null),
    getPadding: coveredPadding,
    onSelect: (id) => select(id, { pan: false }),
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
    return render();
  }
  if (t.closest('#home-btn')) {
    if (!state.map) return;
    write(STORE.home, state.map.getView());
    return toast('Saved: the map will open here from now on');
  }
  if (t.closest('#info-btn')) {
    const c = $('#credits');
    c.hidden = !c.hidden;
    $('#info-btn').setAttribute('aria-expanded', String(!c.hidden));
    return;
  }
  if (t.closest('#updated')) return load();
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
  state.map?.resize();
};
window.addEventListener('resize', onResize);
WIDE.addEventListener('change', onResize);

$('#credits').innerHTML = CREDITS;
setSheet('peek', false);
// Show the last copy instantly, then fetch fresh data.
state.data = read(STORE.data, null);
startMap();
render();
load();
