// Saves each SNOTEL station's normal temperatures for every day of the ski season (Oct 1 – Jun 30), in
// public/temps/<station number>.json: the 10th, 25th, 50th (median), 75th and 90th percentile of the
// daily mean ((high + low) / 2, °F) over the past winters since 2005-06, each day taken with the 3
// days either side so one odd year doesn't make a spike. The app draws this season against it.
// Past seasons never change: run once a year, each fall (`node scripts/temps.mjs`).
import { mkdir, writeFile } from 'node:fs/promises';
import { RESORTS } from '../src/resorts.js';
import { AWDB, waterYear } from '../src/snotel.js';

const FIRST_SEASON = 2005;
const DAYS = 273; // Oct 1 → Jun 30
const DAY_MS = 86_400_000;
const dayNum = (ymd) => Date.parse(`${ymd}T12:00:00Z`) / DAY_MS;
const { startYear } = waterYear(new Date().toISOString().slice(0, 10)); // the unfinished season: left out

const stations = new Map(RESORTS.filter((r) => r.snotel).map((r) => [r.snotel[0], r.snotel[1]]));
if (process.env.ONLY) for (const t of [...stations.keys()]) if (!process.env.ONLY.split(',').includes(t)) stations.delete(t);
const outDir = new URL('../public/temps/', import.meta.url);
await mkdir(outDir, { recursive: true });

const pct = (sorted, p) => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};

for (const [triplet, name] of stations) {
  const q = new URLSearchParams({
    stationTriplets: triplet, elements: 'TMAX,TMIN', duration: 'DAILY',
    beginDate: `${FIRST_SEASON}-10-01`, endDate: `${startYear}-07-31`,
  });
  let res;
  for (let i = 0; i < 4 && !res?.ok; i++) {
    res = await fetch(`${AWDB}?${q}`, { signal: AbortSignal.timeout(90_000) }).catch(() => null);
    if (!res?.ok) await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  if (!res?.ok) { console.warn(`${name}: no response, skipped`); continue; }
  const data = (await res.json())[0]?.data ?? [];
  const series = (code) => new Map((data.find((s) => s.stationElement?.elementCode === code)?.values ?? []).filter((v) => v.value != null).map((v) => [v.date, v.value]));
  const hi = series('TMAX');
  const lo = series('TMIN');

  // Daily means by season day: byDay[d] = [mean, …] across seasons.
  const byDay = Array.from({ length: DAYS }, () => []);
  const seasons = new Set();
  for (const [date, h] of hi) {
    const l = lo.get(date);
    // Sensor faults: impossible values, or a low above the high.
    if (l == null || h < -50 || h > 95 || l < -60 || l > 75 || l > h) continue;
    const [y, m] = date.split('-').map(Number);
    const start = m >= 10 ? y : y - 1;
    const d = dayNum(date) - dayNum(`${start}-10-01`);
    if (d < 0 || d >= DAYS) continue;
    byDay[d].push((h + l) / 2);
    seasons.add(start);
  }
  const days = byDay.map((_, d) => {
    const pool = [];
    for (let k = Math.max(0, d - 3); k <= Math.min(DAYS - 1, d + 3); k++) pool.push(...byDay[k]);
    if (pool.length < 20) return null;
    pool.sort((a, b) => a - b);
    return [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => Math.round(pct(pool, p) * 10) / 10);
  });
  const years = [...seasons].sort();
  const out = { station: triplet, name, seasons: years.length, first: `${years[0]}-${String(years[0] + 1).slice(2)}`, last: `${years.at(-1)}-${String(years.at(-1) + 1).slice(2)}`, days };
  await writeFile(new URL(`${triplet.split(':')[0]}.json`, outDir), `${JSON.stringify(out)}\n`);
  console.log(`${name.padEnd(20)} ${years.length} seasons (${out.first} – ${out.last}), ${days.filter(Boolean).length}/${DAYS} days`);
}
