// Builds the single data.json the app reads. Pure apart from the fetch you pass in,
// so it runs the same in the GitHub Action, the local preview server and tests.
import { RESORTS, PLANNED } from './resorts.js';
import { UT_RESORTS } from './resorts-ut.js';
import { TAHOE_RESORTS, MAMMOTH_RESORTS, SOCAL_RESORTS, CA_PLANNED } from './resorts-ca.js';
import { SKI_UTAH, parseSkiUtah, parseSkiUtahResort, skiUtahResortUrl } from './skiutah.js';
import { MODELS, modelUrl, snowHours, uvUrl } from './models.js';
import { ensembleUrl, summarizeEnsemble } from './ensemble.js';
import { parseSnotel, snotelUrl, stationSeason, waterYear } from './snotel.js';
import { LIFT_SOURCES, summarizeLifts } from './lifts.js';
import { liftsDue } from './lift-hours.js';
import { VAIL_SITES, snowPage, liftPage, parseVailSnow, parseVailTerrain } from './vail.js';
import { mtnpowderUrl, parseMtnPowderSnow } from './mtnpowder.js';
import { powdrSnowUrl, parsePowdrSnow } from './powdr.js';
import { ALTA_PAGE, MTROSE_PAGE, SUGARBOWL_PAGE, parseAltaSnow, parseMtRoseSnow, parseSugarBowlSnow } from './pages.js';
// Resorts whose snow report is only on their own page: [page, reader].
const PAGE_REPORTS = { alta: [ALTA_PAGE, parseAltaSnow], 'mt-rose': [MTROSE_PAGE, parseMtRoseSnow], 'sugar-bowl': [SUGARBOWL_PAGE, parseSugarBowlSnow] };
import { fetchInsights, OFFICES } from './insights.js';
import { WOLF_CREEK_REPORT, parseWolfCreek } from './wolfcreek.js';
import CAMS from './cams.json' with { type: 'json' };

import { nohrscUrl, parseNohrsc } from './noaa.js';

export const CSC_FEED = 'https://snow.coloradoski.com/view/publicreport-feed';
const NWS = 'https://api.weather.gov/gridpoints';
const USER_AGENT = 'Powdar (github.com/JMiltier/powdar)';
// The area being built's time zone (set at the start of each build: areas build one after another).
let TZ = 'America/Denver';
export const FORECAST_DAYS = 7; // days shown day by day
const OUTLOOK_DAYS = 14; // days 8–14 are summarised as a less-certain "week 2"
export const MODEL_DAYS = 14; // two weeks: longer requests count extra against the free allowance
const MM_PER_INCH = 25.4;
const DAY_MS = 86_400_000;

let dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const setZone = (tz) => {
  TZ = tz;
  dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
};

// 'YYYY-MM-DD' in the area's own time.
export const localDate = (d) => dateFmt.format(d);
const localHour = (ms) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)));
// Resorts' morning snow reports give the 24 hours to about 7 AM, and a report day runs 7 AM to 7 AM
// (src/report.js reportDay puts a morning report on the day before). The latest such 7 AM, at or
// before `ms`: the estimates are reckoned to it too, so every number on the map covers the same hours.
export const REPORT_HOUR = 7;
// How forecasts are made: published ones made another way are remade, not reused (scripts/build.mjs).
export const FORECAST_METHOD = 2; // 2: the cautious correction, NOAA's Blend unscaled, the scorecard's weights
export function reportAnchor(ms) {
  let t = Math.floor(ms / 3_600_000) * 3_600_000;
  for (let i = 0; i < 26 && localHour(t) !== REPORT_HOUR; i++) t -= 3_600_000;
  return t;
}

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
// The weighted middle: values [{ v, w }] → the value where half the weight lies on either side.
export function weightedMiddle(values) {
  const s = values.filter((x) => x.w > 0).sort((a, b) => a.v - b.v);
  const total = s.reduce((a, x) => a + x.w, 0);
  let run = 0;
  for (const x of s) { run += x.w; if (run >= total / 2) return round1(x.v); }
  return null;
}
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
// The weather that shapes the snow surface, day by day (yesterday, today, tomorrow) at mid-mountain,
// from the models' hourly data (each hour the middle of the models that have it):
//   hi: the day's warmest (°F), lo: the coldest of the night before (midnight–8 am),
//   sun: average sunshine 10 am–3 pm (W/m², 0 overcast … ~600+ bright), cloud: average cover (%),
//   gust: strongest gust (mph).
export function surfaceWeather(locs, today) {
  const hours = new Map(); // ms → { t: [], s: [], c: [], g: [] }
  for (const loc of locs) {
    const h = loc?.hourly;
    if (!h?.time) continue;
    h.time.forEach((t, i) => {
      const ms = t * 1000;
      if (!hours.has(ms)) hours.set(ms, { t: [], s: [], c: [], g: [] });
      const e = hours.get(ms);
      if (h.temperature_2m?.[i] != null) e.t.push(h.temperature_2m[i]);
      if (h.shortwave_radiation?.[i] != null) e.s.push(h.shortwave_radiation[i]);
      if (h.cloud_cover?.[i] != null) e.c.push(h.cloud_cover[i]);
      if (h.wind_gusts_10m?.[i] != null) e.g.push(h.wind_gusts_10m[i]);
    });
  }
  if (!hours.size) return null;
  const med = (a) => { if (!a.length) return null; const s2 = [...a].sort((x, y) => x - y); return s2[Math.floor(s2.length / 2)]; };
  const hourOf = (ms) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)));
  const rows = [...hours.entries()].map(([ms, e]) => ({ date: localDate(new Date(ms)), hour: hourOf(ms), t: med(e.t), s: med(e.s), c: med(e.c), g: med(e.g) }));
  const f = (c) => Math.round(c * 9 / 5 + 32);
  return [-1, 0, 1].map((n) => {
    const date = addDays(today, n);
    const day = rows.filter((r) => r.date === date);
    const night = day.filter((r) => r.hour < 8 && r.t != null);
    const mid = day.filter((r) => r.hour >= 10 && r.hour <= 15);
    const vals = (list, k) => list.map((r) => r[k]).filter((v) => v != null);
    const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
    const temps = vals(day, 't');
    return {
      date,
      hi: temps.length ? f(Math.max(...temps)) : null,
      lo: night.length ? f(Math.min(...vals(night, 't'))) : null,
      sun: mean(vals(mid, 's')),
      cloud: mean(vals(mid, 'c')),
      gust: vals(day, 'g').length ? Math.round(Math.max(...vals(day, 'g'))) : null,
    };
  });
}

