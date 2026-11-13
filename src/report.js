// Builds the single data.json the app reads. Pure apart from the fetch you pass in,
// so it runs the same in the GitHub Action, the local preview server and tests.
import { RESORTS, PLANNED } from './resorts.js';
import { MODELS, modelUrl, snowHours } from './models.js';
import { parseSnotel, snotelUrl, stationSeason, waterYear } from './snotel.js';
import { LIFT_SOURCES, summarizeLifts } from './lifts.js';
import { liftsDue } from './lift-hours.js';
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
    if (p.isDaytime) Object.assign(day, { sky: p.shortForecast, wind: p.windSpeed, pop });
    else Object.assign(day, { night: p.shortForecast, nightPop: pop });
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
export function blendForecast({ sources, nws, periods }, now) {
  const today = localDate(now);
  const dates = Array.from({ length: OUTLOOK_DAYS }, (_, i) => addDays(today, i));
  const usable = sources.filter((s) => s.hours?.length);
  if (!usable.length) return null;
  const nowMs = now.getTime();

  const per = usable.map(({ id, hours }) => {
    const snow = new Map(dates.map((d) => [d, 0]));
    const water = new Map(dates.map((d) => [d, 0]));
    let next72 = 0;
    let past24 = 0;
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
    }
    return { id, snow, water, next72, past24, lastT, hasWater, coversPast: firstT <= nowMs - 23 * HOUR };
  });

  const pick = (filter, value) => spread(per.filter(filter).map(value));
  const reach = (i) => (p) => covers(p.lastT, dates[i]);
  const sumDays = (p, from, to) => dates.slice(from, to + 1).reduce((a, d) => a + p.snow.get(d), 0);

  const temps = nwsTemps(nws, dates.slice(0, FORECAST_DAYS));
  const sky = nwsDaily(periods);
  const days = dates.slice(0, FORECAST_DAYS).map((date, i) => {
    const s = pick(reach(i), (p) => p.snow.get(date)) ?? spread(per.map((p) => p.snow.get(date)));
    return { date, snow: s.mid, snowLo: s.lo, snowHi: s.hi, ...temps.get(date), ...sky.get(date) };
  });
  const n72 = pick((p) => p.lastT >= nowMs + 66 * HOUR, (p) => p.next72) ?? spread(per.map((p) => p.next72));
  const n7 = pick(reach(FORECAST_DAYS - 1), (p) => sumDays(p, 0, FORECAST_DAYS - 1)) ?? spread(per.map((p) => sumDays(p, 0, FORECAST_DAYS - 1)));
  const wk2 = pick(reach(OUTLOOK_DAYS - 1), (p) => sumDays(p, FORECAST_DAYS, OUTLOOK_DAYS - 1));
  const p24 = pick((p) => p.coversPast, (p) => p.past24);

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
    past24Range: p24 ? [p24.lo, p24.hi] : null,
    next72: n72.mid,
    next72Range: [n72.lo, n72.hi],
    next7: n7.mid,
    next7Range: [n7.lo, n7.hi],
    week2: wk2 ? { mid: wk2.mid, range: [wk2.lo, wk2.hi], sources: per.filter(reach(OUTLOOK_DAYS - 1)).length } : null,
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
  return { state: 'tba', label: 'Opening date TBA', detail: null };
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

// skipModels: don't fetch the weather models this time (the caller reuses the last hour's forecast).
export async function buildReport({ fetch: fetchFn = fetch, now = new Date(), log = () => {}, backoff = 2000, skipModels = false, prevLifts = {} } = {}) {
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
  const stations = [...new Set(RESORTS.map((r) => r.snotel[0]))];
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
  const snowpack = Object.fromEntries(stations.map((t) => {
    const name = RESORTS.find((r) => r.snotel[0] === t).snotel[1];
    const s = snowNow && stationSeason({ current: snowNow.get(t), normals: snowNormal?.get(t), today });
    return [t, s && { name, ...s }];
  }).filter(([, s]) => s));
  const forecasts = RESORTS.map((r, i) => blendForecast({
    nws: nwsData[i],
    periods: nwsText[i],
    sources: [
      { id: 'nws', hours: nwsSnowHours(nwsData[i]) },
      ...MODELS.map((m, k) => ({ id: m.id, hours: snowHours(modelData[k]?.[i]) })),
    ],
  }, now));

  const resorts = RESORTS.map((r, i) => {
    const c = r.csc ? csc.get(r.csc) : undefined;
    const live = Boolean(c);
    const p = planned[r.id] ?? {};
    const facts = live
      ? { live, isOpen: c.isOpen, open: c.open, close: c.close, note: c.note, report: withLiveLifts(c.report, liftsById[r.id]) }
      : { live, isOpen: false, open: inSeason(p.open, season), close: inSeason(p.close, season), when: p.when, opened: p.opened, note: p.note };
    // A report from a closed resort is usually last season's leftovers.
    const report = live && c.isOpen ? withLiveLifts(c.report, liftsById[r.id]) : null;
    return {
      id: r.id,
      name: r.name,
      region: r.region,
      at: r.at,
      url: r.url,
      live,
      status: statusFor(facts, today),
      // Opening and closing days for this season; null when unknown.
      dates: { open: facts.open ?? null, close: facts.close ?? null, when: facts.when ?? null, planned: !live },
      report,
      forecast: forecasts[i],
      lifts: liftsById[r.id] ?? null,
      noaa: noaaSnow[i] ?? null,
      avgSnow: r.avgSnow ?? null,
      // Key into `snowpack` (resorts can share a station).
      station: snowpack[r.snotel[0]] ? r.snotel[0] : null,
    };
  });

  return {
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
      snotel: Object.keys(snowpack).length,
      lifts: liftData.filter(Boolean).length,
      noaa: noaaSnow.filter(Boolean).length,
    },
    resorts,
    snowpack,
  };
}
