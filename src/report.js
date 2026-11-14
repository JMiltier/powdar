// Builds the single data.json the app reads. Pure apart from the fetch you pass in,
// so it runs the same in the GitHub Action, the local preview server and tests.
import { RESORTS, PLANNED } from './resorts.js';
import { MODELS, modelUrl, snowHours, uvUrl } from './models.js';
import { ensembleUrl, summarizeEnsemble } from './ensemble.js';
import { parseSnotel, snotelUrl, stationSeason, waterYear } from './snotel.js';
import { LIFT_SOURCES, summarizeLifts } from './lifts.js';
import { liftsDue } from './lift-hours.js';
import { VAIL_SITES, snowPage, liftPage, parseVailSnow, parseVailTerrain } from './vail.js';
import { fetchInsights } from './insights.js';
import CAMS from './cams.json' with { type: 'json' };

import { nohrscUrl, parseNohrsc } from './noaa.js';

export const CSC_FEED = 'https://snow.coloradoski.com/view/publicreport-feed';
const NWS = 'https://api.weather.gov/gridpoints';
const USER_AGENT = 'Powdar (github.com/JMiltier/powdar)';
const TZ = 'America/Denver';
export const FORECAST_DAYS = 7; // days shown day by day
const OUTLOOK_DAYS = 14; // days 8–14 are summarised as a less-certain "week 2"
export const MODEL_DAYS = 14; // two weeks: longer requests count extra against the free allowance
const MM_PER_INCH = 25.4;
const DAY_MS = 86_400_000;

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// 'YYYY-MM-DD' in Colorado time.
export const localDate = (d) => dateFmt.format(d);

const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// Ski seasons run Aug 1 – Jul 31 and are named like '2026-27'.
export function seasonOf(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  const start = m >= 8 ? y : y - 1;
  return { name: `${start}-${String(start + 1).slice(2)}`, start: `${start}-08-01`, end: `${start + 1}-07-31` };
}

// ISO 8601 durations as NWS uses them: 'PT6H', 'P1DT21H', 'P2D'.
export function durationHours(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?$/.exec(iso);
  if (!m) throw new Error(`Unexpected duration ${iso}`);
  return Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0);
}

// Spread each NWS value evenly over the hours it covers: [{ t: msTimestamp, v }].
function hourly(values) {
  const out = [];
  for (const { validTime, value } of values) {
    if (value == null) continue;
    const [startIso, dur] = validTime.split('/');
    const start = Date.parse(startIso);
    const hours = durationHours(dur);
    for (let h = 0; h < hours; h++) out.push({ t: start + h * 3_600_000, v: value / hours });
  }
  return out;
}

const cToF = (c) => Math.round((c * 9) / 5 + 32);
const round1 = (n) => Math.round(n * 10) / 10;

// NWS gridpoint data → hourly snow in inches: [{ t, v }], or null if there's none.
export function nwsSnowHours(props) {
  const hours = hourly(props?.snowfallAmount?.values ?? []);
  return hours.length ? hours.map(({ t, v }) => ({ t, v: v / MM_PER_INCH })) : null;
}

// Daily highs and lows (°F) from NWS, labelled by the local date they start on
// (so a night's low counts for that evening).
function nwsTemps(props, dates) {
  const out = new Map(dates.map((d) => [d, { hi: null, lo: null }]));
  for (const [key, field] of [['maxTemperature', 'hi'], ['minTemperature', 'lo']]) {
    for (const { validTime, value } of props?.[key]?.values ?? []) {
      const day = out.get(localDate(new Date(Date.parse(validTime.split('/')[0]))));
      if (day && value != null && day[field] == null) day[field] = cToF(value);
    }
  }
  return out;
}

// The middle value and a likely range across forecasts. With five sources the range skips the
// single highest and lowest, so one wild model can't stretch it.
export function spread(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  const mid = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { mid: round1(mid), lo: round1(s[Math.floor((n - 1) / 4)]), hi: round1(s[Math.ceil((3 * (n - 1)) / 4)]) };
}

