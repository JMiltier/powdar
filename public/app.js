import { createSnowMap, CREDITS, satTile, SNOW_RAMP, SNOW_COLOR, CAST_AMOUNTS } from './map.js?v=__V__';
import { weatherIcon, UI } from './icons.js?v=__V__';

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
  data: 'cs:data', favs: 'cs:favs', metric: 'cs:metric', snowDepth: 'cs:snowCover', layer: 'cs:layer', openOnly: 'cs:openOnly', favsOnly: 'cs:favsOnly', pass: 'cs:pass', sort: 'cs:sort', order: 'cs:order', unit: 'cs:unit', snowStyle: 'cs:snowStyle2', panel: 'cs:panel',
  state: 'cs:state', states: 'cs:states', theme: 'cs:theme',
};
const RELOAD_AFTER_MS = 10 * 60_000;
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
  // Two weeks: the 7-day forecast plus days 8–14 (only the models that reach that far; rougher).
  next14: {
    kind: 'snow', get: (r) => (r.forecast?.week2 && r.forecast.next7 != null ? r.forecast.next7 + r.forecast.week2.mid : null),
    range: (r) => (r.forecast?.week2 && r.forecast.next7Range ? [r.forecast.next7Range[0] + r.forecast.week2.range[0], r.forecast.next7Range[1] + r.forecast.week2.range[1]] : null),
    steps: [2, 6, 12, 24], top: 'Most snow, next 14 days',
  },
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
// The address says what's open, so it can be shared: #co (the list), #co/keystone (a resort),
// #co/colorado (the state overview).
const routeParts = () => decodeURIComponent(location.hash.slice(1)).toLowerCase().split('/');
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
  snowStyle: read(STORE.snowStyle, 'color'), // how snow on the ground is drawn (tap its key to cycle)
  unit: read(STORE.unit, 'F'), // temperatures in 'F' or 'C' (the data is always °F)
  sort: read(STORE.sort, 'name'),
  order: read(STORE.order, []), // the user's own order (sort "mine"), resort ids // the list: 'name' (A–Z), 'value' (the map view's number) or 'open'
  // The map overlay: 'snow' (on the ground; the default), 'radar', 'outlook' or 'none'.
  layer: read(STORE.layer, null) ?? (read(STORE.snowDepth, true) ? 'snow' : 'none'),
  outlookSeason: null, // e.g. "NDJ 2026-2027", once the outlook has loaded
  radar: { time: null, playing: false, count: 0 }, // the radar loop's current frame
  cast: { day: 1, amount: 4, areas: null }, // the snow forecast's period and amount
  openDay: null, // the forecast day opened in a resort's page (YYYY-MM-DD)
  satDate: null, // the satellite views' day (YYYY-MM-DD), newest real one by default
  satLatest: null,
  selected: null,
  sheet: 'peek',
  pastSeason: null, // a past season like '2024-25' to show in the season chart, or null for this one
  panelOpen: read(STORE.panel, true), // wide screens: the resort list on the left
  map: null,
  // Which state: from the address, else the one picked last time on this device. A first-time visitor
  // gets the state picker (Colorado shows behind it).
  code: validCode(routeParts()[0]) ?? validCode(read(STORE.state, null)) ?? 'CO',
  firstVisit: ALL_STATES && !validCode(routeParts()[0]) && !validCode(read(STORE.state, null)),
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

// ---------- map view ----------
// Satellite views ('sat', 'satsnow') are a background photo with no overlay; the rest are an overlay
// on the shaded relief.
const SAT_VIEWS = ['sat', 'satsnow'];
const isoDay = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => isoDay(new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5));
// The newest day with a real picture: today's (UTC) once the satellite has passed over Colorado
// (early afternoon), else yesterday's. An empty day's tile is a tiny all-black image.
async function latestSatDay() {
  const today = isoDay(new Date());
  try {
    const url = satTile('sat', today).replace('{z}/{y}/{x}', '7/48/26');
    const res = await fetch(url);
    if (res.ok && (await res.blob()).size > 6000) return today;
  } catch { /* fall through */ }
  return addDays(today, -1);
}
async function applyLayer() {
  if (!state.map) return;
  if (SAT_VIEWS.includes(state.layer)) {
    state.map.setLayer('none');
    if (!state.satLatest) {
      state.satLatest = await latestSatDay();
      state.satDate ??= state.satLatest;
      render();
    }
    state.map.setBase(state.layer, state.satDate);
  } else {
    state.map.setBase('terrain');
    state.map.setSnowStyle(state.snowStyle);
    state.map.setLayer(state.layer);
  }
}
function stepSatDay(n) {
  const next = addDays(state.satDate, n);
  if (next > state.satLatest || next < addDays(state.satLatest, -30)) return;
  state.satDate = next;
  state.map?.setBase(state.layer, next);
  render();
}
const satDayText = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Latest');

// ---------- map overlay ----------

// Pop-up menus close as soon as you touch anywhere else, scroll the list or drag the panel (a scroll
// or drag isn't a click, so they used to stay open, floating over the list).
const POPUPS = [['#filters', '#filter-btn', () => openFilters(false)], ['#layers', '#snow-btn', () => openLayers(false)],
  ['#credits', '#info-btn', () => { $('#credits').hidden = true; $('#info-btn').setAttribute('aria-expanded', 'false'); }]];
function closePopups(except) {
  for (const [pop, , close] of POPUPS) if (pop !== except && !$(pop).hidden) close();
}
document.addEventListener('pointerdown', (e) => {
  for (const [pop, btn, close] of POPUPS) {
    if (!$(pop).hidden && !e.target.closest(`${pop}, ${btn}`)) close();
  }
}, true);
$('#sheet-body').addEventListener('scroll', () => closePopups(), { passive: true });
$('#grab').addEventListener('pointerdown', (e) => { if (!e.target.closest('#filter-btn')) closePopups(); });

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

const SNOW_STYLES = ['color', 'shaded', 'volume', 'contours'];
const SNOW_STYLE_NAMES = { color: 'Colors', shaded: 'Shaded', volume: 'Volume', contours: 'Contours' };

// The key along the bottom of the map, for whichever overlay is showing.
function legendFor(layer) {
  if (SAT_VIEWS.includes(layer)) {
    const newest = state.satDate && state.satDate >= state.satLatest;
    return `<button type="button" class="day-step" data-sat-step="-1" aria-label="Day before">‹</button>
      <span class="radar-time">${esc(satDayText(state.satDate))}</span>
      <button type="button" class="day-step" data-sat-step="1" aria-label="Day after" ${newest ? 'disabled' : ''}>›</button>
      <span class="legend-keys">${layer === 'satsnow' ? '<i class="sw-mini sw-cyan"></i><span>Snow</span><i class="sw-mini sw-white"></i><span>Cloud</span>' : '<span>NASA satellite photo</span>'}</span>`;
  }
  if (layer === 'snowcast') {
    const { day, amount, areas } = state.cast;
    const period = ['Next 24h', '24–48h', '48–72h'][day - 1];
    return `<button type="button" class="day-step" data-cast-day="-1" aria-label="Earlier" ${day <= 1 ? 'disabled' : ''}>‹</button>
      <span class="radar-time">${period}</span>
      <button type="button" class="day-step" data-cast-day="1" aria-label="Later" ${day >= 3 ? 'disabled' : ''}>›</button>
      <button type="button" class="snow-style" data-cast-amount aria-label="Chance of at least ${amount} inches; tap for another amount">${amount}″+<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 0 1 8.6-3.5M13 8a5 5 0 0 1-8.6 3.5M11.5 2v2.7H8.8M4.5 14v-2.7h2.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <span class="legend-keys cast-key">${areas === 0 ? '<span class="muted">None expected</span>' : '<i class="c1"></i><i class="c2"></i><i class="c3"></i><span>10% → 70%+</span>'}</span>`;
  }
  if (layer === 'radar') {
    return `<button type="button" class="radar-play" id="radar-play" aria-label="Play the last hour" ${state.radar.count > 1 ? '' : 'disabled'}>${state.radar.playing ? PAUSE_ICON : PLAY_ICON}</button>
      <span class="radar-time" id="radar-time">${radarTimeText()}</span>
      <span class="legend-keys"><span>Light</span><i class="ramp ramp-radar" aria-hidden="true"></i><span>Heavy</span></span>`;
  }
  if (layer === 'outlook') {
    return `<span class="legend-title">${esc(seasonSpan(state.outlookSeason))} outlook</span><span class="legend-keys"><span>Drier</span><i class="ramp ramp-outlook" aria-hidden="true"></i><span>Wetter</span><span class="muted">· ${esc(seasonSpan(state.outlookSeason))}</span></span>`;
  }
  // The style's name (tap to cycle), then labeled depth steps colored as the map draws them.
  const ramp = state.snowStyle === 'color' ? SNOW_COLOR : SNOW_RAMP;
  const step = (cls, label) => {
    const [r, g, b, a] = ramp[cls];
    return `<span class="depth-step"><i style="background:linear-gradient(rgba(${r},${g},${b},${(a / 255).toFixed(2)}),rgba(${r},${g},${b},${(a / 255).toFixed(2)})),#6f7886"></i>${label}</span>`;
  };
  const next = SNOW_STYLES[(SNOW_STYLES.indexOf(state.snowStyle) + 1) % SNOW_STYLES.length];
  return `<button type="button" class="snow-style" data-snow-cycle aria-label="Snow drawn as: ${SNOW_STYLE_NAMES[state.snowStyle]}. Tap for ${SNOW_STYLE_NAMES[next]}.">${SNOW_STYLE_NAMES[state.snowStyle]}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 0 1 8.6-3.5M13 8a5 5 0 0 1-8.6 3.5M11.5 2v2.7H8.8M4.5 14v-2.7h2.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <span class="legend-keys depth-steps">${step(0, '1″')}${step(2, '4″')}${step(3, '1′')}${step(4, '2′')}${step(6, '5′')}${step(7, '8′+')}</span>`;
}

