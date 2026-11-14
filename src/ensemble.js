// Ensemble forecasts from Open-Meteo (free, no key): each global model run many times with slightly
// different starting points (ECMWF 51 runs, the American GEFS 31, the Canadian GEM 21). Where single
// runs disagree wildly (days 4–14 especially), the middle of all those runs is a far steadier estimate,
// and how far they spread is an honest range.
// Each model counts equally: for every quantile, the three models' values are averaged
// ("Vincentized"), so the 51-run European doesn't outvote the others just by running more often.
import { snowRatio } from './models.js';

export const ENSEMBLE_API = 'https://ensemble-api.open-meteo.com/v1/ensemble';
export const ENSEMBLE_MODELS = ['ecmwf_ifs025', 'gfs025', 'gem_global'];
export const ENSEMBLE_DAYS = 15;
const FT_TO_M = 0.3048;
const MM_PER_INCH = 25.4;

export function ensembleUrl(resorts) {
  const q = new URLSearchParams({
    latitude: resorts.map((r) => r.at[0]).join(','),
    longitude: resorts.map((r) => r.at[1]).join(','),
    elevation: resorts.map((r) => Math.round(r.elev * FT_TO_M)).join(','),
    hourly: 'precipitation,temperature_2m',
    models: ENSEMBLE_MODELS.join(','),
    forecast_days: String(ENSEMBLE_DAYS),
    timeformat: 'unixtime',
    timezone: 'America/Denver',
  });
  return `${ENSEMBLE_API}?${q}`;
}

const q = (sorted, p) => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};
const round1 = (v) => Math.round(v * 10) / 10;

// One location's response → { dates, days: [{ date, mid, lo, hi }], sum(from, to) → { mid, lo, hi } }:
// snow per local day for each run (precipitation × the temperature's snow ratio, as for the single
// runs), then the 25th / 50th / 75th percentile across runs, averaged over the models.
// `localDate(ms)` turns a timestamp into the resort's YYYY-MM-DD.
export function summarizeEnsemble(loc, localDate) {
  const h = loc?.hourly;
  if (!h?.time?.length) return null;
  // Series keys look like precipitation_member07_ecmwf_ifs025_ensemble (the control run has no member).
  const runs = new Map(); // "model|member" → { precipitation, temperature_2m }
  for (const [key, values] of Object.entries(h)) {
    const m = /^(precipitation|temperature_2m)_(?:(member\d+)_)?(.+)$/.exec(key);
    if (!m) continue;
    const id = `${m[3]}|${m[2] ?? 'control'}`;
    if (!runs.has(id)) runs.set(id, {});
    runs.get(id)[m[1]] = values;
  }
  const dates = [...new Set(h.time.map((t) => localDate(t * 1000 - 1_800_000)))];
  const index = new Map(dates.map((d, i) => [d, i]));
  const byModel = new Map(); // model → [run → [snow per day]]
  for (const [id, { precipitation: p, temperature_2m: c }] of runs) {
    if (!p || !c) continue;
    const model = id.split('|')[0];
    const days = new Array(dates.length).fill(0);
    let any = false;
    for (let i = 0; i < h.time.length; i++) {
      if (p[i] == null || c[i] == null) continue;
      any = true;
      days[index.get(localDate(h.time[i] * 1000 - 1_800_000))] += (p[i] * snowRatio(c[i])) / MM_PER_INCH;
    }
    if (any) {
      if (!byModel.has(model)) byModel.set(model, []);
      byModel.get(model).push(days);
    }
  }
  if (!byModel.size) return null;
  // A total over days [from, to] for every run, then the averaged quantiles.
  const sum = (from, to) => {
    const per = [...byModel.values()].map((runsOf) => runsOf.map((d) => d.slice(from, to + 1).reduce((a, b) => a + b, 0)).sort((a, b) => a - b));
    const avg = (p) => per.reduce((t, s) => t + q(s, p), 0) / per.length;
    return { mid: round1(avg(0.5)), lo: round1(avg(0.25)), hi: round1(avg(0.75)) };
  };
  return {
    dates,
    runs: [...byModel.values()].reduce((t, r) => t + r.length, 0),
    days: dates.map((date, i) => ({ date, ...sum(i, i) })),
    sum,
  };
}