// Daily sky, wind and chance of precipitation from the NWS text forecast, by local date.
export function nwsDaily(periods) {
  const out = new Map();
  for (const p of periods ?? []) {
    const date = localDate(new Date(Date.parse(p.startTime)));
    const day = out.get(date) ?? {};
    const pop = p.probabilityOfPrecipitation?.value ?? null;
    // Plus the forecasters' full wording for the day and the night, and the wind's direction.
    const extra = (k, v) => (v ? { [k]: v } : {});
    if (p.isDaytime) Object.assign(day, { sky: p.shortForecast, wind: p.windSpeed, pop }, extra('windDir', p.windDirection), extra('detail', p.detailedForecast));
    else Object.assign(day, { night: p.shortForecast, nightPop: pop }, extra('nightWind', p.windSpeed), extra('nightWindDir', p.windDirection), extra('nightDetail', p.detailedForecast));
    out.set(date, day);
  }
  return out;
}

const HOUR = 3_600_000;
// A source "covers" a local date if its hours reach that evening.
const covers = (lastT, ymd) => lastT >= Date.parse(`${ymd}T12:00:00Z`) + 16 * HOUR;

// sources: [{ id, hours: [{ t, v (inches of snow), w? (inches of water as snow) }] | null }];
// nws: raw NWS gridpoint properties (temperatures); periods: NWS text-forecast periods (sky, wind).
// Each day and total uses only the sources whose forecast reaches that far.
// ens (optional): this resort's ensemble summary for today ({ days: [{ date, mid, lo, hi }], next7,
// week2, runs }), see src/ensemble.js. Days 1–3 stay with the single runs and the Weather Service
// (strongest up close); days 4–7 average their consensus with the ensembles' middle; days 8–14 come
// from the ensembles alone.
export function blendForecast({ sources, nws, periods, ens = null }, now) {
  const today = localDate(now);
  const dates = Array.from({ length: OUTLOOK_DAYS }, (_, i) => addDays(today, i));
  const pastDates = [5, 4, 3, 2, 1].map((n) => addDays(today, -n));
  const usable = sources.filter((s) => s.hours?.length);
  if (!usable.length) return null;
  const nowMs = now.getTime();

  const per = usable.map(({ id, hours }) => {
    const snow = new Map(dates.map((d) => [d, 0]));
    const water = new Map(dates.map((d) => [d, 0]));
    let next72 = 0;
    let past24 = 0;
    const before = new Map(pastDates.map((d) => [d, 0])); // the past days' snow (what fell)
    let lastT = -Infinity;
    let firstT = Infinity;
    const hasWater = hours.some((h) => h.w != null);
    for (const { t, v, w } of hours) {
      lastT = Math.max(lastT, t);
      firstT = Math.min(firstT, t);
      const d = localDate(new Date(t));
      if (snow.has(d) && t >= nowMs - HOUR) {
        snow.set(d, snow.get(d) + v);
        if (w != null) water.set(d, water.get(d) + w);
      } else if (snow.has(d) && d === today) {
        snow.set(d, snow.get(d) + v); // earlier today still counts toward today's bar
      }
      if (t >= nowMs - HOUR && t < nowMs + 72 * HOUR) next72 += v;
      if (t >= nowMs - 24 * HOUR && t < nowMs) past24 += v;
      if (before.has(d)) before.set(d, before.get(d) + v);
    }
    return { id, snow, water, next72, past24, before, lastT, firstT, hasWater, coversPast: firstT <= nowMs - 23 * HOUR };
  });

  const pick = (filter, value) => spread(per.filter(filter).map(value));
  const reach = (i) => (p) => covers(p.lastT, dates[i]);
  const sumDays = (p, from, to) => dates.slice(from, to + 1).reduce((a, d) => a + p.snow.get(d), 0);

  const temps = nwsTemps(nws, dates.slice(0, FORECAST_DAYS));
  const sky = nwsDaily(periods);
  const ensOn = (date) => ens?.days?.find((d) => d.date === date) ?? null;
  const days = dates.slice(0, FORECAST_DAYS).map((date, i) => {
    let s = pick(reach(i), (p) => p.snow.get(date)) ?? spread(per.map((p) => p.snow.get(date)));
    const e = i >= 3 ? ensOn(date) : null;
    if (e) s = { mid: round1((s.mid + e.mid) / 2), lo: round1(Math.min(s.lo, e.lo)), hi: round1(Math.max(s.hi, e.hi)) };
    return { date, snow: s.mid, snowLo: s.lo, snowHi: s.hi, ...temps.get(date), ...sky.get(date) };
  });
  const n72 = pick((p) => p.lastT >= nowMs + 66 * HOUR, (p) => p.next72) ?? spread(per.map((p) => p.next72));
  let n7 = pick(reach(FORECAST_DAYS - 1), (p) => sumDays(p, 0, FORECAST_DAYS - 1)) ?? spread(per.map((p) => sumDays(p, 0, FORECAST_DAYS - 1)));
  // With ensembles: the week is the days above added up (so it matches them), the range taking in both.
  if (ens?.next7 && days.slice(3).every((d) => ensOn(d.date))) {
    n7 = { mid: round1(days.reduce((a, d) => a + d.snow, 0)), lo: round1(Math.min(n7.lo, ens.next7.lo)), hi: round1(Math.max(n7.hi, ens.next7.hi)) };
  }
  // Days 8–14: the ensembles. Without them, the single runs that reach that far; with only one or two
  // of those, their middle could be a number neither forecasts (2″ and 39″ make "20″"), so the lower
  // one stands, with the range showing how much more is possible.
  const reaching = per.filter(reach(OUTLOOK_DAYS - 1)).map((p) => sumDays(p, FORECAST_DAYS, OUTLOOK_DAYS - 1)).sort((a, b) => a - b);
  const wk2 = ens?.week2 ? { ...ens.week2, sources: 'ensemble', runs: ens.runs }
    : reaching.length >= 3 ? { ...pick(reach(OUTLOOK_DAYS - 1), (p) => sumDays(p, FORECAST_DAYS, OUTLOOK_DAYS - 1)), sources: reaching.length }
      : reaching.length ? { mid: round1(reaching[0]), lo: round1(reaching[0]), hi: round1(reaching.at(-1)), sources: reaching.length } : null;
  const p24 = pick((p) => p.coversPast, (p) => p.past24);
  // The last five days' snow, from the models that cover each whole day (estimates, not reports).
  const pastDays = pastDates.map((date) => {
    const s = pick((p) => p.firstT <= Date.parse(`${date}T07:00:00Z`), (p) => p.before.get(date));
    return { date, snow: s ? s.mid : null };
  });

  // Water piling onto the snowpack over the next two weeks (cumulative, middle forecast), for the
  // season chart's projection. Only the models report water; NWS gives snow depth only.
  let cum = null;
  const waterAhead = [];
  for (let i = 0; i < OUTLOOK_DAYS; i++) {
    const s = pick((p) => p.hasWater && reach(i)(p), (p) => dates.slice(0, i + 1).reduce((a, d) => a + p.water.get(d), 0));
    if (!s) break;
    cum = s.mid;
    waterAhead.push(cum);
  }

  return {
    days,
    past24: p24?.mid ?? null,
    pastDays,
    past24Range: p24 ? [p24.lo, p24.hi] : null,
    next72: n72.mid,
    next72Range: [n72.lo, n72.hi],
    next7: n7.mid,
    next7Range: [n7.lo, n7.hi],
    week2: wk2 ? { mid: wk2.mid, range: [wk2.lo, wk2.hi], sources: wk2.sources, ...(wk2.runs ? { runs: wk2.runs } : {}) } : null,
    waterAhead,
    sources: usable.map((s) => s.id),
  };
}