// ---------- webcams ----------
// A swipeable strip of each resort's cams (current stills, refreshed every few minutes); tap one for a
// full-size view with a link to the live camera or the resort's cam page.
const CAM_EVERY_MS = 120000;
const camBucket = () => Math.floor(Date.now() / CAM_EVERY_MS); // a fresh frame every 2 minutes
const camSrc = (url) => `${url}${url.includes('?') ? '&' : '?'}t=${camBucket()}`;
function camsSection(r, notes) {
  const c = r.cams;
  if (!c) return '';
  // No stills: live video streams (or just the resort's cam page) as buttons that open them.
  if (!c.cams?.length) {
    const links = c.video?.length ? c.video : c.page ? [{ name: 'Resort cams', live: c.page }] : [];
    if (!links.length) return '';
    notes.push(`Webcams: ${sourceLink(c.page ?? links[0].live, `${r.name}’s cams`)} (live video).`);
    return `
    <h3 class="section">Cams <span class="section-note">live video on the resort's player</span></h3>
    <div class="cam-links">${links.map((v) => `<a class="cam-link" href="${esc(v.live)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>${esc(v.name)}</a>`).join('')}</div>`;
  }
  notes.push(`Webcams: ${sourceLink(c.page, `${r.name}’s cams`)}, refreshed every couple of minutes while open.`);
  // The snow stake first: the quickest read of how much fell.
  const order = c.cams.map((cam, i) => i).sort((a, b) => /stake/i.test(c.cams[b].name) - /stake/i.test(c.cams[a].name));
  return `
    <h3 class="section">Cams <span class="section-note">latest from the mountain</span></h3>
    <div class="cams" role="list">${order.map((i) => [c.cams[i], i]).map(([cam, i]) => `
      <button type="button" class="cam" role="listitem" data-cam="${i}" aria-label="${esc(cam.name)} webcam">
        <img src="${esc(camSrc(cam.image))}" alt="" loading="lazy" decoding="async" onerror="this.closest('.cam').hidden = true">
        <span>${esc(cam.name)}</span>
        <em class="cam-age" data-cam-age="${i}">${cam.updated ? esc(shortAgo(cam.updated)) : ''}</em>
      </button>`).join('')}
    </div>`;
}
// "5 min ago" / "2 hr ago" (short, for a badge).
const shortAgo = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} days ago`;
};
// For cameras with a real "taken at" time, read it straight from the camera's server where it allows
// (fresher than the update's note of it).
function refreshCamAges(r) {
  r.cams?.cams?.forEach((cam, i) => {
    fetch(camSrc(cam.image), { method: 'HEAD', cache: 'no-store' }).then((res) => {
      const lm = res.ok && res.headers.get('last-modified');
      // (A "modified" time of right now is made up by the server, not when the picture was taken.)
      if (!lm || Math.abs(Date.now() - Date.parse(lm)) < 15000) return;
      cam.updated = new Date(lm).toISOString();
      const el = document.querySelector(`[data-cam-age="${i}"]`);
      if (el && state.selected === r.id) el.textContent = shortAgo(cam.updated);
    }).catch(() => {});
  });
}
// While a resort's cams are on screen, swap in the newest frames every couple of minutes (each loads
// in the background first, so a picture never blanks), and re-read when they were taken.
let camBucketShown = camBucket();
setInterval(() => {
  if (document.visibilityState !== 'visible' || camBucket() === camBucketShown) return;
  camBucketShown = camBucket();
  const r = state.data?.resorts.find((x) => x.id === state.selected);
  if (!r?.cams?.cams?.length) return;
  for (const img of document.querySelectorAll('.cam img, #cam-view img')) {
    const next = img.src.replace(/([?&])t=\d+/, `$1t=${camBucketShown}`);
    if (next === img.src) continue;
    const pre = new Image();
    pre.onload = () => { img.src = next; };
    pre.src = next;
  }
  refreshCamAges(r);
}, 20000);
function openCam(r, i) {
  const c = r.cams?.cams?.[i];
  if (!c) return;
  const box = $('#cam-view');
  box.innerHTML = `
    <div class="cam-view-inner">
      <img src="${esc(camSrc(c.image))}" alt="${esc(`${r.name}: ${c.name} webcam`)}">
      <div class="cam-view-bar">
        <span><b>${esc(r.name)}</b> · ${esc(c.name)}${c.updated ? ` · ${esc(shortAgo(c.updated))}` : ''}</span>
        <span>${c.live ? `<a href="${esc(c.live)}" target="_blank" rel="noopener">Live video${EXT_ICON}</a>` : ''}
          <a href="${esc(r.cams.page)}" target="_blank" rel="noopener">All cams${EXT_ICON}</a></span>
      </div>
      <button type="button" class="cam-close" data-cam-close aria-label="Close">×</button>
    </div>`;
  box.hidden = false;
  // A step in the history too: the back gesture closes the cam, not the page.
  if (!history.state?.cam) history.pushState({ ...history.state, cam: true }, '', location.hash);
}
function closeCam() {
  if (history.state?.cam) return history.back(); // (followRoute hides it)
  $('#cam-view').hidden = true;
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
  // Base at an open resort that doesn't report one (Vail Resorts' mountains): NOAA's natural snow
  // says ~0 while the resort skis on machine-made snow, so say "not reported" rather than 0″.
  if (m.kind === 'base' && r.report?.depth == null && isOpenish(r) && (r.noaa?.depth ?? 0) < 6) {
    return { text: '–', sub: 'not reported', level: 'tba', sort: -0.5 };
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

// Buttons depend on what the state has: Dates only where opening dates exist (Colorado); Season where
// there are snow stations, NOAA snow Depth where there aren't.
function availableMetrics() {
  const rs = state.data?.resorts ?? [];
  const hasDates = rs.some((r) => r.dates?.open || r.dates?.close);
  const hasStations = rs.some((r) => r.station);
  return ['new24', 'next72', 'next7', 'next14', 'base', ...(hasStations ? ['season'] : []), ...(hasDates ? ['dates'] : [])];
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
    // A–Z unless asked otherwise; favorites and filters never reorder anything.
    .sort((a, b) => (state.sort === 'value' ? b.v.sort - a.v.sort : state.sort === 'open' ? openRank(b.r) - openRank(a.r)
      : state.sort === 'mine' ? myRank(a.r) - myRank(b.r) : 0)
      || a.r.name.localeCompare(b.r.name));
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
      const quiet = { new24: 'No new snow in the last 24 hrs', next72: 'No real snow in the next 3 days', next7: 'No real snow in the next 7 days', next14: 'No real snow in the next 14 days' };
      text = v >= 1 ? `${m.top}: <strong>${esc(best.name)} ${inches(v)}</strong>` : quiet[state.metric];
    }
  }
  // When the data is from rides along at the end (tap it to refresh, as the old "Updated" line did).
  $('#headline').innerHTML = `${text} <button type="button" class="when" data-refresh title="Refresh now" aria-label="Updated ${esc(timeAgo(data.generated))}. Refresh now">· <span class="when-text">${esc(timeAgo(data.generated))}</span><svg class="refresh-ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
}

// "Open · 3 of 24 lifts · 2% of runs", "Opens Fri, Nov 20", …
// "Mine": the user's order (resorts they haven't placed yet go last, A–Z).
const myRank = (r) => { const i = state.order.indexOf(r.id); return i < 0 ? 1e6 : i; };

// Open first: open, then probably open, opening soon (soonest first), then the rest.
function openRank(r) {
  const s = r.status.state;
  if (s === 'open') return 4;
  if (s === 'likely') return 3;
  if (s === 'soon') return 2 - (r.status.date ? Date.parse(r.status.date) / 1e14 : 0.5);
  return 0;
}

// Short status for a card's pill: "Open", "Opens Nov 21", "TBA"…
function shortStatus(r) {
  const s = r.status;
  if (s.state === 'open') return 'Open';
  if (s.state === 'likely') return 'Open?';
  if (s.state === 'soon') return s.label.replace(/^Opens (\w{3}, )?/, 'Opens ');
  if (s.state === 'late') return 'Delayed';
  if (s.state === 'done') return 'Closed';
  return 'Opens TBA';
}
const METRIC_LABEL = { new24: 'Most −24h', next72: 'Most +3d', next7: 'Most +7d', next14: 'Most +14d', base: 'Deepest', season: 'Snowpack', dates: 'Opening' };

function rowSub(r) {
  const s = r.status;
  if (s.state !== 'open') return s.label;
  const lifts = r.report?.lifts;
  return ['Open', lifts?.total ? `${lifts.open} of ${lifts.total} lifts` : null, s.pct != null ? `${s.pct}% of runs` : null].filter(Boolean).join(' · ');
}