// ens (optional): this resort's ensemble summary for today ({ days: [{ date, mid, lo, hi }], next7,
// week2, runs }), see src/ensemble.js. Days 1–3 stay with the single runs and the Weather Service
// (strongest up close); days 4–7 average their consensus with the ensembles' middle; days 8–14 come
// from the ensembles alone.
export function blendForecast({ sources, nws, periods, ens = null, weights = null }, now) {
  const today = localDate(now);
  const dates = Array.from({ length: OUTLOOK_DAYS }, (_, i) => addDays(today, i));
  // (A week back: the −7d view and a resort's "last 7 days" bars, the models' estimate filling any day
  // the resort didn't report.)
  const pastDates = [7, 6, 5, 4, 3, 2, 1].map((n) => addDays(today, -n));
  const usable = sources.filter((s) => s.hours?.length);
  if (!usable.length) return null;
  const nowMs = now.getTime();
  const anchor = reportAnchor(nowMs);
  const anchors = [anchor, anchor + 24 * HOUR];

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
      // (Past days are report days, 7 AM to 7 AM, to line up with the resorts' reports.)
      const rd = localDate(new Date(t - REPORT_HOUR * HOUR));
      if (before.has(rd)) before.set(rd, before.get(rd) + v);
    }
    // The 24 hours, 3 days and week to this morning's report time, and to tomorrow's (so a forecast
    // reused for an hour or two past 7 AM still has the right one).
    const win = (a, h) => hours.reduce((sum, x) => (x.t >= a - h * HOUR && x.t < a ? sum + x.v : sum), 0);
    const spans = anchors.map((a) => ({ a, h24: win(a, 24), h72: win(a, 72), h168: win(a, 168) }));
    return { id, snow, water, next72, past24, spans, before, lastT, firstT, hasWater, coversPast: firstT <= nowMs - 23 * HOUR };
  });

  const pick = (filter, value) => spread(per.filter(filter).map(value));
  // (Days 1–3 lean toward the sources with the better record here, when there's one: weights[0–2].)
  const picked = (filter, value, w) => {
    const s = pick(filter, value);
    if (!s || !w) return s;
    const mid = weightedMiddle(per.filter(filter).map((p) => ({ v: value(p), w: w[p.id] })));
    return mid == null ? s : { ...s, mid };
  };
  const reach = (i) => (p) => covers(p.lastT, dates[i]);
  const sumDays = (p, from, to) => dates.slice(from, to + 1).reduce((a, d) => a + p.snow.get(d), 0);

  const temps = nwsTemps(nws, dates.slice(0, FORECAST_DAYS));
  const sky = nwsDaily(periods);
  const ensOn = (date) => ens?.days?.find((d) => d.date === date) ?? null;
  const days = dates.slice(0, FORECAST_DAYS).map((date, i) => {
    let s = picked(reach(i), (p) => p.snow.get(date), weights?.[i]) ?? spread(per.map((p) => p.snow.get(date)));
    const e = i >= 3 ? ensOn(date) : null;
    if (e) s = { mid: round1((s.mid + e.mid) / 2), lo: round1(Math.min(s.lo, e.lo)), hi: round1(Math.max(s.hi, e.hi)) };
    return { date, snow: s.mid, snowLo: s.lo, snowHi: s.hi, ...temps.get(date), ...sky.get(date) };
  });
  const n72 = picked((p) => p.lastT >= nowMs + 66 * HOUR, (p) => p.next72, weights?.[3] ?? null) ?? spread(per.map((p) => p.next72));
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
  // The estimates for the −1d, −3d and −7d views: snow in the 24 hours, 3 days and week to a morning's
  // report time (the same hours the resorts' reports cover, so the views nest: −1d ≤ −3d ≤ −7d), from
  // the forecasts that reach back that far (the models; NWS doesn't look back). One per anchor.
  const past = anchors.map((a, k) => {
    const span = (key, h) => pick((p) => p.firstT <= a - (h - 1) * HOUR && p.lastT >= a - HOUR, (p) => p.spans[k][key])?.mid ?? null;
    return { asOf: a, h24: span('h24', 24), h72: span('h72', 72), h168: span('h168', 168) };
  });
  // The last seven report days' snow (7 AM to 7 AM), from the models that cover each whole day (estimates, not reports).
  const today7 = localHour(nowMs) >= REPORT_HOUR ? anchor : anchor + 24 * HOUR;
  const pastDays = pastDates.map((date, i) => {
    const start = today7 - (pastDates.length - i) * 24 * HOUR;
    const s = pick((p) => p.firstT <= start + HOUR, (p) => p.before.get(date));
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

  // The last 24 hours and the next 24, hour by hour (the middle of the forecasts that have each hour):
  // what's falling now, and how much has fallen since a resort's report, whenever the app is opened.
  // { from: the first hour's start (ms), v: [inches in each hour] }.
  const from = Math.floor(nowMs / HOUR) * HOUR - 24 * HOUR;
  const byHour = Array.from({ length: 48 }, () => []);
  for (const { hours } of usable) {
    for (const { t, v } of hours) {
      const k = Math.floor((t - from) / HOUR);
      if (k >= 0 && k < 48) byHour[k].push(v);
    }
  }
  const middle = (a) => { const s2 = [...a].sort((x, y) => x - y); const n = s2.length; return n % 2 ? s2[(n - 1) / 2] : (s2[n / 2 - 1] + s2[n / 2]) / 2; };
  const hourly = byHour.some((a) => a.length) ? { from, v: byHour.map((a) => (a.length ? Math.round(middle(a) * 100) / 100 : null)) } : null;

  return {
    days,
    hourly,
    past24: p24?.mid ?? null,
    past,
    // Each source's own next 72 hours (as blended: the models with this resort's correction), for the
    // audit's check that the blend stays within them (src/audit.js) and the resort page.
    next72By: Object.fromEntries(per.filter((p) => p.lastT >= nowMs + 66 * HOUR).map((p) => [p.id, round1(p.next72)])),
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
export function statusFor({ live, isOpen, open, close, when, opened, reopen, note, report }, today) {
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
  // (reopen: a resort that opened, closed, and has a day to open again: Wolf Creek after the 2026 floods.)
  const verb = reopen ? 'Reopens' : 'Opens';
  if (open && open === today) return { state: 'soon', label: `${verb} today`, date: open, detail: null };
  if (open && open > today) {
    return { state: 'soon', label: `${verb} ${when ?? shortDate(open)}`, date: open, detail: live ? null : 'Planned date' };
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
// A report not updated in over two days: its 24-hour / 48-hour / 7-day snow is old news, not today's
// (the depth, surface and season total still stand). Marked so the app can say how old it is.
// ("2026-11-21T06:54:18.757032-07:00": Colorado Ski Country's six-digit seconds, trimmed to read safely.)
export const isoMs = (iso) => Date.parse(String(iso ?? '').replace(/(\.\d{3})\d+/, '$1'));
// A resort's own report's snow numbers, to lay over another source's (nulls don't erase what's there).
export function newerSnow(mp) {
  const out = { new24: mp.new24, new48: mp.new48, new72: mp.new72, new7d: mp.new7d, updated: mp.updated };
  for (const k of ['depth', 'seasonTotal', 'surface']) if (mp[k] != null) out[k] = mp[k];
  return out;
}

// Every resort's report, checked the same way: its totals run 24 hours ≤ 48 ≤ 72 ≤ 7 days, so one that
// breaks that order is a field the resort left behind (Deer Valley, Nov 23, 2026: 6″ in 72 hours, 0″
// in 7 days) and is dropped. And a closed resort's report of nothing but zeros, season included, is a
// placeholder, not a measurement (Big Bear's before opening; Kirkwood's): no report, so the estimate stands.
// Once the day has turned, a report's numbers stand as they were until the resort posts again: a page
// that rolls its figures over by itself at midnight (Keystone's, Nov 23–24, 2026: 24 hours to 0″
// under the morning's time, which read as "0″ Sunday, 5.9″ Saturday") isn't a new report. The same
// day, a change under the same time is the resort correcting itself, and stands (Northstar, Nov 26:
// 7 days 39.8″, then 18″, both "6:28 AM").
// And one older than the report already held never replaces it (Vail's site serves cached copies:
// Keystone's page gave Tuesday's 6 AM report, then Monday's again, minutes apart).
export function sameReport(report, prev, now = new Date()) {
  if (!report?.updated || !prev?.updated) return report;
  const at = isoMs(report.updated);
  const before = isoMs(prev.updated);
  if (!Number.isFinite(at) || !Number.isFinite(before) || at > before) return report;
  if (at === before && localDate(new Date(now)) === localDate(new Date(at))) return report;
  const out = { ...report };
  for (const k of ['new24', 'new48', 'new72', 'new7d', 'depth', 'seasonTotal']) if (prev[k] != null) out[k] = prev[k];
  out.updated = prev.updated;
  return out;
}

export function saneReport(report, isOpen = true) {
  if (!report) return report;
  const out = { ...report };
  let floor = out.new24 ?? 0;
  for (const k of ['new48', 'new72', 'new7d']) {
    if (out[k] == null) continue;
    if (out[k] < floor) out[k] = null;
    else floor = out[k];
  }
  const snow = ['new24', 'new48', 'new72', 'new7d', 'seasonTotal'].map((k) => out[k]).filter((v) => v != null);
  if (!isOpen && snow.length && snow.every((v) => v === 0) && !out.depth && !out.seasonTotal) {
    return { ...out, new24: null, new48: null, new72: null, new7d: null, placeholder: true };
  }
  return out;
}

export function freshSnow(report, now) {
  if (!report?.updated) return report;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(report.updated) ? Date.parse(`${report.updated}T14:00:00Z`) : Date.parse(report.updated);
  if (!Number.isFinite(t) || now - t <= 48 * 3_600_000) return report;
  // (A week or more old: its base and season total are stale too.)
  const old = now - t > 7 * 24 * 3_600_000 ? { depth: null, seasonTotal: null } : {};
  return { ...report, new24: null, new48: null, new72: null, new7d: null, ...old, staleSince: report.updated };
}

// The lifts number, meaning "lifts running today" the way the resorts' own reports do: those turning
// now while any are; before they start, those scheduled; once they've stopped for the night, the most
// that ran today.
export function liftsToday(live) {
  const now = (live.open ?? 0) + (live.hold ?? 0);
  if (now > 0) return now;
  if (live.ranToday > 0) return live.ranToday;
  return live.scheduled ?? 0;
}
function withLiveLifts(report, live) {
  if (!report || !live?.total) return report;
  return { ...report, lifts: { open: liftsToday(live), total: live.total } };
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

// Snow the resort reported, day by day (the last 14 days): each report's 24-hour figure goes on the
// day it covers (see reportDay); the 48-hour figure fills in the day before that when it's missing. A day keeps
// the most reported for it (a later report that day can only add to the overnight number).
// Each entry also keeps the weather models' (uncorrected) estimate for that day, when known, so the
// two can be compared (see modelCorrection).
// Which day a report's "24 hours" means: reports go out in the morning, covering the day before and
// the night (a report day runs 7 AM to 7 AM: reportAnchor), so the day before the update. Nothing for
// a report more than two days old. (A later update the same day is the same report day revised: see
// snowLog. Counting an afternoon update as that day's own double-counted the night before: Beaver
// Creek, Nov 21, 2026, a Friday-night storm logged on both days, 21″ for 3 days its 7-day total of
// 13.8″ ruled out.)
export function reportDay(updated, today) {
  if (!updated) return addDays(today, -1);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(updated) ? null : new Date(updated);
  const day = d ? localDate(d) : updated;
  if (day < addDays(today, -2)) return null;
  return addDays(day, -1);
}
// An update from noon on: the morning's report revised during the day (its 24 hours now reach into
// today's snow).
const lateUpdate = (updated) => Boolean(updated && !/^\d{4}-\d{2}-\d{2}$/.test(updated) && localHour(Date.parse(updated)) >= 12);

// open: the resort is open now; openedOn: the day it opened. A resort that isn't open isn't measuring:
// its 0″ isn't logged (snow it does report, is), and its logged 0″ days, and any from before it
// opened, are dropped, so the models' estimate stands for those (Purgatory's feed said 0″ under a 5″
// storm the week before it opened; Kirkwood's placeholder page, 0″ under two feet).
// The morning's report sets its day; a later update only fills a day with none. Its 48- and 72-hour
// figures set the days before (the resort's own later word on them: they correct what was logged).
export function snowLog(prev, today, report, modelPast = {}, { open = true, openedOn = null } = {}) {
  const log = new Map((prev ?? [])
    .filter((e) => e.date >= addDays(today, -14) && !(e.snow === 0 && (!open || (openedOn && e.date < openedOn))))
    .map((e) => [e.date, { ...e }]));
  const set = (date, v) => {
    if (v == null || v < 0) return;
    if (v === 0 && !open) { log.delete(date); return; } // (a closed resort's 0″: no word either way)
    const e = log.get(date) ?? { date, snow: 0 };
    e.snow = Math.round(v * 10) / 10; // (48 h − 24 h: 22.099999… → 22.1)
    log.set(date, e);
  };
  const day = report?.new24 != null ? reportDay(report.updated, today) : null;
  // (A report with no time on it, Ski Utah's, that still says what yesterday's said is most likely the
  // same report, not the same snow again: it isn't logged twice.)
  const stale = day && !report.updated && report.new24 > 0 && !log.has(day) && log.get(addDays(day, -1))?.snow === report.new24;
  if (day && !stale) {
    const late = lateUpdate(report.updated);
    if (!late || !log.has(day)) set(day, report.new24);
    if (!late && report.new48 != null && report.new48 >= report.new24) {
      // (Where the resort gives a 7-day total, that's the referee: a correction stands only if it brings
      // the week nearer that total, not further from it. Vail's pages' 48 hours have contradicted their
      // own 24 hours and 7 days: Beaver Creek's fixed a doubled day, Nov 23, 2026; Keystone's would have
      // doubled one, Nov 24; Breckenridge's wiped a 2″ day its 7-day total still counted, Nov 25.)
      const week = () => [...log.values()].filter((e) => e.date > addDays(day, -7) && e.date <= day).reduce((a, e) => a + e.snow, 0);
      const correct = (date, v) => {
        const before = log.get(date) ? { ...log.get(date) } : null;
        const off = report.new7d != null ? Math.abs(week() - report.new7d) : 0;
        set(date, v);
        if (report.new7d != null && Math.abs(week() - report.new7d) > off + 0.3) {
          if (before) log.set(date, before);
          else log.delete(date);
        }
      };
      correct(addDays(day, -1), report.new48 - report.new24);
      if (report.new72 != null && report.new72 >= report.new48) correct(addDays(day, -2), report.new72 - report.new48);
    }
  }
  // (Each logged day gets the models' latest estimate of it too, once there is one.)
  for (const e of log.values()) if (modelPast[e.date] != null) e.model = modelPast[e.date];
  return [...log.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// How far off the weather models have been at a resort, from its own snow reports over the last two
// weeks: reported ÷ modeled (each +1″, so a dry spell doesn't make wild ratios), kept within 0.6–2×,
// and trusted only as the evidence builds: by how many snowy days it rests on (full at 8) and how much
// snow (full at 60″ reported plus modeled). One storm is a hint, not a pattern: Colorado, Nov 17–23,
// 2026, the models a third of what Vail measured, and a ×1.8 learned from that storm alone had its
// next forecast at 13″ where the Weather Service and the models' own middle said 4–8″.
// → { factor, reported, modeled, days } (factor 1 = no change).
// (A day the resort logged 0″ while the models saw half a foot or more is a resort not measuring yet,
// not a model gone wrong: it doesn't count.)
export function modelCorrection(log) {
  const both = (log ?? []).filter((e) => e.snow != null && e.model != null && !(e.snow === 0 && e.model >= 6));
  const reported = both.reduce((a, e) => a + e.snow, 0);
  const modeled = both.reduce((a, e) => a + e.model, 0);
  if (both.length < 2 || reported + modeled < 2) return { factor: 1, reported, modeled, days: both.length };
  const ratio = Math.min(2, Math.max(0.6, (reported + 1) / (modeled + 1)));
  const snowy = both.filter((e) => e.snow >= 1 || e.model >= 1).length;
  const weight = Math.min(1, snowy / 8) * Math.min(1, (reported + modeled) / 60);
  return { factor: round1(1 + weight * (ratio - 1)), reported: round1(reported), modeled: round1(modeled), days: both.length };
}

// The forecasts' scorecard. Each morning every source's forecast (unadjusted) for the next three report
// days (7 AM to 7 AM) is kept, the first reading of each day and lead: { date, lead (1 = the report
// day just starting, 2 and 3 the ones after), by: { source: inches } }. Two weeks are kept.
export function forecastLog(prev, today, nowMs, bySource) {
  const keep = (prev ?? []).filter((e) => e.date >= addDays(today, -14));
  if (!bySource || !Object.values(bySource).some((h) => h?.length)) return keep;
  const first = localDate(new Date(nowMs - REPORT_HOUR * HOUR)); // (the report day under way)
  for (let lead = 1; lead <= 3; lead++) {
    const date = addDays(first, lead - 1);
    if (keep.some((e) => e.date === date && e.lead === lead)) continue;
    const by = {};
    for (const [id, hours] of Object.entries(bySource)) {
      if (!hours?.length) continue;
      const inDay = hours.filter((h) => localDate(new Date(h.t - REPORT_HOUR * HOUR)) === date);
      if (inDay.length >= 20) by[id] = round1(inDay.reduce((a, h) => a + h.v, 0)); // (a whole day of it)
    }
    if (Object.keys(by).length) keep.push({ date, lead, by });
  }
  return keep.sort((a, b) => a.date.localeCompare(b.date) || a.lead - b.lead);
}
// Each source's record across an area's resorts, from the scorecard against what each resort then
// reported for those days: → { [lead]: { [source]: { n, mae (inches off, on average), bias (inches
// over, + , or under, −) } } }.
export function forecastSkill(resorts) {
  const acc = {};
  for (const r of resorts) {
    const got = new Map((r.snowLog ?? []).map((e) => [e.date, e.snow]));
    for (const e of r.forecastLog ?? []) {
      if (!got.has(e.date)) continue;
      for (const [id, v] of Object.entries(e.by)) {
        const a = ((acc[e.lead] ??= {})[id] ??= { n: 0, abs: 0, diff: 0 });
        a.n++; a.abs += Math.abs(v - got.get(e.date)); a.diff += v - got.get(e.date);
      }
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([lead, by]) => [lead, Object.fromEntries(Object.entries(by)
    .map(([id, a]) => [id, { n: a.n, mae: round1(a.abs / a.n), bias: round1(a.diff / a.n) }]))]));
}
// Blend weights for a lead from the record: nearer-right sources count more (1 / (inches off + ½)),
// once a source has 20 resort-days behind it; sources without that many count as the average.
// → { [source]: weight } or null (nothing to go on yet).
export const SKILL_MIN = 20;
export function skillWeights(skill, lead) {
  const by = skill?.[lead];
  if (!by) return null;
  const known = Object.entries(by).filter(([, s]) => s.n >= SKILL_MIN);
  if (known.length < 2) return null;
  const w = Object.fromEntries(known.map(([id, s]) => [id, 1 / (s.mae + 0.5)]));
  const mean = Object.values(w).reduce((a, b) => a + b, 0) / known.length;
  return new Proxy(w, { get: (t, k) => (k in t ? t[k] : mean) });
}

// Great-circle distance between two [lat, lon] points, in km.
export function km([a1, o1], [a2, o2]) {
  const rad = Math.PI / 180;
  const h = Math.sin(((a2 - a1) * rad) / 2) ** 2 + Math.cos(a1 * rad) * Math.cos(a2 * rad) * Math.sin(((o2 - o1) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
// Resorts this close share storms, and the models' misses with them (the Wasatch, Nov 20–21: reports
// 2–4× the models at Solitude and Park City, while closed Alta and Brighton showed the models' 2–3″;
// Colorado, Nov 17–23: Vail, Beaver Creek and Crested Butte 1.7–1.8× the models, Aspen 35–45 km off
// still on the models alone). Nearer ones count far more (nearWeight).
export const NEARBY_KM = 50;
const nearWeight = (d) => 1 / Math.max(d, 2);
// How much of a neighbor's miss carries over: all of it within 20 km, half by NEARBY_KM.
const nearTrust = (d) => (d <= 20 ? 1 : 1 - (0.5 * (d - 20)) / (NEARBY_KM - 20));
const carried = (ratio, d) => 1 + (ratio - 1) * nearTrust(d);

// A resort with no correction of its own (it hasn't reported: closed, or no feed) takes its reporting
// neighbors' within NEARBY_KM, nearer ones counting more. own: modelCorrection results, by index.
export function nearbyCorrection(resorts, own) {
  return resorts.map((r, i) => {
    if (own[i].days >= 2) return own[i];
    const near = resorts.map((o, j) => ({ j, d: km(r.at, o.at) })).filter((x) => x.j !== i && own[x.j].days >= 2 && x.d <= NEARBY_KM);
    if (!near.length) return own[i];
    const w = near.reduce((a, x) => a + nearWeight(x.d), 0);
    const factor = round1(near.reduce((a, x) => a + nearWeight(x.d) * carried(own[x.j].factor, x.d), 0) / w);
    return { ...own[i], factor, nearby: near.map((x) => resorts[x.j].id) };
  });
}

// The models' estimates of the past days where a resort didn't report, from how far off they were at
// its reporting neighbors (within NEARBY_KM) those same days: each report day's estimate here times
// the neighbors' report-to-model ratio that day (each +1, capped ⅓–3×; nearer neighbors count more).
// Run on the finished area (after any reused forecast is put back). Sets each resort's
// forecast.nearby = { days: { date: inches }, past: [{ asOf, h24, h72, h168 }], from: [ids] }.
export function calibrateNearby(resorts) {
  const day = (r, date) => r.forecast?.pastDays?.find((x) => x.date === date)?.snow ?? null;
  const raw = (r, date) => (day(r, date) == null ? null : day(r, date) / (r.forecast.correction?.factor || 1));
  // (A logged 0″ under half a foot modeled is a resort not measuring yet: no evidence either way.)
  const logged = (r, date) => {
    const e = r.snowLog?.find((x) => x.date === date);
    return e && !(e.snow === 0 && (raw(r, date) ?? 0) >= 6) ? e.snow : null;
  };
  for (const r of resorts) {
    if (!r.forecast?.pastDays) continue;
    delete r.forecast.nearby;
    const near = resorts.filter((o) => o !== r && o.snowLog?.length && o.forecast?.pastDays).map((o) => ({ o, d: km(r.at, o.at) })).filter((x) => x.d <= NEARBY_KM);
    if (!near.length) continue;
    const days = {};
    const from = new Set();
    for (const { date } of r.forecast.pastDays) {
      const base = raw(r, date);
      if (base == null) continue;
      let w = 0;
      let ratio = 0;
      for (const { o, d } of near) {
        const got = logged(o, date);
        const modeled = raw(o, date);
        if (got == null || modeled == null) continue;
        ratio += nearWeight(d) * carried(Math.min(3, Math.max(1 / 3, (got + 1) / (modeled + 1))), d);
        w += nearWeight(d);
        from.add(o.id);
      }
      if (w) days[date] = round1((base * ratio) / w);
    }
    if (!Object.keys(days).length) continue;
    // Each past span the same way: its days' adjusted total over their unadjusted (a report-time
    // anchor at 7 AM: the span's last report day is the calendar day of 11 AM the day before).
    const past = (r.forecast.past ?? []).map((p) => {
      const end = new Date(p.asOf - 20 * 3_600_000).toISOString().slice(0, 10);
      const scale = (n) => {
        let cal = 0;
        let orig = 0;
        for (let k = 0; k < n; k++) {
          const date = addDays(end, -k);
          if (day(r, date) == null) continue;
          orig += day(r, date);
          cal += days[date] ?? day(r, date);
        }
        return orig > 0 ? cal / orig : 1;
      };
      const sc = (v, n) => (v == null ? null : round1(v * scale(n)));
      return { asOf: p.asOf, h24: sc(p.h24, 1), h72: sc(p.h72, 3), h168: sc(p.h168, 7) };
    });
    r.forecast.nearby = { days, past, from: [...from] };
  }
  return resorts;
}

// The terrain log: one entry per day ({ date, runs, lifts } open), today's replaced as it updates.
export function terrainLog(prev, today, runs, lifts) {
  const log = (prev ?? []).filter((e) => e.date !== today && e.date >= addDays(today, -7));
  if (runs != null || lifts != null) log.push({ date: today, runs, lifts });
  return log.sort((a, b) => a.date.localeCompare(b.date));
}

// Night skiing today: from the lift hours where the feed has them (a lift running past 5:30 pm),
// otherwise the resort's published schedule on its night days. → { until, lifts?, source } or null.
export function nightFor(r, lifts, today, open = true) {
  if (!open) return null;
  // (Past 5:30 pm, on a lift running or scheduled today: village gondolas run to 5, which isn't night
  // skiing; Keystone's night lifts run to about 8.)
  const late = (lifts?.lifts ?? []).filter((l) => l.closes && l.closes > '17:30' && l.status !== 'closed');
  if (late.length) {
    return { until: late.map((l) => l.closes).sort().at(-1), lifts: late.map((l) => l.name), source: 'lifts' };
  }
  const n = r.night;
  if (!n || lifts?.lifts?.length) return null;
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return n.days.includes(dow) ? { from: n.from, until: n.to, source: n.source } : null;
}

// skipModels: don't fetch the weather models this time (the caller reuses the last hour's forecast).
// Where a state's report comes from. Colorado: Colorado Ski Country's feed, Vail Resorts' pages,
// the lift feeds, Wolf Creek's own report. Utah: Ski Utah's snow report (src/skiutah.js) and Park
// City's own pages (a Vail Resorts mountain). Everything else (forecasts, ensembles, snowpack,
// NOAA, insights) works the same for any state.
export const REGIONS = {
  CO: {
    code: 'CO', name: 'Colorado', resorts: RESORTS, planned: PLANNED, csc: true,
    vailIds: ['vail', 'beaver-creek', 'breckenridge', 'keystone', 'crested-butte'], liftSources: LIFT_SOURCES, cams: CAMS,
    offices: OFFICES, alertArea: 'CO', wolfCreek: true,
    // One-time repairs from a resort's own report, where a page fault had logged it wrong (Keystone's
    // midnight rollover, Nov 24, 2026; its Monday report said Sunday 2.8″, Saturday 3.1″).
    logFixes: { keystone: { '2026-11-21': 3.1, '2026-11-22': 2.8 }, breckenridge: { '2026-11-23': 2 } }, // (Breck: its Nov 24 report)
    // Their own snow reports too (Alterra's, on MtnPowder): they often update after posting to
    // Colorado Ski Country in the morning (A-Basin, Nov 21: 0″ at 6 AM there, 3″ at noon on its own).
    mtnpowder: { 'arapahoe-basin': 93, steamboat: 6, 'winter-park': 5 },
    // And Powdr's (Copper, Eldora): 72 hours and 7 days besides, with the time posted.
    powdr: { 'copper-mountain': 'api.coppercolorado.com', eldora: 'api.eldora.com' },
  },
  UT: {
    code: 'UT', name: 'Utah', resorts: UT_RESORTS, planned: {}, skiUtah: true, hours: 'UT',
    vailIds: ['park-city'], liftSources: LIFT_SOURCES, cams: {},
    // Their own snow reports where they publish one (newer than, or filling in, Ski Utah's).
    mtnpowder: { solitude: 65, 'deer-valley': 49 }, powdr: { snowbird: 'api.snowbird.com' }, pages: ['alta'],
    offices: [{ id: 'SLC', name: 'Salt Lake City', covers: 'all of Utah’s ski country, the Wasatch to Brian Head' }], alertArea: 'UT',
  },
  // California's three areas (src/resorts-ca.js), on Pacific time. No status feed like Colorado's or
  // Utah's: Vail Resorts' own pages, and the resorts' live lift feeds (a lift running: open).
  TAHOE: {
    code: 'TAHOE', name: 'Tahoe', resorts: TAHOE_RESORTS, planned: CA_PLANNED, tz: 'America/Los_Angeles', hours: 'CA',
    vailIds: ['heavenly', 'northstar', 'kirkwood'], liftSources: LIFT_SOURCES, cams: {},
    // (Alpine Meadows' own feed carries no snow report now: its measuring spots are in Palisades'.)
    mtnpowder: { palisades: 61, 'alpine-meadows': [61, ['Station5', 'Station4', 'Station6']] },
    powdr: { boreal: 'api.rideboreal.com', 'soda-springs': 'api.skisodasprings.com' }, pages: ['mt-rose', 'sugar-bowl'],
    // One-time: these three's logged days before Nov 20, 2026 came from reports whose Pacific-time
    // stamp wasn't read, so each update logged the same report as "yesterday" (Northstar's 21.7″ twice,
    // Kirkwood's placeholder zeros). The models' estimate stands for those days instead.
    logsFrom: { heavenly: '2026-11-20', northstar: '2026-11-20', kirkwood: '2026-11-20' },
    offices: [
      { id: 'REV', name: 'Reno', covers: 'the Tahoe basin, Truckee and Mt Rose' },
      { id: 'STO', name: 'Sacramento', covers: 'the west slope: Donner Summit, Highway 50, Kirkwood to Dodge Ridge' },
    ],
    alertArea: 'CA,NV', alertPoints: [[39.24, -120.2], [39.31, -120.34], [38.8, -120.03]],
  },
  MAMMOTH: {
    code: 'MAMMOTH', name: 'Mammoth', resorts: MAMMOTH_RESORTS, planned: CA_PLANNED, tz: 'America/Los_Angeles', hours: 'CA',
    vailIds: [], liftSources: LIFT_SOURCES, cams: {},
    mtnpowder: { 'mammoth-mountain': 60, june: 59 },
    offices: [{ id: 'REV', name: 'Reno', covers: 'the Eastern Sierra, Mammoth and June' }],
    alertArea: 'CA', alertPoints: [[37.68, -119.03]],
  },
  SOCAL: {
    code: 'SOCAL', name: 'SoCal', resorts: SOCAL_RESORTS, planned: CA_PLANNED, tz: 'America/Los_Angeles', hours: 'CA',
    vailIds: [], liftSources: LIFT_SOURCES, cams: {},
    mtnpowder: { 'bear-mountain': 57, 'snow-summit': 58 },
    offices: [
      { id: 'SGX', name: 'San Diego', covers: 'the San Bernardino Mountains: Big Bear and Snow Valley' },
      { id: 'LOX', name: 'Los Angeles', covers: 'the San Gabriels: Mountain High and Baldy' },
    ],
    alertArea: 'CA', alertPoints: [[34.23, -116.9], [34.33, -117.65]],
  },
};

// prevEnsemble: the last published ensemble summaries ({ at, today, byId }), reused for up to 6 hours
// (the ensembles themselves only update every 6 hours, and each request is a big one).
const ENSEMBLE_EVERY_MS = 6 * 3_600_000;
// prevResorts: last published resorts by id (their surface weather and terrain log carry forward).
export async function buildReport({ region: R = REGIONS.CO, fetch: fetchFn = fetch, now = new Date(), log = () => {}, backoff = 2000, skipModels = false, prevLifts = {}, prevEnsemble = null, prevResorts = {} } = {}) {
  setZone(R.tz ?? 'America/Denver');
  const RESORTS = R.resorts;
  const LIFT_SOURCES = R.liftSources;
  const CAMS = R.cams;
  const today = localDate(now);
  const season = seasonOf(today);
  const planned = { ...(R.planned[season.name] ?? {}) };

  let csc = new Map();
  let cscOk = true;
  if (R.csc) {
    try {
      csc = parseCsc(await getJson(fetchFn, CSC_FEED, { backoff }), season);
    } catch (err) {
      cscOk = false;
      log(`Colorado Ski Country feed failed: ${err.message}`);
    }
  }
  // Ski Utah: open resorts' 24-hour snow and base; the rest's opening dates (as planned dates).
  let skiUtah = new Map();
  if (R.skiUtah) {
    try {
      skiUtah = parseSkiUtah(await getText(fetchFn, SKI_UTAH, { backoff }), { startYear: Number(season.start.slice(0, 4)) });
      for (const r of RESORTS) {
        const e = skiUtah.get(r.skiutah);
        if (!e || e.open) continue;
        planned[r.id] = e.closedSeason ? { close: addDays(today, -1), note: 'closed this season' } : e.tba ? { note: 'TBA' } : { open: e.date };
      }
    } catch (err) {
      cscOk = false;
      log(`Ski Utah's snow report failed: ${err.message}`);
    }
  }
  // And each open resort's own page there: the report's time, 48 hours, 7 days, season so far.
  const skiUtahPages = {};
  if (R.skiUtah) {
    await pool(RESORTS.filter((r) => skiUtah.get(r.skiutah)?.open), 2, async (r) => {
      try {
        skiUtahPages[r.id] = parseSkiUtahResort(await getText(fetchFn, skiUtahResortUrl(r.skiutah), { backoff }));
      } catch (err) {
        log(`Ski Utah page failed for ${r.id}: ${err.message}`);
      }
    });
  }

  // Each model is one request covering every resort; NWS is two requests per resort (gridded
  // numbers + the text forecast); SNOTEL is two requests for every station (this season, normals).
  // (Not every resort has a SNOTEL station near enough: Mammoth's and Southern California's don't.)
  const stations = [...new Set(RESORTS.filter((r) => r.snotel).flatMap((r) => [r.snotel[0], ...(r.snotelMore ?? []).map((x) => x[0])]))];
  const stationName = (t) => RESORTS.filter((r) => r.snotel).flatMap((r) => [r.snotel, ...(r.snotelMore ?? [])]).find((x) => x[0] === t)[1];
  const wy = waterYear(today);
  const lastSeasonEnd = `${wy.startYear}-07-31`;
  const liftIds = Object.keys(LIFT_SOURCES).filter((id) => RESORTS.some((r) => r.id === id)); // (this area's)
  const [modelData, nwsData, nwsText, snowNow, snowNormal, liftData, noaaSnow] = await Promise.all([
    Promise.all(MODELS.map(async (m) => {
      if (skipModels) return null;
      try {
        const data = await getJson(fetchFn, modelUrl(m.id, RESORTS, Math.min(m.days ?? MODEL_DAYS, MODEL_DAYS), TZ), { backoff });
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
    !stations.length ? null : getJson(fetchFn, snotelUrl(stations, wy.start, today), { backoff }).then(parseSnotel).catch((err) => {
      log(`SNOTEL (this season) failed: ${err.message}`);
      return null;
    }),
    !stations.length ? null : getJson(fetchFn, snotelUrl(stations, `${wy.startYear - 1}-10-01`, lastSeasonEnd), { backoff }).then(parseSnotel).catch((err) => {
      log(`SNOTEL (normals) failed: ${err.message}`);
      return null;
    }),
    // Live lift-by-lift status from each resort's own lift data.
    // Outside the ski day the last check stands (lift-hours.js).
    pool(liftIds, 4, async (id) => {
      const src = LIFT_SOURCES[id];
      if (!liftsDue(R.hours ?? 'CO', now, prevLifts[id]?.checked)) return prevLifts[id] ?? null;
      try {
        const body = src.type === 'json' ? await getJson(fetchFn, src.url, { backoff }) : await getText(fetchFn, src.url, { backoff });
        const lifts = src.parse(body);
        if (!lifts.length) throw new Error('no lifts found');
        // Which runs are open, where the resort lists them (the same page, or a feed of its own).
        let runs = null;
        if (src.runs) {
          try {
            const rb = !src.runs.url ? body : src.runs.type === 'json' ? await getJson(fetchFn, src.runs.url, { backoff }) : await getText(fetchFn, src.runs.url, { backoff });
            runs = src.runs.parse(rb);
          } catch (err) {
            log(`Run list failed for ${id}: ${err.message}`);
          }
        }
        return summarizeLifts(lifts, src.page, now.toISOString(), runs);
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

  // Alterra's mountains on MtnPowder: their full snow report (new snow, base, trails), every update.
  // (An entry is the feed's resort id, or [id, stations] for a mountain read from another's feed.)
  const mtnpowder = Object.fromEntries(await pool(Object.entries(R.mtnpowder ?? {}), 2, async ([id, n]) => {
    const [feedId, stations] = Array.isArray(n) ? n : [n, null];
    try {
      return [id, parseMtnPowderSnow(await getJson(fetchFn, mtnpowderUrl(feedId), { backoff }), stations)];
    } catch (err) {
      log(`Snow report failed for ${id}: ${err.message}`);
      return [id, null];
    }
  }));

  // Powdr's mountains: their own snow reports, every update.
  const powdrSnow = Object.fromEntries(await pool(Object.entries(R.powdr ?? {}), 2, async ([id, host]) => {
    try {
      return [id, parsePowdrSnow(await getJson(fetchFn, powdrSnowUrl(host), { backoff }))];
    } catch (err) {
      log(`Snow report failed for ${id}: ${err.message}`);
      return [id, null];
    }
  }));

  // And the reports only on a resort's own page (Alta, Mt. Rose).
  const pageSnow = Object.fromEntries(await pool(R.pages ?? [], 2, async (id) => {
    const [url, parse] = PAGE_REPORTS[id];
    try {
      return [id, parse(await getText(fetchFn, url, { backoff }))];
    } catch (err) {
      log(`Snow report failed for ${id}: ${err.message}`);
      return [id, null];
    }
  }));

  // Vail Resorts' mountains: their own snow reports (every update) and lift/run status (ski hours,
  // like the other lift feeds; otherwise the last reading stands). See vail.js.
  const vailIds = R.vailIds;
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
    if (liftsDue(R.hours ?? 'CO', now, prev?.checked)) {
      try {
        const t = parseVailTerrain(await getText(fetchFn, liftPage(site), { backoff }));
        if (t?.lifts.length) terrain = { ...summarizeLifts(t.lifts, liftPage(site), now.toISOString(), t.runList), runs: t.trails };
      } catch (err) {
        log(`Lift status failed for ${id}: ${err.message}`);
      }
    } else if (prev?.runs) terrain = prev;
    return [id, { snow, terrain }];
  }).then((rows) => rows));
  for (const [id, v] of Object.entries(vail)) if (v.terrain) liftsById[id] = v.terrain;
  // The most lifts seen running today (live feeds read 0 once lifts close for the night, while
  // Colorado Ski Country's reports keep the day's count): kept per day across updates.
  for (const [id, l] of Object.entries(liftsById)) {
    if (!l?.total) continue;
    const prev = prevLifts[id];
    const before = prev?.day === today ? prev.ranToday ?? 0 : 0;
    liftsById[id] = { ...l, day: today, ranToday: Math.max(before, (l.open ?? 0) + (l.hold ?? 0)) };
  }
  // Wolf Creek's own snow report (no feed covers it).
  let wolf = null;
  if (R.wolfCreek) try {
    wolf = parseWolfCreek(await getText(fetchFn, WOLF_CREEK_REPORT, { backoff }));
  } catch (err) {
    log(`Wolf Creek's snow report failed: ${err.message}`);
  }
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
      const data = await getJson(fetchFn, ensembleUrl(RESORTS, TZ), { backoff });
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
  // Each resort's model correction, learned from its own reports (see modelCorrection): applied to the
  // weather models and ensembles, not the Weather Service's forecast (its forecasters already adjust).
  // One without reports of its own borrows its reporting neighbors' (nearbyCorrection).
  const corrections = nearbyCorrection(RESORTS, RESORTS.map((r) => modelCorrection(prevResorts[r.id]?.snowLog)));
  const scaleHours = (hours, f) => (hours && f !== 1 ? hours.map((h) => ({ ...h, v: h.v * f, w: h.w == null ? h.w : h.w * f })) : hours);
  const scaleEns = (e, f) => {
    if (!e || f === 1) return e;
    const sc = (x) => x && { mid: round1(x.mid * f), lo: round1(x.lo * f), hi: round1(x.hi * f) };
    return { ...e, days: e.days.map((d) => ({ date: d.date, ...sc(d) })), next7: sc(e.next7), week2: sc(e.week2) };
  };
  // The sources' record in this area so far (the scorecard, against the resorts' reports): weights
  // for days 1–3 and the next 72 hours, once there's enough of it.
  const skill = forecastSkill(Object.values(prevResorts));
  const lw = [1, 2, 3].map((lead) => skillWeights(skill, lead));
  const weights = lw.some(Boolean) ? [...lw, lw[0] ?? lw[1] ?? lw[2]] : null;
  const forecasts = RESORTS.map((r, i) => {
    const f = corrections[i].factor;
    const out = blendForecast({
      weights,
      ens: scaleEns(ensemble?.byId?.[r.id] ?? null, f),
      nws: nwsData[i],
      periods: nwsText[i],
      sources: [
        { id: 'nws', hours: nwsSnowHours(nwsData[i]) },
        // (NOAA's Blend is bias-corrected already: not scaled again.)
        ...MODELS.map((m, k) => ({ id: m.id, hours: m.calibrated ? snowHours(modelData[k]?.[i]) : scaleHours(snowHours(modelData[k]?.[i]), f) })),
      ],
    }, now);
    if (out) { out.correction = corrections[i]; out.method = FORECAST_METHOD; }
    return out;
  });
  // The models' own (uncorrected) estimate of each past day, for the snow log's comparison.
  const rawPast = RESORTS.map((r, i) => {
    const days = forecasts[i]?.pastDays ?? [];
    const f = corrections[i].factor || 1;
    return Object.fromEntries(days.filter((d) => d.snow != null).map((d) => [d.date, round1(d.snow / f)]));
  });

  // UV index for each forecast day (with the model forecasts: reused between their hourly runs).
  if (!skipModels) {
    try {
      const uv = await getJson(fetchFn, uvUrl(RESORTS, FORECAST_DAYS, TZ), { backoff });
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
  const insights = await fetchInsights(getJson, fetchFn, { backoff, log, offices: R.offices, area: R.alertArea, points: R.alertPoints ?? null });

  const resorts = RESORTS.map((r, i) => {
    let c = r.csc ? csc.get(r.csc) : undefined;
    // A Vail Resorts mountain: its own report, shaped like Colorado Ski Country's.
    const v = vail[r.id];
    if (!c && v && (v.snow || v.terrain)) {
      const t = v.terrain;
      const report = { ...(v.snow ?? {}), lifts: t ? { open: t.open, total: t.total } : undefined, trails: t?.runs, source: snowPage(VAIL_SITES[r.id]) };
      c = { isOpen: Boolean(t && (t.runs?.open > 0 || t.open > 0)), report, vail: true };
    }
    // Wolf Creek: open when today's patrol report has terrain open (it runs weekends only early on,
    // so an older report says nothing about today).
    // Ski Utah: open when its list says so (with its 24-hour snow and base); Park City's own pages
    // (above) come first.
    const su = R.skiUtah && skiUtah.get(r.skiutah);
    if (!c && su?.open) c = { isOpen: true, report: { ...(skiUtahPages[r.id] ?? { new24: su.new24 ?? null, depth: su.depth ?? null }), source: skiUtahResortUrl(r.skiutah) }, own: true };
    if (!c && r.id === 'wolf-creek' && wolf) {
      const fresh = wolf.updated && wolf.updated >= addDays(today, -1);
      // (Its report gives the lifts running, not the total, so no "of N".)
      const report = { ...wolf, lifts: wolf.lifts != null ? { open: fresh && wolf.openPct > 0 ? wolf.lifts : 0, total: null } : undefined };
      c = { isOpen: Boolean(fresh && wolf.updated === today && wolf.openPct > 0), report, own: true };
    }
    // No status anywhere else, but the resort's own lift feed says a lift is running today: open
    // (California's resorts besides Vail's), with its own snow report where it publishes one.
    // (The resort's own report: MtnPowder's, Powdr's, or read from its page.)
    const mp = mtnpowder[r.id] ?? powdrSnow[r.id] ?? pageSnow[r.id];
    if (!c && (liftsById[r.id]?.total || mp)) {
      // (Where the area's own list says a resort isn't open, Ski Utah's, a lift turning before its
      // opening day is staff or a preview, not opening day: Brighton, Nov 23, 2026, the day before.)
      const listedClosed = R.skiUtah && su && !su.open;
      const isOpen = !listedClosed && (liftsById[r.id]?.total ? liftsToday(liftsById[r.id]) > 0 : (mp?.trails?.open ?? 0) > 0);
      c = { isOpen, report: mp ? { ...mp, source: LIFT_SOURCES[r.id]?.page ?? r.url } : {}, own: true };
    }
    // A resort with a report from Colorado Ski Country or Ski Utah that also publishes its own: its snow
    // numbers from whichever was updated last (lifts and runs stay with the live feeds). The same
    // morning's (posted a little before the copy it sent on): it fills in what that copy leaves out,
    // the 72 hours, 7 days and season total. (Vail Resorts' pages are their own report already.)
    if (c && !c.vail && mp?.updated) {
      const cscAt = isoMs(c.report?.updated) || 0;
      if (Date.parse(mp.updated) > cscAt) {
        c = { ...c, report: { ...c.report, ...newerSnow(mp), source: LIFT_SOURCES[r.id]?.page ?? r.url } };
      } else if (cscAt && localDate(new Date(mp.updated)) === localDate(new Date(cscAt))) {
        const fill = Object.fromEntries(['new72', 'new7d', 'seasonTotal'].filter((k) => c.report?.[k] == null && mp[k] != null).map((k) => [k, mp[k]]));
        c = { ...c, report: { ...c.report, ...fill } };
      }
    }
    const live = Boolean(c);
    const p = planned[r.id] ?? {};
    const facts = live
      ? { live, isOpen: c.isOpen, open: c.open, close: c.close, note: c.note, report: withLiveLifts(c.report, liftsById[r.id]) }
      : { live, isOpen: false, open: inSeason(p.open, season), close: inSeason(p.close, season), when: p.when, opened: p.opened, reopen: p.reopen, note: p.note };
    // Vail's pages say what's open but not their season dates: keep the announced ones. (And a resort
    // whose own page has gone quiet keeps its announced status: Wolf Creek's, reopening after a closure.)
    if (c?.vail || c?.own) Object.assign(facts, { open: inSeason(p.open, season), close: inSeason(p.close, season), when: p.when, opened: p.opened, reopen: p.reopen });
    // A report from a closed resort is usually last season's leftovers.
    // (Vail Resorts' own reports are current even before opening day: keep those.)
    const report = live && (c.isOpen || c.vail || c.own) ? saneReport(freshSnow(withLiveLifts(sameReport(c.report, prevResorts[r.id]?.report, now), liftsById[r.id]), now), c.isOpen) : null;
    return {
      id: r.id,
      name: r.name,
      ...(r.short ? { short: r.short } : {}),
      region: r.region,
      at: r.at,
      url: r.url,
      live,
      status: statusFor(facts, today),
      // Opening and closing days for this season; null when unknown.
      dates: { open: facts.open ?? null, close: facts.close ?? null, when: facts.when ?? null, planned: !live || Boolean(c?.vail || c?.own) },
      report,
      // Its key in Colorado Ski Country's feed, when that's where its report comes from: the app reads
      // the feed itself too (it's open to browsers), so a report posted since this build shows at once.
      ...(r.csc && c && !c.vail && !c.own ? { csc: r.csc } : {}),
      forecast: forecasts[i],
      lifts: liftsById[r.id] ?? null,
      night: nightFor(r, liftsById[r.id], today, live && (c?.isOpen ?? true)),
      // The weather that shapes the snow surface (yesterday, today, tomorrow); the last one when the
      // models weren't fetched this time.
      wx: surfaceWeather(MODELS.map((m, k) => modelData[k]?.[i]), today) ?? (prevResorts[r.id]?.wx?.some((d) => d.date === today) ? prevResorts[r.id].wx : null),
      // Each source's forecast for the next three report days, for the scorecard (forecastSkill).
      // (Only where there's a report to score it against.)
      forecastLog: !live ? [] : forecastLog(prevResorts[r.id]?.forecastLog, today, now.getTime(), skipModels ? null : {
        nws: nwsSnowHours(nwsData[i]), ...Object.fromEntries(MODELS.map((m, k) => [m.id, snowHours(modelData[k]?.[i])])),
      }),
      // Runs and lifts open each day (the last 8 days), to see new terrain opening.
      terrainLog: terrainLog(prevResorts[r.id]?.terrainLog, today, report?.trails?.open ?? null, (liftsById[r.id] ?? report?.lifts)?.open ?? null),
      // What the resort reported falling, day by day (see snowLog).
      snowLog: snowLog((prevResorts[r.id]?.snowLog ?? []).filter((e) => !R.logsFrom?.[r.id] || e.date >= R.logsFrom[r.id])
        .map((e) => (R.logFixes?.[r.id]?.[e.date] != null ? { ...e, snow: R.logFixes[r.id][e.date] } : e)), today, report, rawPast[i], { open: Boolean(facts.isOpen || (facts.opened && facts.open && facts.open <= today)), openedOn: facts.open && facts.open <= today ? facts.open : null }),
      aspect: r.aspect ?? null,
      noaa: noaaSnow[i] ?? null,
      avgSnow: r.avgSnow ?? null,
      // Webcams (src/cams.json, scripts/cams.mjs): still images that update on their own, with when
      // each was last taken where the camera's server says (see camTimes below).
      cams: camsWithTimes[r.id] ?? null,
      // Key into `snowpack` (resorts can share a station).
      station: r.snotel && snowpack[r.snotel[0]] ? r.snotel[0] : null,
      // Every station averaged for this resort (the main one first), when there's more than one.
      ...(r.snotel && r.snotelMore?.length ? { stations: [r.snotel[0], ...r.snotelMore.map((x) => x[0])].filter((t) => snowpack[t]) } : {}),
    };
  });

  return {
    state: R.code,
    stateName: R.name,
    tz: TZ, // (times in the app show in the area's own time)
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
      // The forecasts' record here (see forecastSkill), and whether it weighted today's blend.
      skill: forecastSkill(resorts),
      weighted: Boolean(weights),
    },
    resorts,
    snowpack,
  };
}
