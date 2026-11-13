// Builds the single data.json the app reads. Pure apart from the fetch you pass in,
// so it runs the same in the GitHub Action, the local preview server and tests.
import { RESORTS, PLANNED } from './resorts.js';
import { MODELS, modelUrl, snowHours } from './models.js';

export const CSC_FEED = 'https://snow.coloradoski.com/view/publicreport-feed';
const NWS = 'https://api.weather.gov/gridpoints';
const USER_AGENT = 'PowScout (github.com/JMiltier/powscout)';
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

// sources: [{ id, hours: [{ t, v (inches) }] | null }]; nws: raw NWS properties for temperatures.
export function blendForecast({ sources, nws }, now) {
  const today = localDate(now);
  const dates = Array.from({ length: FORECAST_DAYS }, (_, i) => addDays(today, i));
  const usable = sources.filter((s) => s.hours);
  if (!usable.length) return null;
  const nowMs = now.getTime();

  const totals = usable.map(({ hours }) => {
    const daily = new Map(dates.map((d) => [d, 0]));
    let next72 = 0;
    for (const { t, v } of hours) {
      const d = localDate(new Date(t));
      if (daily.has(d)) daily.set(d, daily.get(d) + v);
      if (t >= nowMs - 3_600_000 && t < nowMs + 72 * 3_600_000) next72 += v;
    }
    return { daily, next72, next7: [...daily.values()].reduce((a, b) => a + b, 0) };
  });

  const temps = nwsTemps(nws, dates);
  const days = dates.map((date) => {
    const s = spread(totals.map((x) => x.daily.get(date)));
    return { date, snow: s.mid, snowLo: s.lo, snowHi: s.hi, ...temps.get(date) };
  });
  const n72 = spread(totals.map((x) => x.next72));
  const n7 = spread(totals.map((x) => x.next7));
  return {
    days,
    next72: n72.mid,
    next72Range: [n72.lo, n72.hi],
    next7: n7.mid,
    next7Range: [n7.lo, n7.hi],
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
export function statusFor({ live, isOpen, open, close, when, opened, note, report }, today) {
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
  if (open && opened) return { state: 'open', label: 'Open', date: open, detail: `Opened ${shortDate(open)} · no live lift count` };
  if (open && live) return { state: 'late', label: 'Not open yet', date: open, detail: `Was planned for ${shortDate(open)}` };
  // Planned date has passed but we can't read this resort's site to confirm it.
  if (open) return { state: 'likely', label: 'Probably open', date: open, detail: `Set to open ${when ?? shortDate(open)} · can't confirm live` };
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

  // Each model is one request covering every resort; NWS is one request per resort.
  const [modelData, nwsData] = await Promise.all([
    Promise.all(MODELS.map(async (m) => {
      try {
        const data = await getJson(fetchFn, modelUrl(m.id, RESORTS, FORECAST_DAYS + 1));
        return Array.isArray(data) ? data : [data];
      } catch (err) {
        log(`Model ${m.label} failed: ${err.message}`);
        return null;
      }
    })),
    pool(RESORTS, 4, async (r) => {
      try {
        return (await getJson(fetchFn, `${NWS}/${r.nws[0]}/${r.nws[1]},${r.nws[2]}`)).properties;
      } catch (err) {
        log(`NWS forecast failed for ${r.name}: ${err.message}`);
        return null;
      }
    }),
  ]);
  const forecasts = RESORTS.map((r, i) => blendForecast({
    nws: nwsData[i],
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
      ? { live, isOpen: c.isOpen, open: c.open, close: c.close, report: c.report }
      : { live, isOpen: false, open: inSeason(p.open, season), close: inSeason(p.close, season), when: p.when, opened: p.opened, note: p.note };
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
    sources: {
      coloradoSki: cscOk,
      forecasts: forecasts.filter(Boolean).length,
      resorts: RESORTS.length,
      nws: nwsData.filter(Boolean).length,
      models: Object.fromEntries(MODELS.map((m, k) => [m.id, Boolean(modelData[k])])),
    },
    resorts,
  };
}