// Snow by day, like a ski app's list but both ways: the last 5 days (what fell, model estimates; the
// resort's own report for the last 24 hours where it has one), today, and the next 4 (forecast), as
// small bars with day letters and the inches above any bar with an inch or more.
function miniDays(r) {
  const f = r.forecast;
  const future = (f?.days ?? []).slice(0, 5);
  if (!future.length) return '';
  const past = (f.pastDays ?? []).slice(-5);
  const yesterday = past.at(-1);
  if (yesterday && r.report?.new24 != null) yesterday.snow = r.report.new24; // (the resort's own number)
  const all = [...past, ...future].map((d) => d.snow ?? 0);
  const max = Math.max(4, ...all);
  const bar = (d, kind) => {
    const v = d.snow ?? 0;
    const h = v > 0.2 ? Math.max(4, Math.round((v / max) * 16)) : 3;
    const letter = new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' });
    return `<span class="rd ${kind}${v > 0.2 ? ' snow' : ''}"><em>${v >= 1 ? `${Math.round(v)}″` : ''}</em><i style="height:${h}px"></i><small>${esc(letter)}</small></span>`;
  };
  const label = (d) => `${weekday(d.date, state.data.today)} ${d.snow >= 0.5 ? inches(d.snow) : 'none'}`;
  // One row: the last 5 days, today (highlighted), the next 4.
  return `<span class="rr-days" aria-label="Last 5 days: ${past.map(label).join(', ')}. Today and the next 4: ${future.map(label).join(', ')}">${
    past.map((d) => bar(d, 'past')).join('')}${future.map((d, i) => bar(d, i === 0 ? 'next today' : 'next')).join('')}</span>`;
}

