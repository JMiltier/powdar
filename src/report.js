// Builds the single data.json the app reads. Pure apart from the fetch you pass in,
// so it runs the same in the GitHub Action, the local preview server and tests.
import { RESORTS, PLANNED } from './resorts.js';

export const CSC_FEED = 'https://snow.coloradoski.com/view/publicreport-feed';
const NWS = 'https://api.weather.gov/gridpoints';
const USER_AGENT = 'colorado-snow (github.com/JMiltier/colorado-snow)';
const TZ = 'America/Denver';
const FORECAST_DAYS = 7;
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

export function parseForecast(props, now) {
  const today = localDate(now);
  const days = Array.from({ length: FORECAST_DAYS }, (_, i) => ({ date: addDays(today, i), snow: 0, hi: null, lo: null }));
  const byDate = new Map(days.map((d) => [d.date, d]));

  const snowHours = hourly(props.snowfallAmount?.values ?? []);
  let next72 = 0;
  for (const { t, v } of snowHours) {
    const day = byDate.get(localDate(new Date(t)));
    if (day) day.snow += v;
    if (t >= now.getTime() - 3_600_000 && t < now.getTime() + 72 * 3_600_000) next72 += v;
  }
  // Highs and lows are labelled by the local date they start on (a night's low counts for that evening).
  for (const [key, field] of [['maxTemperature', 'hi'], ['minTemperature', 'lo']]) {
    for (const { validTime, value } of props[key]?.values ?? []) {
      const day = byDate.get(localDate(new Date(Date.parse(validTime.split('/')[0]))));
      if (day && value != null && day[field] == null) day[field] = cToF(value);
    }
  }
  for (const d of days) d.snow = round1(d.snow / MM_PER_INCH);
  return {
    days,
    next72: round1(next72 / MM_PER_INCH),
    next7: round1(days.reduce((s, d) => s + d.snow, 0)),
    updated: props.updateTime ?? null,
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
      },
    });
  }
  return byKey;
}

const shortDate = (ymd) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

// One status per resort, phrased for people: what's the situation and how sure are we.
export function statusFor({ live, isOpen, open, close, when, note, report }, today) {
  if (close && today > close) return { state: 'done', label: 'Closed for the season' };
  if (live && isOpen) {
    const parts = [];
    if (report?.lifts?.total) parts.push(`${report.lifts.open} of ${report.lifts.total} lifts`);
    if (report?.trails?.total) parts.push(`${report.trails.open} of ${report.trails.total} runs`);
    return { state: 'open', label: 'Open', detail: parts.join(' · ') || null };
  }
  if (open && open > today) {
    return { state: 'soon', label: `Opens ${when ?? shortDate(open)}`, date: open, detail: live ? null : 'Planned date' };
  }
  if (open && live) return { state: 'late', label: 'Not open yet', date: open, detail: `Was planned for ${shortDate(open)}` };
  if (open) return { state: 'likely', label: 'Likely open', date: open, detail: `Planned to open ${when ?? shortDate(open)} · no live status` };
  return { state: 'tba', label: 'Opening date TBA', detail: note ?? null };
}

async function getJson(fetchFn, url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
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

// Run tasks a few at a time so we're polite to api.weather.gov.
async function pool(items, limit, fn) {
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

export async function buildReport({ fetch: fetchFn = fetch, now = new Date(), log = () => {} } = {}) {
  const today = localDate(now);
  const season = seasonOf(today);
  const planned = PLANNED[season.name] ?? {};

  let csc = new Map();
  let cscOk = true;
  try {
    csc = parseCsc(await getJson(fetchFn, CSC_FEED), season);
  } catch (err) {
    cscOk = false;
    log(`Colorado Ski Country feed failed: ${err.message}`);
  }

  const forecasts = await pool(RESORTS, 4, async (r) => {
    try {
      const data = await getJson(fetchFn, `${NWS}/${r.nws[0]}/${r.nws[1]},${r.nws[2]}`);
      return parseForecast(data.properties, now);
    } catch (err) {
      log(`Forecast failed for ${r.name}: ${err.message}`);
      return null;
    }
  });

  const resorts = RESORTS.map((r, i) => {
    const c = r.csc ? csc.get(r.csc) : undefined;
    const live = Boolean(c);
    const p = planned[r.id] ?? {};
    const facts = live
      ? { live, isOpen: c.isOpen, open: c.open, close: c.close, report: c.report }
      : { live, isOpen: false, open: inSeason(p.open, season), close: inSeason(p.close, season), when: p.when, note: p.note };
    // A report from a closed resort is usually last season's leftovers.
    const report = live && c.isOpen ? c.report : null;
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
    };
  });

  return {
    generated: now.toISOString(),
    today,
    season: season.name,
    sources: { coloradoSki: cscOk, forecasts: forecasts.filter(Boolean).length, resorts: RESORTS.length },
    resorts,
  };
}