const inSeason = (ymd, season) => (ymd && ymd >= season.start && ymd <= season.end ? ymd : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseCsc(feed, season) {
  const byKey = new Map();
  for (const entry of [...(feed.open_resorts ?? []), ...(feed.closed_resorts ?? [])]) {
    const r = entry.resort ?? {};
    const s = entry.snow_report ?? null;
    const sum = (prefix) =>
      ['green_trails', 'intermediate_trails', 'black_trails', 'expert_trails'].reduce((t, k) => t + (num(s?.[`${prefix}_${k}`]) ?? 0), 0);
    byKey.set(r.key, {
      isOpen: r.is_open === true,
      // e.g. "Resort Opens ASAP"; used only when there's no opening date.
      note: (r.enable_status_override && r.status_override_text?.trim()) || null,
      open: inSeason(r.resort_opening_date, season),
      close: inSeason(r.resort_closing_date, season),
      report: s && {
        new24: num(s.snow_total_24_hour),
        new48: num(s.snow_total_48_hour),
        depth: num(s.mid_mountain_snow_depth),
        surface: s.surface_conditions || null,
        lifts: { open: num(s.open_lifts) ?? 0, total: num(s.available_lifts) ?? num(r.available_lifts) },
        trails: { open: sum('open'), total: sum('available') },
        updated: s.updated ?? null,
        message: s.resort_conditions?.trim() || null,
      },
    });
  }
  return byKey;
}

const shortDate = (ymd) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

// One status per resort, phrased for people: what's the situation and how sure are we.
export function statusFor({ live, isOpen, open, close, when, opened, note, report }, today) {
  if (close && today > close) return { state: 'done', label: 'Closed for the season' };
  if (live && isOpen) {
    const parts = [];
    if (report?.lifts?.total) parts.push(`${report.lifts.open} of ${report.lifts.total} lifts`);
    if (report?.trails?.total) parts.push(`${report.trails.open} of ${report.trails.total} runs`);
    // How much of the mountain is open, by runs.
    const pct = report?.trails?.total ? Math.round((report.trails.open / report.trails.total) * 100) : null;
    return { state: 'open', label: 'Open', pct, detail: parts.join(' · ') || null };
  }
  // Opening day, before the lifts start (or before the resort's report says so).
  if (open && open === today) return { state: 'soon', label: 'Opens today', date: open, detail: null };
  if (open && open > today) {
    return { state: 'soon', label: `Opens ${when ?? shortDate(open)}`, date: open, detail: live ? null : 'Planned date' };
  }
  if (open && opened) return { state: 'open', label: 'Open', date: open, detail: `Opened ${shortDate(open)} · no live lift count` };
  if (open && live) return { state: 'late', label: 'Not open yet', date: open, detail: `Was planned for ${shortDate(open)}` };
  // Planned date has passed but we can't read this resort's site to confirm it.
  if (open) return { state: 'likely', label: 'Probably open', date: open, detail: `Set to open ${when ?? shortDate(open)} · can't confirm live` };
  if (note && /asap/i.test(note)) return { state: 'tba', label: 'Opening ASAP', detail: null };
  return { state: 'tba', label: 'Opens TBA', detail: null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries with a growing pause: network blips between GitHub's servers and the APIs are common.
export async function getJson(fetchFn, url, { tries = 3, backoff = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(backoff * i);
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json, application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function getText(fetchFn, url, { tries = 3, backoff = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(backoff * i);
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// The resort's live lift feed beats the once-a-morning snow report for lift counts.
function withLiveLifts(report, live) {
  if (!report || !live?.total) return report;
  return { ...report, lifts: { open: live.open, total: live.total } };
}

// Run tasks a few at a time so we're polite to api.weather.gov.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// Night skiing today: from the lift hours where the feed has them (a lift closing at 5 pm or later),
// otherwise the resort's published schedule on its night days. → { until, lifts?, source } or null.
export function nightFor(r, lifts, today, open = true) {
  const late = (lifts?.lifts ?? []).filter((l) => l.closes && l.closes >= '17:00');
  if (late.length) {
    return { until: late.map((l) => l.closes).sort().at(-1), lifts: late.map((l) => l.name), source: 'lifts' };
  }
  const n = r.night;
  if (!n || !open || lifts?.lifts?.length) return null;
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return n.days.includes(dow) ? { from: n.from, until: n.to, source: n.source } : null;
}

// skipModels: don't fetch the weather models this time (the caller reuses the last hour's forecast).
// prevEnsemble: the last published ensemble summaries ({ at, today, byId }), reused for up to 6 hours
// (the ensembles themselves only update every 6 hours, and each request is a big one).
const ENSEMBLE_EVERY_MS = 6 * 3_600_000;
export async function buildReport({ fetch: fetchFn = fetch, now = new Date(), log = () => {}, backoff = 2000, skipModels = false, prevLifts = {}, prevEnsemble = null } = {}) {
  const today = localDate(now);
  const season = seasonOf(today);
  const planned = PLANNED[season.name] ?? {};

  let csc = new Map();
  let cscOk = true;
  try {
    csc = parseCsc(await getJson(fetchFn, CSC_FEED, { backoff }), season);
  } catch (err) {
    cscOk = false;
    log(`Colorado Ski Country feed failed: ${err.message}`);
  }

  // Each model is one request covering every resort; NWS is two requests per resort (gridded
  // numbers + the text forecast); SNOTEL is two requests for every station (this season, normals).
  const stations = [...new Set(RESORTS.flatMap((r) => [r.snotel[0], ...(r.snotelMore ?? []).map((x) => x[0])]))];
  const stationName = (t) => RESORTS.flatMap((r) => [r.snotel, ...(r.snotelMore ?? [])]).find((x) => x[0] === t)[1];
  const wy = waterYear(today);
  const lastSeasonEnd = `${wy.startYear}-07-31`;
  const liftIds = Object.keys(LIFT_SOURCES);
  const [modelData, nwsData, nwsText, snowNow, snowNormal, liftData, noaaSnow] = await Promise.all([
    Promise.all(MODELS.map(async (m) => {
      if (skipModels) return null;
      try {
        const data = await getJson(fetchFn, modelUrl(m.id, RESORTS, MODEL_DAYS), { backoff });
        return Array.isArray(data) ? data : [data];
      } catch (err) {
        log(`Model ${m.label} failed: ${err.message}${err.cause ? ` (${err.cause.code ?? err.cause.message})` : ''}`);
        return null;
      }
    })),
    pool(RESORTS, 4, async (r) => {
      try {
        return (await getJson(fetchFn, `${NWS}/${r.nws[0]}/${r.nws[1]},${r.nws[2]}`, { backoff })).properties;
      } catch (err) {
        log(`NWS forecast failed for ${r.name}: ${err.message}`);
        return null;
      }
    }),
    pool(RESORTS, 4, async (r) => {
      try {
        return (await getJson(fetchFn, `${NWS}/${r.nws[0]}/${r.nws[1]},${r.nws[2]}/forecast`, { backoff })).properties.periods;
      } catch (err) {
        log(`NWS text forecast failed for ${r.name}: ${err.message}`);
        return null;
      }
    }),
    getJson(fetchFn, snotelUrl(stations, wy.start, today), { backoff }).then(parseSnotel).catch((err) => {
      log(`SNOTEL (this season) failed: ${err.message}`);
      return null;
    }),
    getJson(fetchFn, snotelUrl(stations, `${wy.startYear - 1}-10-01`, lastSeasonEnd), { backoff }).then(parseSnotel).catch((err) => {
      log(`SNOTEL (normals) failed: ${err.message}`);
      return null;
    }),
    // Live lift-by-lift status from each resort's own lift data.
    // Outside the ski day the last check stands (lift-hours.js).
    pool(liftIds, 4, async (id) => {
      const src = LIFT_SOURCES[id];
      if (!liftsDue('CO', now, prevLifts[id]?.checked)) return prevLifts[id] ?? null;
      try {
        const body = src.type === 'json' ? await getJson(fetchFn, src.url, { backoff }) : await getText(fetchFn, src.url, { backoff });
        const lifts = src.parse(body);
        if (!lifts.length) throw new Error('no lifts found');
        return summarizeLifts(lifts, src.page, now.toISOString());
      } catch (err) {
        log(`Lift status failed for ${id}: ${err.message}`);
        return null;
      }
    }),
    // NOAA's modelled snow depth and snow water at each resort.
    pool(RESORTS, 4, async (r) => {
      try {
        return parseNohrsc(await getJson(fetchFn, nohrscUrl(r.at), { backoff }));
      } catch (err) {
        log(`NOAA snow model failed for ${r.name}: ${err.message}`);
        return null;
      }
    }),
  ]);
  const liftsById = Object.fromEntries(liftIds.map((id, i) => [id, liftData[i]]));

  // Vail Resorts' mountains: their own snow reports (every update) and lift/run status (ski hours,
  // like the other lift feeds; otherwise the last reading stands). See vail.js.
  const vailIds = Object.keys(VAIL_SITES);
  const vail = Object.fromEntries(await pool(vailIds, 2, async (id) => {
    const site = VAIL_SITES[id];
    let snow = null;
    let terrain = null;
    try {
      snow = parseVailSnow(await getText(fetchFn, snowPage(site), { backoff }));
    } catch (err) {
      log(`Snow report failed for ${id}: ${err.message}`);
    }
    const prev = prevLifts[id];
    if (liftsDue('CO', now, prev?.checked)) {
      try {
        const t = parseVailTerrain(await getText(fetchFn, liftPage(site), { backoff }));
        if (t?.lifts.length) terrain = { ...summarizeLifts(t.lifts, liftPage(site), now.toISOString()), runs: t.trails };
      } catch (err) {
        log(`Lift status failed for ${id}: ${err.message}`);
      }
    } else if (prev?.runs) terrain = prev;
    return [id, { snow, terrain }];
  }).then((rows) => rows));
  for (const [id, v] of Object.entries(vail)) if (v.terrain) liftsById[id] = v.terrain;
  const snowpack = Object.fromEntries(stations.map((t) => {
    const name = stationName(t);
    const s = snowNow && stationSeason({ current: snowNow.get(t), normals: snowNormal?.get(t), today });
    return [t, s && { name, ...s }];
  }).filter(([, s]) => s));
  // Ensembles: fresh every 6 hours (and each new day), otherwise the last ones.
  let ensemble = prevEnsemble?.today === today && now - Date.parse(prevEnsemble.at ?? 0) < ENSEMBLE_EVERY_MS ? prevEnsemble : null;
  let ensembleTriedAt = null;
  if (!ensemble && !skipModels) {
    ensembleTriedAt = now.toISOString();
    try {
      const data = await getJson(fetchFn, ensembleUrl(RESORTS), { backoff });
      const locs = Array.isArray(data) ? data : [data];
      const byId = {};
      RESORTS.forEach((r, i) => {
        const e = summarizeEnsemble(locs[i], (ms) => localDate(new Date(ms)));
        const at = e?.dates.indexOf(today) ?? -1;
        if (e && at >= 0 && e.dates.length >= at + OUTLOOK_DAYS) {
          byId[r.id] = { runs: e.runs, days: e.days.slice(at, at + OUTLOOK_DAYS), next7: e.sum(at, at + FORECAST_DAYS - 1), week2: e.sum(at + FORECAST_DAYS, at + OUTLOOK_DAYS - 1) };
        }
      });
      ensemble = Object.keys(byId).length ? { at: now.toISOString(), today, byId } : null;
    } catch (err) {
      log(`Ensemble forecasts failed: ${err.message}`);
      ensemble = prevEnsemble?.today === today ? prevEnsemble : null; // (older is still better than none, same day)
    }
  }
  const forecasts = RESORTS.map((r, i) => blendForecast({
    ens: ensemble?.byId?.[r.id] ?? null,
    nws: nwsData[i],
    periods: nwsText[i],
    sources: [
      { id: 'nws', hours: nwsSnowHours(nwsData[i]) },
      ...MODELS.map((m, k) => ({ id: m.id, hours: snowHours(modelData[k]?.[i]) })),
    ],
  }, now));

  // UV index for each forecast day (with the model forecasts: reused between their hourly runs).
  if (!skipModels) {
    try {
      const uv = await getJson(fetchFn, uvUrl(RESORTS, FORECAST_DAYS), { backoff });
      (Array.isArray(uv) ? uv : [uv]).forEach((u, i) => {
        const byDate = new Map((u?.daily?.time ?? []).map((t, k) => [t, u.daily.uv_index_max[k]]));
        for (const d of forecasts[i]?.days ?? []) {
          const v = byDate.get(d.date);
          d.uv = v == null ? null : Math.round(v);
        }
      });
    } catch (err) {
      log(`UV index failed: ${err.message}`);
    }
  }

  // When each webcam image was taken, for cameras whose server says so (Last-Modified). Nothing is
  // called "live": these are snapshots, and some providers (Brownrice) serve frames an hour or more old
  // without saying when they're from, so those simply show no time. (The app re-reads the time itself
  // where the server allows it; this is for the ones that don't.)
  const camsWithTimes = structuredClone(CAMS);
  const camList = Object.values(camsWithTimes).flatMap((e) => e.cams ?? []);
  await pool(camList, 6, async (cam) => {
    for (const method of ['HEAD', 'GET']) { // (some servers only answer a full request)
      try {
        const res = await fetchFn(cam.image, { method, headers: { 'User-Agent': USER_AGENT } });
        const lm = res.headers.get('last-modified');
        const served = Date.parse(res.headers.get('date') ?? '') || Date.now();
        res.body?.cancel?.();
        // (A "modified" time of right now is the server's invention, not when the picture was taken.)
        if (res.ok && lm && Math.abs(served - Date.parse(lm)) > 15000) { cam.updated = new Date(lm).toISOString(); break; }
        if (res.ok) break;
      } catch { /* try the next way, or no time */ }
    }
  });

  // The forecasters' key messages and active alerts (see insights.js).
  const insights = await fetchInsights(getJson, fetchFn, { backoff, log });

  const resorts = RESORTS.map((r, i) => {
    let c = r.csc ? csc.get(r.csc) : undefined;
    // A Vail Resorts mountain: its own report, shaped like Colorado Ski Country's.
    const v = vail[r.id];
    if (!c && v && (v.snow || v.terrain)) {
      const t = v.terrain;
      const report = { ...(v.snow ?? {}), lifts: t ? { open: t.open, total: t.total } : undefined, trails: t?.runs, source: snowPage(VAIL_SITES[r.id]) };
      c = { isOpen: Boolean(t && (t.runs?.open > 0 || t.open > 0)), report, vail: true };
    }
    const live = Boolean(c);
    const p = planned[r.id] ?? {};
    const facts = live
      ? { live, isOpen: c.isOpen, open: c.open, close: c.close, note: c.note, report: withLiveLifts(c.report, liftsById[r.id]) }
      : { live, isOpen: false, open: inSeason(p.open, season), close: inSeason(p.close, season), when: p.when, opened: p.opened, note: p.note };
    // Vail's pages say what's open but not their season dates: keep the announced ones.
    if (c?.vail) Object.assign(facts, { open: inSeason(p.open, season), close: inSeason(p.close, season), when: p.when });
    // A report from a closed resort is usually last season's leftovers.
    // (Vail Resorts' own reports are current even before opening day: keep those.)
    const report = live && (c.isOpen || c.vail) ? withLiveLifts(c.report, liftsById[r.id]) : null;
    return {
      id: r.id,
      name: r.name,
      region: r.region,
      at: r.at,
      url: r.url,
      live,
      status: statusFor(facts, today),
      // Opening and closing days for this season; null when unknown.
      dates: { open: facts.open ?? null, close: facts.close ?? null, when: facts.when ?? null, planned: !live || Boolean(c?.vail) },
      report,
      forecast: forecasts[i],
      lifts: liftsById[r.id] ?? null,
      night: nightFor(r, liftsById[r.id], today, live && (c?.isOpen ?? true)),
      noaa: noaaSnow[i] ?? null,
      avgSnow: r.avgSnow ?? null,
      // Webcams (src/cams.json, scripts/cams.mjs): still images that update on their own, with when
      // each was last taken where the camera's server says (see camTimes below).
      cams: camsWithTimes[r.id] ?? null,
      // Key into `snowpack` (resorts can share a station).
      station: snowpack[r.snotel[0]] ? r.snotel[0] : null,
      // Every station averaged for this resort (the main one first), when there's more than one.
      ...(r.snotelMore?.length ? { stations: [r.snotel[0], ...r.snotelMore.map((x) => x[0])].filter((t) => snowpack[t]) } : {}),
    };
  });

  return {
    insights,
    ensemble,
    generated: now.toISOString(),
    today,
    season: season.name,
    sources: {
      coloradoSki: cscOk,
      forecasts: forecasts.filter(Boolean).length,
      resorts: RESORTS.length,
      nws: nwsData.filter(Boolean).length,
      models: Object.fromEntries(MODELS.map((m, k) => [m.id, Boolean(modelData[k])])),
      // When the model forecasts were fetched (carried forward if a later update reuses them).
      modelsAt: modelData.some(Boolean) ? now.toISOString() : null,
      ensembleTriedAt,
      snotel: Object.keys(snowpack).length,
      lifts: liftData.filter(Boolean).length,
      noaa: noaaSnow.filter(Boolean).length,
    },
    resorts,
    snowpack,
  };
}