// Each resort as a card: status, then the numbers that matter side by side (the map's current view
// highlighted).
const CARD_STATS = [['new24', '−24h'], ['next72', '+3d'], ['next7', '+7d'], ['base', 'Base'], ['season', 'Pack\u202f%']];
function cardSub(r) {
  const s = r.status;
  const lifts = r.report?.lifts ?? (r.lifts?.total ? { open: r.lifts.open, total: r.lifts.total } : null);
  const parts = s.state === 'open'
    ? [lifts?.total ? `${lifts.open}/${lifts.total} lifts` : null, r.report?.trails?.total ? `${r.report.trails.open}/${r.report.trails.total} runs` : null]
    : [seasonText(r, state.data.today) || null];
  return [...parts, PASS_NAMES[passOf(r)] !== 'Other' ? PASS_NAMES[passOf(r)] : null].filter(Boolean).join(' · ');
}
function renderList() {
  const views = availableMetrics();
  const sortBar = `
    <div class="list-tools" role="group" aria-label="Sort resorts">
      <span>Sort</span>
      <button type="button" data-sort="name" aria-pressed="${state.sort === 'name'}">A–Z</button>
      <button type="button" data-sort="value" aria-pressed="${state.sort === 'value'}">${esc(METRIC_LABEL[state.metric] ?? 'Value')}</button>
      <button type="button" data-sort="open" aria-pressed="${state.sort === 'open'}">Open first</button>
      <button type="button" data-sort="mine" aria-pressed="${state.sort === 'mine'}">Mine</button>
    </div>`;
  const rows = ordered().map(({ r }) => {
    const fav = state.favs.has(r.id);
    const open = r.status.state === 'open';
    const head = `
      <span class="rr-head">
        <span class="dot dot-${esc(r.status.state)}" aria-hidden="true"></span>
        <span class="row-name">${esc(r.name)}</span>${fav ? `<span class="card-fav" aria-label="Favorite">${UI.starFilled}</span>` : ''}
        <span class="pill pill-${esc(r.status.state)}">${esc(shortStatus(r))}</span>
        ${state.sort === 'mine' ? `<span class="drag-handle" aria-label="Drag to move ${esc(r.name)}" role="button"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.4"/><circle cx="10.5" cy="3.5" r="1.4"/><circle cx="5.5" cy="8" r="1.4"/><circle cx="10.5" cy="8" r="1.4"/><circle cx="5.5" cy="12.5" r="1.4"/><circle cx="10.5" cy="12.5" r="1.4"/></svg></span>` : ''}
      </span>`;
    if (!open) {
      return `
    <button type="button" class="row rrow rrow-closed" data-open="${esc(r.id)}">
      ${head}
      <span class="rr-main">${miniDays(r)}</span>
    </button>`;
    }
    const lifts = r.report?.lifts?.total ? r.report.lifts : r.lifts?.total ? r.lifts : null;
    // The first number follows the map's view (highlighted); then base and lifts.
    const lead = ['dates', 'base'].includes(state.metric) ? 'new24' : state.metric;
    const v = valueFor(r, lead);
    const label = { new24: '24 hr', next72: 'Next 3d', next7: 'Next 7d', next14: 'Next 14d', season: 'Snowpack' }[lead];
    const base = valueFor(r, 'base');
    return `
    <button type="button" class="row rrow" data-open="${esc(r.id)}">
      ${head}
      <span class="rr-main">
        <span class="rr-stats">
          <span class="rs${state.metric === lead ? ' on' : ''}"><b>${esc(v.text)}</b><small>${label}</small></span>
          <span class="rs${state.metric === 'base' ? ' on' : ''}"><b>${esc(base.text)}</b><small>Base</small></span>
          <span class="rs"><b>${lifts ? `${lifts.open}/${lifts.total}` : '–'}</b><small>Lifts</small></span>
        </span>
        ${miniDays(r)}
      </span>
    </button>`;
  }).join('');
  $('#list').innerHTML = overviewCard() + sortBar + (rows || `<p class="empty">${state.openOnly && !state.favsOnly && state.pass === 'all' ? 'Nothing open yet.' : 'No resorts match these filters.'} <button type="button" class="link" data-clear-filters>Show all</button></p>`);
}

// Wind for a day column: the strongest speed in the Weather Service's wording ("10 to 15 mph"), with
// its direction (the night's when only the night is left today).
function dayWind(d) {
  const text = d.wind ?? d.nightWind;
  const nums = String(text ?? '').match(/\d+/g)?.map(Number);
  return { max: nums?.length ? Math.max(...nums) : null, dir: (d.wind ? d.windDir : d.nightWindDir) ?? '', text: text ?? '' };
}
const windUnit = () => (state.unit === 'C' ? 'km/h' : 'mph');
const windNum = (mph) => Math.round(state.unit === 'C' ? mph * 1.609 : mph);
const windText = (text) => (state.unit === 'C' ? String(text).replace(/(\d+)/g, (n) => windNum(Number(n))).replace('mph', 'km/h') : text);
const longDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
// A day's full forecast, opened by tapping it: the numbers, then the forecasters' own words for the
// day and the night (National Weather Service, as written).
function dayMore(d) {
  if (!d) return '';
  const facts = [
    ['High / low', `${deg(d.hi)} / ${deg(d.lo)}`],
    ['New snow', d.snow >= 0.5 ? `${inches(d.snow)}${rangeText([d.snowLo, d.snowHi]) ? ` <small>(${esc(rangeText([d.snowLo, d.snowHi]))})</small>` : ''}` : 'None'],
    d.pop != null || d.nightPop != null ? ['Chance of snow or rain', `${d.pop != null ? `${d.pop}%` : ''}${d.pop != null && d.nightPop != null ? ' · ' : ''}${d.nightPop != null ? `${d.nightPop}% tonight` : ''}`] : null,
    d.wind ? ['Wind', `${esc(d.windDir ?? '')} ${esc(windText(d.wind))}`] : null,
    d.nightWind ? ['Wind tonight', `${esc(d.nightWindDir ?? '')} ${esc(windText(d.nightWind))}`] : null,
    d.uv != null ? ['UV index', `${d.uv} <small>(${UV_WORDS[uvLevel(d.uv)]})</small>`] : null,
  ].filter(Boolean);
  const words = [d.detail && ['Day', d.detail], d.nightDetail && ['Night', d.nightDetail]].filter(Boolean);
  return `
    <div class="day-more">
      <p class="dm-head"><b>${esc(longDay(d.date))}</b> <span class="muted">${esc(d.sky ?? d.night ?? '')}</span></p>
      <dl class="dm-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${words.length ? `${words.map(([k, t]) => `<p class="dm-words"><b>${k}</b> ${esc(t)}</p>`).join('')}
      <p class="source">National Weather Service forecast, as written${state.unit === 'C' ? ' (in °F and mph)' : ''}</p>` : ''}
    </div>`;
}

function renderDetail(r) {
  const today = state.data.today;
  const f = r.forecast;
  const rep = r.report;
  const fav = state.favs.has(r.id);
  const stat = (num, label, sub = '') => `<div class="stat"><b>${num}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;

  const bars = f ? `
    <div class="days">${f.days.map((d) => {
      const w = dayWind(d);
      return `
      <button type="button" class="day${d.snow >= 1 ? ' has-snow' : ''}" data-day="${esc(d.date)}" aria-expanded="${state.openDay === d.date}" aria-label="${esc(longDay(d.date))}: full forecast">
        <span class="day-name">${weekday(d.date, today)}</span>
        <span class="day-sky" title="${esc(d.sky ?? d.night ?? '')}">${weatherIcon(d.sky ?? d.night) || '&nbsp;'}</span>
        <span class="day-temp">${deg(d.hi)}<i>${deg(d.lo)}</i></span>
        <span class="day-wind${w.max >= 25 ? ' windy' : ''}" title="Wind ${esc(w.text)}">${w.max != null ? `${esc(w.dir)} ${windNum(w.max)}` : '&nbsp;'}</span>
        ${d.uv != null ? `<span class="day-uv uv-${uvLevel(d.uv)}" title="UV index ${d.uv} (${UV_WORDS[uvLevel(d.uv)]})">UV ${d.uv}</span>` : ''}
        <span class="day-snow">${d.snow >= 1 ? inches(d.snow) : d.snow > 0 ? '<1″' : ''}</span>
      </button>`;
    }).join('')}
    </div>
    ${dayMore(f.days.find((d) => d.date === state.openDay))}
    <p class="week2">${f.week2 ? `<b>Days 8–14:</b> about ${inches(f.week2.mid)} more${rangeText(f.week2.range) ? ` (${rangeText(f.week2.range)})` : ''} · ` : ''}<span class="muted">Highs/lows in ${unitLabel()} · wind in ${windUnit()}${f.days.some((d) => d.uv != null) ? ' · UV: the day’s peak' : ''} · tap a day for its full forecast</span></p>` : '<p class="muted">Forecast unavailable right now.</p>';

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
      ${rep.seasonTotal != null ? `<li><span>Season snowfall so far</span><b>${inches(rep.seasonTotal)}</b></li>` : ''}
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
      <button type="button" class="icon" data-back aria-label="Back to all resorts">${UI.back}</button>
      <div class="detail-title">
        <h2><span>${esc(r.name)}<a class="site-link" href="${esc(r.url)}" target="_blank" rel="noopener" aria-label="${esc(r.name)} website (${esc(siteName(r.url))})" title="${esc(siteName(r.url))}">${EXT_ICON}</a></span>
          <span class="pill pill-${esc(r.status.state)}">${esc(r.status.label)}</span></h2>
        ${seasonText(r, today) ? `<p>${esc(seasonText(r, today))}</p>` : ''}
      </div>
      <button type="button" class="icon star" data-fav="${esc(r.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Unpin' : 'Pin'} ${esc(r.name)}">${fav ? UI.starFilled : UI.star}</button>
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
  if (f?.days.some((d) => d.uv != null)) notes.push(`UV index: each day’s peak, from ${sourceLink('https://open-meteo.com', 'Open-Meteo')}. At ski-area elevations, with snow reflecting it back, sunburn comes fast even on cold days.`);
  if (f) notes.push(`Weather: ${sourceLink(`https://forecast.weather.gov/MapClick.php?lat=${r.at[0]}&lon=${r.at[1]}`, 'National Weather Service forecast')}.`);
  const cams = camsSection(r, notes);
  const season = seasonSection(r, notes);
  const temps = tempSection(r, notes);
  if (report) notes.push(`Snow report: ${rep.source ? sourceLink(rep.source, `${r.name}’s snow report`) : sourceLink('https://www.coloradoski.com/snow-report/', 'Colorado Ski Country USA')}${rep.updated ? `, updated ${esc(timeAgo(rep.updated))}` : ''}.`);
  if (r.dates?.planned && r.dates.open) notes.push('Opening date as announced by the resort.');

  $('#detail').innerHTML = `${top}
    ${cams}
    ${liftSection}
    ${report}
    ${season}
    ${temps}
    ${notes.length ? `<h3 class="section">About the data</h3><ul class="notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}`;
  if (r.cams?.cams?.length) refreshCamAges(r);
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

// ---------- Colorado overview ----------
// The whole state's winter at a glance: what's open, fresh snow and the week ahead, statewide snowpack
// and temperature against normal (public/history/colorado.json and public/temps/colorado.json, made by
// scripts/statewide.mjs), and each region's snowpack.
const OVERVIEW = 'colorado';
let stateHistory = null; // colorado.json (snowpack normals), once loaded
function loadStateHistory() {
  if (!stateHistory) {
    stateHistory = fetch('history/colorado.json').then((res) => (res.ok ? res.json() : null)).catch(() => null)
      .then((d) => { stateHistory = d ?? false; if (state.selected === OVERVIEW) render(); return d; });
  }
  return stateHistory;
}
// One entry per snow station (several resorts can share one).
const stationsList = () => Object.entries(state.data.snowpack ?? {}).map(([id, s]) => ({ id, ...s }));
// Statewide % of normal: all the stations' snow water against all their normals.
// (minNormal: below this much normal water, a % swings wildly; a region with one station can go lower.)
function statewidePct(list = stationsList(), minNormal = 2) {
  const ok = list.filter((s) => s.latest?.normal != null);
  const have = ok.reduce((a, s) => a + s.latest.swe, 0);
  const normal = ok.reduce((a, s) => a + s.latest.normal, 0);
  return normal >= minNormal ? Math.round((have / normal) * 100) : null;
}
// Average of the stations' curves, day by day ([day, value] points, filled in between).
function averageCurve(curves) {
  const at = (pts, d) => {
    if (!pts.length || d < pts[0][0] || d > pts.at(-1)[0]) return null;
    let i = 1;
    while (i < pts.length && pts[i][0] < d) i++;
    const [d0, v0] = pts[i - 1];
    const [d1, v1] = pts[Math.min(i, pts.length - 1)];
    return d1 === d0 ? v0 : v0 + ((v1 - v0) * (d - d0)) / (d1 - d0);
  };
  const last = Math.min(...curves.filter((c) => c.length).map((c) => c.at(-1)[0]));
  const out = [];
  for (let d = 0; d <= last; d++) {
    const vals = curves.map((c) => at(c, d)).filter((v) => v != null);
    if (vals.length >= curves.length * 0.7) out.push([d, Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100]);
  }
  return out;
}
function todayStats() {
  const rs = state.data.resorts;
  const open = rs.filter((r) => r.status.state === 'open');
  const sum = (f) => rs.reduce((a, r) => { const v = f(r); return v ? [a[0] + v.open, a[1] + v.total] : a; }, [0, 0]);
  const lifts = sum((r) => (r.status.state === 'open' ? (r.report?.lifts?.total ? r.report.lifts : r.lifts) : null));
  const runs = sum((r) => (r.status.state === 'open' ? r.report?.trails : null));
  const top = (key) => rs.map((r) => ({ r, v: METRICS[key].get(r) ?? 0 })).sort((a, b) => b.v - a.v)[0];
  return { open, lifts, runs, fresh: top('new24'), week: top('next7') };
}
// ---------- Best bet ----------
// Which open resort looks best for skiing today and tomorrow, scored from what makes a good day:
// fresh snow (most), how much terrain is open, sun vs storm, wind, temperature, and base. Each pick
// lists its reasons so it can be judged, not just trusted.
const windMph = (s) => Math.max(0, ...String(s ?? '').match(/\d+/g)?.map(Number) ?? [0]);
function dayScore(r, which) {
  const f = r.forecast;
  const day = f?.days?.[which];
  if (!day) return null;
  // Fresh snow on the slopes that morning: today, the last 24 hours (the resort's report first);
  // tomorrow, what falls today and overnight.
  const fresh = which === 0 ? (r.report?.new24 ?? f.past24 ?? 0) : (f.days[0]?.snow ?? 0);
  const during = day.snow ?? 0;
  const trails = r.report?.trails;
  const runs = trails?.total ? trails.open / trails.total : null;
  const lifts = r.report?.lifts?.total ? r.report.lifts : r.lifts?.total ? r.lifts : null;
  const liftFrac = lifts ? lifts.open / lifts.total : null;
  const base = r.report?.depth ?? 0;
  const wind = windMph(day.wind);
  const sky = String(day.sky ?? '').toLowerCase();
  const hi = day.hi;
  let score = 0;
  score += (Math.min(fresh, 12) / 12) * 40;
  score += (Math.min(during, 8) / 8) * 8;
  score += Math.sqrt(runs ?? (liftFrac ?? 0) * 0.5) * 20;
  score += (liftFrac ?? 0) * 5;
  score += (Math.min(base, 48) / 48) * 10;
  score += /sunny|clear/.test(sky) ? 8 : /snow/.test(sky) ? 4 : /cloud/.test(sky) ? 3 : 0;
  score -= wind >= 25 ? 12 : wind >= 15 ? 5 : 0;
  if (hi != null) score += hi >= 18 && hi <= 38 ? 7 : hi > 45 || hi < 5 ? -6 : 0;
  const reasons = [];
  if (fresh >= 1) reasons.push(`${inches(fresh)} fresh`);
  if (during >= 1) reasons.push(`${inches(during)} more during the day`);
  if (runs != null) reasons.push(`${Math.round(runs * 100)}% of runs open`);
  else if (lifts) reasons.push(`${lifts.open} of ${lifts.total} lifts`);
  if (day.sky) reasons.push(`${day.sky.replace(/^Chance /, '').replace(/ Showers.*/, ' showers')}, ${deg(hi)}`);
  if (wind) reasons.push(wind >= 25 ? `windy (${wind} mph)` : wind >= 15 ? `breezy (${wind} mph)` : 'light wind');
  if (base) reasons.push(`${inches(base)} base`);
  return { r, score, reasons };
}
// scope: 'all', 'favs' (starred), or 'filter' (the pass and ★ filters now on).
function bestBets(which, scope = 'all') {
  const d = state.data;
  const tomorrow = addDaysIso(d.today, 1);
  return d.resorts
    .filter((r) => scope === 'all' || (scope === 'favs' ? state.favs.has(r.id) : matches(r)))
    // Open that day: open now, or opening tomorrow for tomorrow's pick.
    .filter((r) => r.status.state === 'open' || (which === 1 && r.status.state === 'soon' && r.status.date === tomorrow))
    .map((r) => dayScore(r, which)).filter(Boolean).sort((a, b) => b.score - a.score);
}
const addDaysIso = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
function bestBetCard(which, scope = 'all') {
  const bets = bestBets(which, scope);
  if (!bets.length) return '';
  const [top, next] = bets;
  const when = which === 0 ? 'today' : 'tomorrow';
  const label = scope === 'all' ? `Best bet ${when}` : `${scopeName(scope)} ${when}`;
  return `
    <button type="button" class="best-bet${scope !== 'all' ? ' best-fav' : ''}" data-open="${esc(top.r.id)}">
      <small>${esc(label)}</small>
      <b>${esc(top.r.name)}</b>
      <span>${esc(top.reasons.slice(0, 4).join(' · '))}</span>
      ${next ? `<em>Next best: ${esc(next.r.name)}</em>` : ''}
    </button>`;
}

// The same picks within the filters now on (e.g. Ikon only), and among the resorts you've starred
// (the ones you can and would ski). Each row shows once two or more of its resorts are open that
// day; with one there's nothing to choose. A row that would repeat another is left out.
const passFiltered = () => state.pass !== 'all' || state.favsOnly;
function scopeName(scope) {
  if (scope === 'favs') return '★ Yours';
  const pass = state.pass === 'other' ? 'Other passes' : state.pass !== 'all' ? PASS_NAMES[state.pass] : '';
  return state.favsOnly ? `★ ${pass || 'Yours'}` : pass;
}
const scopeRow = (scope) => (bestBets(0, scope).length < 2 && bestBets(1, scope).length < 2 ? ''
  : `<div class="best-bets">${bestBetCard(0, scope) || '<span></span>'}${bestBetCard(1, scope)}</div>`);
function scopedBets() {
  const filter = passFiltered() ? scopeRow('filter') : '';
  const favs = state.favsOnly && state.pass === 'all' ? '' : scopeRow('favs');
  return filter + favs;
}

// ---------- Today in Colorado ----------
// Highlights computed from the data (facts, with forecast ranges), plus the NWS forecasters' key
// messages and active alerts, quoted as published (the build fetches them; src/insights.js).
const listNames = (rows) => rows.map(({ r, v, range }) => `${esc(r.name)} <b>${inches(v)}</b>${range ? ` <span class="muted">(${esc(range)})</span>` : ''}`).join(', ');
function highlights() {
  const d = state.data;
  const out = [];
  const top = (key, min) => d.resorts.map((r) => ({ r, v: r.forecast?.[key] ?? 0, range: rangeText(r.forecast?.[`${key}Range`]) }))
    .filter((x) => x.v >= min).sort((a, b) => b.v - a.v).slice(0, 3);
  const fresh = d.resorts.map((r) => ({ r, v: r.report?.new24 ?? 0 })).filter((x) => x.v >= 2).sort((a, b) => b.v - a.v).slice(0, 4);
  if (fresh.length) out.push(`<b>Fresh snow</b> in the last 24 hours (resort reports): ${listNames(fresh)}.`);
  const soon3 = top('next72', 3);
  if (soon3.length) out.push(`<b>Next 3 days</b>, the most snow: ${listNames(soon3)}.`);
  else {
    const best = d.resorts.map((r) => r.forecast?.next72 ?? 0).reduce((a, b) => Math.max(a, b), 0);
    out.push(`<b>Next 3 days:</b> little new snow anywhere${best >= 0.5 ? ` (at most about ${inches(best)})` : ''}.`);
  }
  const week = top('next7', 6).filter((x) => !soon3.some((s) => s.r.id === x.r.id && s.v === x.v));
  if (week.length) out.push(`<b>Next 7 days:</b> ${listNames(week)}.`);
  const today = d.today;
  const opened = d.resorts.filter((r) => r.status.state === 'open' && r.dates?.open && r.dates.open <= today && (Date.parse(today) - Date.parse(r.dates.open)) / 864e5 <= 3);
  if (opened.length) out.push(`<b>Just opened:</b> ${opened.map((r) => esc(r.name)).join(', ')}.`);
  const soon = d.resorts.filter((r) => r.status.state === 'soon' && r.status.date && (Date.parse(r.status.date) - Date.parse(today)) / 864e5 <= 7)
    .sort((a, b) => a.status.date.localeCompare(b.status.date));
  if (soon.length) out.push(`<b>Opening this week:</b> ${soon.map((r) => `${esc(r.name)} <span class="muted">${esc(monthDay(r.status.date))}</span>`).join(', ')}.`);
  const regions = regionPcts();
  if (regions.length > 1) {
    const hi = regions[0];
    const lo = regions.at(-1);
    out.push(`<b>Snowpack:</b> ${esc(hi.name)} leads at ${hi.pct}% of normal; ${esc(lo.name)} is lowest at ${lo.pct}%.`);
  }
  return out;
}
function regionPcts() {
  const d = state.data;
  return [...new Set(d.resorts.map((r) => r.region))].map((name) => {
    const ids = [...new Set(d.resorts.filter((r) => r.region === name && r.station).map((r) => r.station))];
    return { name, pct: statewidePct(ids.map((id) => ({ id, ...d.snowpack[id] })), 0.5), resorts: d.resorts.filter((r) => r.region === name).map((r) => r.name) };
  }).filter((g) => g.pct != null).sort((a, b) => b.pct - a.pct);
}
const alertTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' }) : '');
function alertsBlock(alerts) {
  if (!alerts?.length) return '';
  return alerts.map((a) => `
    <div class="alert alert-${/warning/i.test(a.event) ? 'warn' : /watch/i.test(a.event) ? 'watch' : 'adv'}">
      <b>${esc(a.event)}</b>
      <span>${esc(a.areas.split(';').slice(0, 3).map((s) => s.trim()).join(' · '))}${a.areas.split(';').length > 3 ? ' …' : ''}</span>
      <small>${a.ends ? `Until ${esc(alertTime(a.ends))}` : ''}${a.office ? ` · ${esc(a.office)}` : ''}</small>
    </div>`).join('');
}
function todaySection() {
  const ins = state.data.insights;
  const items = highlights();
  const disc = ins?.discussions ?? [];
  return `
    <h3 class="section">Today in Colorado</h3>
    <div class="best-bets">${bestBetCard(0)}${bestBetCard(1)}</div>
    ${scopedBets()}
    <p class="best-note">Picked from fresh snow, open terrain, sun, wind, temperature and base, among resorts open that day.</p>
    ${alertsBlock(ins?.alerts)}
    <ul class="highlights">${items.map((t) => `<li>${t}</li>`).join('')}</ul>
    ${disc.length ? `<h3 class="section">From the forecasters <span class="section-note">National Weather Service, as written</span></h3>
      ${disc.map((o) => `
        <div class="nws">
          <p class="nws-head"><b>${esc(o.name)}</b> <span class="muted">${esc(o.covers)}</span></p>
          <ul>${o.messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
          <p class="source">Issued ${esc(timeAgo(o.issued))} · ${sourceLink(o.url, 'full discussion')}</p>
        </div>`).join('')}` : ''}`;
}

// One line for the card: today's best bet (and an active alert, if any, after it).
function headlineInsight() {
  const best = bestBets(0)[0];
  const a = state.data.insights?.alerts?.[0];
  // Plus the pick within the filters now on (or, unfiltered, among your favorites), when it differs.
  const scope = passFiltered() ? 'filter' : 'favs';
  const mine = bestBets(0, scope);
  const alt = mine.length >= 2 && mine[0].r.id !== best?.r.id ? mine[0] : null;
  const altName = scope === 'favs' ? 'of yours' : scopeName('filter').replace('★ ', '');
  const pick = best ? `<span class="best-star">★</span>Best today: <b>${esc(best.r.name)}</b>${best.reasons[0] && !alt ? ` · ${esc(best.reasons[0])}` : ''}${alt ? ` · ${esc(altName)}: <b>${esc(alt.r.name)}</b>` : ''}` : '';
  const alert = a ? `<span class="dot-alert"></span>${esc(a.event)}: ${esc(a.areas.split(';')[0].trim())}` : '';
  return [pick, alert].filter(Boolean).join('</span><span class="row-sub overview-line">');
}
function overviewCard() {
  if (!state.data?.snowpack || state.code !== 'CO') return '';
  const t = todayStats();
  const pct = statewidePct();
  return `
    <button type="button" class="row card overview-card" data-open="${OVERVIEW}">
      <span class="card-top">
        <span class="co-badge" aria-hidden="true">CO</span>
        <span class="row-name">Colorado today</span>
        <span class="card-more">Overview${UI.chevron}</span>
      </span>
      ${headlineInsight() ? `<span class="row-sub overview-line">${headlineInsight()}</span>` : ''}
      <span class="card-stats">
        <span class="cs"><b>${t.open.length}/${state.data.resorts.length}</b><small>Open</small></span>
        <span class="cs"><b>${t.lifts[1] ? `${t.lifts[0]}` : '–'}</b><small>Lifts spinning</small></span>
        <span class="cs"><b class="lvl-${seasonLevel(pct)}">${pct != null ? `${pct}%` : '–'}</b><small>Snowpack</small></span>
        <span class="cs"><b>${inches(t.week.v)}</b><small>Most +7d</small></span>
      </span>
    </button>`;
}
function renderOverview() {
  const d = state.data;
  const t = todayStats();
  const list = stationsList();
  const pct = statewidePct(list);
  const notes = [];
  $('#grab-detail').innerHTML = `
    <div class="detail-head">
      <button type="button" class="icon" data-back aria-label="Back to all resorts">${UI.back}</button>
      <div class="detail-title">
        <h2>Colorado <span class="pill pill-open">${t.open.length} open</span></h2>
        <p>Ski country · ${d.resorts.length} resorts · ${list.length} mountain snow stations</p>
      </div>
    </div>`;
  const tile = (num, label, sub = '') => `<div class="stat"><b>${num}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const soon = d.resorts.filter((r) => r.status.state === 'soon' && r.status.date).sort((a, b) => a.status.date.localeCompare(b.status.date)).slice(0, 4);
  const best = d.resorts.map((r) => ({ r, v: r.forecast?.next7 ?? 0 })).sort((a, b) => b.v - a.v).slice(0, 4);

  // Statewide snowpack: the average station's snow water this season against past winters.
  const h = loadStateHistory();
  const hist = h && !(h instanceof Promise) ? h : null;
  let snowChart = '<p class="muted small">Loading…</p>';
  if (hist) {
    const curve = (k) => hist.days.map((v, i) => (v ? [i, v[k]] : null)).filter(Boolean).filter((_, i) => i % 3 === 0);
    const bands = { p10: curve(0), p25: curve(1), p75: curve(3), p90: curve(4), max: curve(5), years: hist.seasons, first: hist.first, last: hist.last };
    const normal = curve(2);
    const peakAt = normal.reduce((a, p) => (p[1] > a[1] ? p : a), [0, 0]);
    const st = {
      season: averageCurve(list.map((s) => s.season ?? [])).filter((_, i, a) => i % 2 === 0 || i === a.length - 1),
      normal,
      peak: { swe: Math.round(peakAt[1] * 10) / 10, date: dateOfSeason(peakAt[0]) },
    };
    // The next two weeks, statewide: each station's projected gain (the average of its resorts'
    // forecasts), averaged over the stations, as the dashed line on from "now".
    const perStation = list.map((stn) => {
      const rows = d.resorts.filter((r) => r.station === stn.id && r.forecast?.waterAhead?.length).map((r) => r.forecast.waterAhead);
      if (!rows.length) return null;
      const n = Math.min(...rows.map((x) => x.length));
      return Array.from({ length: n }, (_, i) => rows.reduce((a, x) => a + x[i], 0) / rows.length);
    }).filter(Boolean);
    const days = perStation.length ? Math.min(...perStation.map((x) => x.length)) : 0;
    const ahead = days ? Array.from({ length: days }, (_, i) => perStation.reduce((a, x) => a + x[i], 0) / perStation.length) : null;
    snowChart = `${seasonChart(st, ahead, null, bands)}
      <p class="legend-line"><i class="k-now"></i>This season ${ahead ? '<i class="k-proj"></i>Next 2 weeks ' : ''}<i class="k-median"></i>Normal</p>
      <p class="band-key"><span class="b-high">Snowiest 10%</span><span class="b-above">Above</span><span class="b-normal">Typical</span><span class="b-below">Below</span><span class="b-low">Driest 10%</span></p>`;
    notes.push(`Ski-country snowpack: the average of the ${list.length} high-elevation SNOTEL stations near Colorado's resorts (not all of Colorado) (USDA NRCS Snow Survey), against the same average over the ${hist.seasons} winters ${esc(hist.first)} to ${esc(hist.last)}; % of normal is their total snow water against their total 1991–2020 median.`);
  }

  // Regions: their stations' snow water against normal.
  const regions = regionPcts();
  const maxPct = Math.max(150, ...regions.map((g) => g.pct));
  const regionRows = regions.map((g) => `
    <li class="region">
      <span class="region-name">${esc(g.name)}<small>${esc(g.resorts.join(', '))}</small></span>
      <span class="region-bar"><i class="lvl-${seasonLevel(g.pct)}" style="width:${Math.max(3, (g.pct / maxPct) * 100).toFixed(0)}%"></i><em style="left:${((100 / maxPct) * 100).toFixed(0)}%"></em></span>
      <b class="pct lvl-${seasonLevel(g.pct)}">${g.pct}%</b>
    </li>`).join('');

  // Statewide temperature.
  const tn = tempNormals.get(OVERVIEW);
  if (!tn) loadTemps(OVERVIEW).then(() => { if (state.selected === OVERVIEW) render(); });
  let tempBlock = '<p class="muted small">Loading…</p>';
  if (tn && !(tn instanceof Promise)) {
    const temps = averageCurve(list.map((s) => s.temps ?? []));
    const ahead = averageCurve(d.resorts.map((r) => (r.forecast?.days ?? []).filter((x) => x.hi != null && x.lo != null).map((x) => [dayOfSeason(x.date), (x.hi + x.lo) / 2])))
      .map(([dd, v]) => [dd, v]);
    const median = (dd) => tn.days[Math.min(tn.days.length - 1, Math.max(0, dd))]?.[2];
    const week = temps.slice(-7).filter(([dd]) => median(dd) != null);
    const diff = week.length >= 4 ? Math.round(week.reduce((a, [dd, v]) => a + v - median(dd), 0) / week.length) : null;
    tempBlock = `<p class="season-head">${diff == null ? 'This season so far, against normal' : Math.abs(diff) <= 1 ? 'The last week has been <b>about normal</b> in ski country'
      : `The last week has been <span class="temp-diff ${diff > 0 ? 'warm' : 'cold'}">${Math.round(Math.abs(toUnit(diff, true)))}${unitLabel()} ${diff > 0 ? 'warmer' : 'colder'}</span> than normal in ski country`}</p>
      ${tempChart(temps, ahead, tn.days)}
      <p class="legend-line"><i class="k-now"></i>This season <i class="k-proj"></i>Next 7 days <i class="k-median"></i>Normal</p>`;
    notes.push(`Ski-country temperature: the average daily mean (high and low) of the same ${list.length} mountain stations, roughly 9,000–11,500 ft (not Denver or the plains); normal range averaged from each station's ${tn.seasons} winters.`);
  }

  $('#detail').innerHTML = `
    <div class="stats stats-6">
      ${tile(`${t.open.length}`, 'resorts open', `of ${d.resorts.length}`)}
      ${tile(t.lifts[1] ? `${t.lifts[0]}` : '–', 'lifts spinning', t.lifts[1] ? `of ${t.lifts[1]} at open resorts` : '')}
      ${tile(t.runs[1] ? `${t.runs[0]}` : '–', 'runs open', t.runs[1] ? `of ${t.runs[1]}` : '')}
      ${tile(pct != null ? `${pct}%` : '–', 'of normal snowpack', 'ski country')}
      ${tile(inches(t.fresh.v), 'most new snow', t.fresh.v >= 0.5 ? esc(t.fresh.r.name) : 'last 24 hrs')}
      ${tile(inches(t.week.v), 'most next 7 days', esc(t.week.r.name))}
    </div>
    ${todaySection()}
    <h3 class="section">Snowpack, ski country <span class="section-note">${list.length} mountain stations</span></h3>
    ${snowChart}
    <h3 class="section">By region</h3>
    <ul class="regions">${regionRows}</ul>
    <h3 class="section">Temperature, ski country <span class="section-note">${list.length} mountain stations</span></h3>
    ${tempBlock}
    ${soon.length ? `<h3 class="section">Opening next</h3><ul class="report">${soon.map((r) => `<li><span>${esc(r.name)}</span><b>${esc(monthDay(r.status.date))}</b></li>`).join('')}</ul>` : ''}
    <h3 class="section">Most snow, next 7 days</h3>
    <ul class="report">${best.map(({ r, v }) => `<li><span>${esc(r.name)}</span><b>${inches(v)}</b></li>`).join('')}</ul>
    <h3 class="section">About the data</h3><ul class="notes">${notes.map((n) => `<li>${n}</li>`).join('')}<li>Open status, lifts and runs: the resorts' own reports and Colorado Ski Country USA.</li></ul>`;
}
const dateOfSeason = (d) => {
  const [y, m] = state.data.today.split('-').map(Number);
  const start = Date.parse(`${m >= 10 ? y : y - 1}-10-01T12:00:00Z`);
  return new Date(start + d * 864e5).toISOString().slice(0, 10);
};

// UV index levels (the standard scale) and their colors (in CSS).
const uvLevel = (v) => (v <= 2 ? 'low' : v <= 5 ? 'mod' : v <= 7 ? 'high' : v <= 10 ? 'vhigh' : 'ext');
const UV_WORDS = { low: 'low', mod: 'moderate', high: 'high', vhigh: 'very high', ext: 'extreme' };

// ---------- temperature units ----------
// Data is °F; shown in the chosen unit. diff: a difference of degrees (no 32° offset).
const toUnit = (f, diff = false) => (state.unit === 'C' ? (diff ? f * 5 / 9 : (f - 32) * 5 / 9) : f);
const deg = (f) => (f == null ? '–' : `${Math.round(toUnit(f))}°`);
const unitLabel = () => `°${state.unit}`;

// ---------- temperature chart ----------
// This season's daily temperature at the resort's snow station (mean of the day's high and low, °F)
// against the normal range for each date (public/temps/, from 20+ past winters; scripts/temps.mjs),
// plus the coming week's forecast.
const tempNormals = new Map();
function loadTemps(triplet) {
  if (!tempNormals.has(triplet)) {
    tempNormals.set(triplet, fetch(`temps/${triplet.split(':')[0]}.json`).then((res) => (res.ok ? res.json() : null)).catch(() => null)
      .then((d) => { tempNormals.set(triplet, d); return d; }));
  }
  return tempNormals.get(triplet);
}
function tempSection(r, notes) {
  const st = station(r);
  if (!st?.temps?.length) return '';
  const n = tempNormals.get(r.station);
  if (!n) loadTemps(r.station).then(() => { if (state.selected === r.id) render(); });
  if (!n || n instanceof Promise) return '<h3 class="section">Temperature</h3><p class="muted small">Loading…</p>';
  const median = (d) => n.days[Math.min(n.days.length - 1, Math.max(0, d))]?.[2];
  // How the last week compares with normal.
  const week = st.temps.slice(-7).filter(([d]) => median(d) != null);
  const diff = week.length >= 4 ? Math.round(week.reduce((a, [d, t]) => a + t - median(d), 0) / week.length) : null;
  const head = diff == null ? 'This season so far, against normal'
    : Math.abs(diff) <= 1 ? 'The last week has been <b>about normal</b>'
      : `The last week has been <span class="temp-diff ${diff > 0 ? 'warm' : 'cold'}">${Math.round(Math.abs(toUnit(diff, true)))}${unitLabel()} ${diff > 0 ? 'warmer' : 'colder'}</span> than normal`;
  const ahead = (r.forecast?.days ?? []).filter((d) => d.hi != null && d.lo != null).map((d) => [dayOfSeason(d.date), (d.hi + d.lo) / 2]);
  notes.push(`Temperature: daily mean of the high and low at the ${sourceLink(SNOTEL_SITE(r.station), `${n.name} SNOTEL station`)} (USDA NRCS); normal range from the ${n.seasons} winters ${esc(n.first)} to ${esc(n.last)}. Forecast: the snow forecast's daily highs and lows at mid-mountain.`);
  return `
    <h3 class="section">Temperature</h3>
    <p class="season-head">${head}</p>
    ${tempChart(st.temps, ahead, n.days)}
    <p class="legend-line"><i class="k-now"></i>This season <i class="k-proj"></i>Next 7 days <i class="k-median"></i>Normal</p>
    <p class="band-key"><span class="t-band-wide">Coldest–warmest 10%</span><span class="t-band-mid">Typical half</span></p>`;
}
function tempChart(seasonF, aheadF, daysF) {
  // Everything in the chosen unit from here on.
  const season = seasonF.map(([d, v]) => [d, toUnit(v)]);
  const ahead = aheadF.map(([d, v]) => [d, toUnit(v)]);
  const days = daysF.map((row) => row && row.map((v) => toUnit(v)));
  const step = state.unit === 'C' ? 10 : 20;
  const freezing = toUnit(32);
  const W = 320;
  const H = 128;
  const pad = { l: 22, r: 4, t: 16, b: 18 };
  const last = season.at(-1);
  const proj = last && ahead.length ? [last, ...ahead.filter(([d]) => d > last[0])] : [];
  const all = [...days.filter(Boolean).flatMap((p) => [p[0], p[4]]), ...season.map((p) => p[1]), ...proj.map((p) => p[1])];
  const lo = Math.floor((Math.min(...all) - 2) / 10) * 10;
  const hi = Math.ceil((Math.max(...all) + 2) / 10) * 10;
  const x = (d) => pad.l + (d / SEASON_DAYS) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - ((v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  const band = (a, b, cls) => {
    const pts = days.map((v, d) => (v ? [d, v[a], v[b]] : null)).filter(Boolean);
    return `<path class="${cls}" d="M${pts.map((p) => `${x(p[0]).toFixed(1)} ${y(p[2]).toFixed(1)}`).join(' L')} L${[...pts].reverse().map((p) => `${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' L')} Z"/>`;
  };
  const med = days.map((v, d) => (v ? [d, v[2]] : null)).filter(Boolean);
  const grid = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) grid.push(t);
  const months = MONTHS.map((m, i) => `<text x="${x(MONTH_STARTS[i] + 2).toFixed(1)}" y="${H - 4}">${m}</text>`).join('');
  const flip = last && x(last[0]) > W - 80;
  return `
    <svg class="chart temp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily temperature this season compared with normal">
      ${grid.map((t) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="t-axis" x="${pad.l - 4}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${t}°</text>`).join('')}
      <text class="t-axis t-unit" x="${pad.l - 4}" y="${pad.t - 5}" text-anchor="end">${unitLabel()}</text>
      ${freezeLine(y, pad, W, lo, hi, freezing)}
      ${band(0, 4, 't-band-wide')}${band(1, 3, 't-band-mid')}
      <path class="median" d="${path(med)}"/>
      ${proj.length > 1 ? `<path class="halo" d="${path(proj)}"/><path class="proj" d="${path(proj)}"/>` : ''}
      <path class="halo" d="${path(season)}"/><path class="now" d="${path(season)}"/>
      ${last ? `<circle class="now-dot" cx="${x(last[0])}" cy="${y(last[1])}" r="3"/>
        <text class="now-label" text-anchor="${flip ? 'end' : 'start'}" x="${(x(last[0]) + (flip ? -7 : 7)).toFixed(1)}" y="${(y(last[1]) - 7).toFixed(1)}">now ${Math.round(last[1])}${unitLabel()}</text>` : ''}
      ${months}
    </svg>`;
}
// The freezing line, faintly, when it's in range.
const freezeLine = (y, pad, W, lo, hi, t) => (t > lo && t < hi ? `<line class="freeze" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="t-axis freeze-label" x="${W - pad.r - 2}" y="${(y(t) - 3).toFixed(1)}" text-anchor="end">${Math.round(t)}°${state.unit} freezing</text>` : '');

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
    facts.push(fact('Natural snow on the ground', `about ${Math.round(r.noaa.depth)}″`));
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
      // Who keeps a full label when space runs out: filter matches, then favorites, then open resorts.
      // (Open status only: filters and favorites fade or star resorts but never move labels.)
      prio: isOpenish(r) ? 1 : 0,
      rank: [selected, fav, open, v.sort],
    };
  });
  // Most important first (selected, pinned, open), so they win the space on a crowded map.
  items.sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || b.rank[2] - a.rank[2] || b.rank[3] - a.rank[3]);
  state.map.update(items);
}

let lastSelected = null;
const routeFor = () => `#${state.code.toLowerCase()}${state.selected ? `/${state.selected}` : ''}`;
function syncRoute() {
  if (location.hash !== routeFor()) history.replaceState(history.state, '', routeFor());
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
  $('#map').dataset.layer = state.layer; // (the light map dims a little under white snow)
  $('#map').dataset.snowStyle = state.snowStyle;
  $('#legend').innerHTML = legendFor(state.layer);
  $('#legend').classList.remove('pending');
  $('#updated').textContent = `Updated ${timeAgo(state.data.generated)}`;

  const overview = state.selected === OVERVIEW;
  const r = overview ? null : state.data.resorts.find((x) => x.id === state.selected);
  if (state.selected && !overview && !r) state.selected = null; // (a shared link to a resort that's gone)
  const open = Boolean(r) || overview;
  // A forecast day opened in one resort's page closes when you go elsewhere.
  if (state.selected !== lastSelected) state.openDay = null;
  lastSelected = state.selected;
  syncRoute();
  $('#list').hidden = open;
  $('#detail').hidden = !open;
  $('.foot').hidden = open; // a resort's own sources sit at the bottom of its details
  grabEl.classList.toggle('has-detail', open);
  if (!open) $('#grab-detail').innerHTML = '';
  if (overview) renderOverview();
  else if (r) renderDetail(r);
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
    // (Sideways swipes on things that scroll sideways themselves, like the cams strip, are theirs.)
    if (e.target.closest('.drag-handle')) { swipe = null; return; } // reordering, not a swipe
    if (Math.abs(dx) > Math.abs(dy) * 1.4 && e.target.closest('.cams')) swipe.mode = 'scroll';
    else if (Math.abs(dx) > Math.abs(dy) * 1.4 && !e.target.closest('select, input, .chart')) swipe.mode = 'side';
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
  if (state.selected === OVERVIEW) return;
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

// ---------- reordering ("Mine") ----------
// Press the ⋮⋮ handle and drag: the row follows the finger, the others slide aside, the list scrolls
// near its edges, and letting go saves the new order.
let reorder = null;
$('#list').addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.drag-handle');
  if (!handle) return;
  e.preventDefault();
  const rows = [...$('#list').querySelectorAll('.rrow')];
  const row = handle.closest('.rrow');
  const rects = rows.map((x) => x.getBoundingClientRect());
  const from = rows.indexOf(row);
  reorder = { rows, rects, row, from, to: from, y0: e.clientY, scroll0: bodyEl.scrollTop, h: rects[from].height };
  handle.setPointerCapture(e.pointerId);
  row.classList.add('dragging');
  document.body.classList.add('reordering');
});
function reorderMove(clientY) {
  const o = reorder;
  const dy = clientY - o.y0 + (bodyEl.scrollTop - o.scroll0);
  o.row.style.transform = `translateY(${dy}px)`;
  const mid = o.rects[o.from].top + o.h / 2 + dy;
  let to = o.from;
  o.rects.forEach((r, i) => {
    if (i < o.from && mid < r.top + r.height / 2) to = Math.min(to, i);
    if (i > o.from && mid > r.top + r.height / 2) to = Math.max(to, i);
  });
  o.to = to;
  o.rows.forEach((x, i) => {
    if (x === o.row) return;
    const shift = i > o.from && i <= to ? -o.h : i < o.from && i >= to ? o.h : 0;
    x.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}
$('#list').addEventListener('pointermove', (e) => {
  if (!reorder) return;
  reorder.lastY = e.clientY;
  reorderMove(e.clientY);
  // Near the panel's top or bottom edge: scroll so the drag can go further.
  const b = bodyEl.getBoundingClientRect();
  const edge = e.clientY < b.top + 50 ? -1 : e.clientY > Math.min(b.bottom, innerHeight) - 50 ? 1 : 0;
  clearInterval(reorder.timer);
  if (edge) reorder.timer = setInterval(() => { bodyEl.scrollTop += edge * 8; reorderMove(reorder.lastY); }, 16);
});
const endReorder = () => {
  const o = reorder;
  if (!o) return;
  reorder = null;
  clearInterval(o.timer);
  document.body.classList.remove('reordering');
  const ids = o.rows.map((x) => x.dataset.open);
  const [moved] = ids.splice(o.from, 1);
  ids.splice(o.to, 0, moved);
  // Keep any resorts the list didn't show (filters) in their places after the visible ones.
  state.order = [...ids, ...state.order.filter((id) => !ids.includes(id))];
  write(STORE.order, state.order);
  renderList();
};
$('#list').addEventListener('pointerup', endReorder);
$('#list').addEventListener('pointercancel', endReorder);

// ---------- actions ----------

// Opening a resort (or the overview) from the list adds a step to the browser's history, so the
// phone's back gesture returns to the list instead of leaving the site.
function select(id) {
  if (!id && state.selected && history.state?.page) return history.back(); // (popstate does the rest)
  if (id && !state.selected) history.pushState({ page: true }, '', `#${state.code.toLowerCase()}/${id}`);
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
    // Colorado: a little room east of the Front Range resorts (toward Denver), where the I-70
    // corridor's eastern labels stack up.
    extend: state.code === 'CO' ? [39.75, -105.3] : null,
    getPadding: coveredPadding,
    onSelect: (id) => select(id),
    onOutlook: (season) => { state.outlookSeason = season; render(); },
    // Each radar frame: just update the key's button and time (no full re-render while playing).
    onRadar: (r) => { state.radar = r; syncRadarKey(); },
    onCast: (c) => { state.cast = { ...state.cast, ...c }; if (state.layer === 'snowcast') $('#legend').innerHTML = legendFor('snowcast'); },
    places: state.code === 'CO' ? CO_TOWNS : [],
  });
  applyLayer();
  // Major highways (I-70, I-25, US-285…), Colorado only for now.
  if (state.code === 'CO') {
    const map = state.map;
    fetch('roads.json?v=__V__').then((r) => r.json()).then((d) => { if (state.map === map) map.setRoads(d); }).catch(() => {});
  }
}

async function load() {
  document.body.classList.add('refreshing');
  const code = state.code;
  try {
    const res = await fetch(`${dataUrl(code)}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (code !== state.code) return; // switched states while this was loading
    state.data = data;
    state.loadedAt = Date.now();
    write(`${STORE.data}:${code}`, state.data);
    // (How old the data is already shows as "Updated … ago" under the headline.)
    showNotice(code === 'CO' && !state.data.sources.coloradoSki ? 'Live open status is unavailable right now. Showing forecasts only.' : null);
  } catch {
    if (code !== state.code) return;
    const saved = read(`${STORE.data}:${code}`, null);
    if (saved) {
      state.data = saved;
      showNotice(`You're offline. Showing data from ${timeAgo(saved.generated)}.`);
    } else {
      showNotice("Couldn't load snow data. Check your connection, then tap the refresh arrow to retry.");
    }
  }
  startMap();
  render();
  // (The spin shows for at least a moment, so a quick refresh still reads as one.)
  setTimeout(() => document.body.classList.remove('refreshing'), 500);
}
// The "N min ago" ticks along, and the data refreshes itself every 10 minutes while the app is open.
setInterval(() => {
  if (document.visibilityState !== 'visible' || !state.data) return;
  if (Date.now() - state.loadedAt > RELOAD_AFTER_MS) return load();
  const t = $('.when-text');
  if (t) t.textContent = timeAgo(state.data.generated);
}, 60_000);

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
  if (code === state.code && state.data && (state.data.state ?? 'CO') === code) return syncRoute();
  state.code = code;
  write(STORE.state, code.toLowerCase());
  state.selected = null;
  history.replaceState(null, '', routeFor());
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

// Back/forward (and an edited address): follow the address. A cam open on top closes first.
function followRoute() {
  if (!$('#cam-view').hidden && !history.state?.cam) $('#cam-view').hidden = true;
  const [c, id] = routeParts();
  const code = validCode(c);
  if (code && code !== state.code) return setState(code);
  const want = id || null;
  if (want === state.selected) return syncRoute();
  state.selected = want;
  render();
  $('#sheet-body').scrollTop = 0;
  if (want && (state.sheet === 'peek' || state.sheet === 'full')) setSheet('half');
}
window.addEventListener('popstate', followRoute);
window.addEventListener('hashchange', followRoute);

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
  if (t.closest('.drag-handle')) return; // (a drag, not a tap on the row)
  if (t.closest('[data-reset-order]')) {
    state.order = [];
    write(STORE.order, state.order);
    state.sort = 'name';
    write(STORE.sort, state.sort);
    return renderList();
  }
  const row = t.closest('[data-open]');
  if (row) return select(row.dataset.open);
  if (t.closest('[data-back]')) return select(null);
  const dayBtn = t.closest('[data-day]');
  if (dayBtn) {
    state.openDay = state.openDay === dayBtn.dataset.day ? null : dayBtn.dataset.day;
    return render();
  }
  const star = t.closest('[data-fav]');
  if (star) {
    const id = star.dataset.fav;
    state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
    write(STORE.favs, [...state.favs]);
    toast(state.favs.has(id) ? 'Added to favorites' : 'Removed from favorites');
    return render();
  }
  const sortBtn = t.closest('[data-sort]');
  if (sortBtn) {
    // "Mine" starts from whatever order is showing, the first time.
    if (sortBtn.dataset.sort === 'mine' && !state.order.length) {
      state.order = ordered(true).map(({ r }) => r.id);
      write(STORE.order, state.order);
    }
    state.sort = sortBtn.dataset.sort;
    write(STORE.sort, state.sort);
    return renderList();
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
  const camBtn = t.closest('[data-cam]');
  if (camBtn) {
    const r = state.data.resorts.find((x) => x.id === state.selected);
    if (r) openCam(r, Number(camBtn.dataset.cam));
    return;
  }
  if (t.closest('[data-cam-close]') || t.id === 'cam-view') return closeCam();
  const castDay = t.closest('[data-cast-day]');
  if (castDay || t.closest('[data-cast-amount]')) {
    const c = state.cast;
    if (castDay) c.day = Math.min(3, Math.max(1, c.day + Number(castDay.dataset.castDay)));
    else c.amount = CAST_AMOUNTS[(CAST_AMOUNTS.indexOf(c.amount) + 1) % CAST_AMOUNTS.length];
    state.map?.setCast(c.day, c.amount);
    $('#legend').innerHTML = legendFor('snowcast');
    return;
  }
  if (t.closest('[data-snow-cycle]')) {
    state.snowStyle = SNOW_STYLES[(SNOW_STYLES.indexOf(state.snowStyle) + 1) % SNOW_STYLES.length];
    write(STORE.snowStyle, state.snowStyle);
    state.map?.setSnowStyle(state.snowStyle);
    return render();
  }
  const satStep = t.closest('[data-sat-step]');
  if (satStep) return stepSatDay(Number(satStep.dataset.satStep));
  if (t.closest('#radar-play')) return state.map?.playRadar(!state.radar.playing);
  if (t.closest('#snow-btn')) return openLayers($('#layers').hidden);
  const layer = t.closest('[data-layer]');
  if (layer) {
    state.layer = layer.dataset.layer;
    write(STORE.layer, state.layer);
    applyLayer();
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
  const unitBtn = t.closest('[data-unit-pick]');
  if (unitBtn) {
    state.unit = unitBtn.dataset.unitPick;
    write(STORE.unit, state.unit);
    syncUnitPick();
    return render();
  }
  if (t.closest('[data-theme-pick]')) return applyTheme(t.closest('[data-theme-pick]').dataset.themePick);
  if (t.closest('#updated') || t.closest('[data-refresh]')) return load();
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
  else if (!$('#cam-view').hidden) closeCam();
  else if (state.selected) select(null);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > RELOAD_AFTER_MS) load();
});
let lastSize = [innerWidth, innerHeight];
const onResize = () => {
  // The panel and the snow key always follow the new height (Chrome's address bar sliding away makes
  // the screen taller and the panel with it); only the map's layout skips small height-only changes.
  setSheet(state.sheet, false);
  document.body.classList.toggle('panel-hidden', WIDE.matches && !state.panelOpen);
  $('#panel-open').hidden = !WIDE.matches || state.panelOpen;
  const [w, h] = lastSize;
  if (innerWidth === w && Math.abs(innerHeight - h) < 120 && !WIDE.matches) return;
  lastSize = [innerWidth, innerHeight];
  state.map?.refit();
};
// Laying labels out takes ~0.1 s, so while a window is being dragged to a new size, wait for a pause.
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 120);
});
WIDE.addEventListener('change', onResize);

// No zooming the page on phones: iPhones ignore the viewport's "no zoom" for accessibility, so their
// pinch gestures (and any two-finger move) are cancelled here too.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

$('#credit-text').innerHTML = CREDITS;
function syncUnitPick() {
  for (const b of document.querySelectorAll('[data-unit-pick]')) b.setAttribute('aria-pressed', String(b.dataset.unitPick === state.unit));
}
syncUnitPick();
applyTheme();
DARK.addEventListener('change', () => applyTheme());
setSheet('peek', false);
document.body.classList.toggle('panel-hidden', WIDE.matches && !state.panelOpen);
$('#panel-open').hidden = !WIDE.matches || state.panelOpen;
// Show the last copy instantly, then fetch fresh data.
if (!state.firstVisit) {
  // A shared link to a resort or the overview opens it (with the list one back step behind it).
  const shared = routeParts()[1];
  if (shared) {
    history.replaceState(null, '', `#${state.code.toLowerCase()}`);
    history.pushState({ page: true }, '', `#${state.code.toLowerCase()}/${shared}`);
    state.selected = shared;
    setSheet('half', false);
  } else history.replaceState(null, '', routeFor());
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
