// Statewide normals for the Colorado overview, from the per-station files already saved by
// `npm run history` (public/history/) and `node scripts/temps.mjs` (public/temps/). No network.
//   public/history/colorado.json: for each day of the season, the 10th/25th/50th/75th/90th percentile
//     and the snowiest value of the statewide average snowpack (inches of water, mean over stations)
//     across past winters.
//   public/temps/colorado.json: each day's statewide normal temperatures (the stations' percentiles,
//     averaged).
// Run after those two each fall.
import { readFile, writeFile } from 'node:fs/promises';
import { RESORTS } from '../src/resorts.js';

const DAYS = 273;
const stations = [...new Set(RESORTS.filter((r) => r.snotel).map((r) => r.snotel[0].split(':')[0]))];
const load = (dir, n) => readFile(new URL(`../public/${dir}/${n}.json`, import.meta.url), 'utf8').then(JSON.parse).catch(() => null);
const pct = (sorted, p) => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};
const r1 = (v) => Math.round(v * 10) / 10;

// Snowpack: each past season's statewide average, day by day (stations' every-3rd-day points filled in).
const hist = (await Promise.all(stations.map((n) => load('history', n)))).filter(Boolean);
const bySeason = new Map(); // season → day → [values]
for (const h of hist) {
  for (const { season, points } of h.seasons) {
    if (!bySeason.has(season)) bySeason.set(season, Array.from({ length: DAYS }, () => []));
    const days = bySeason.get(season);
    for (let i = 0; i + 1 < points.length; i++) {
      const [d0, v0] = points[i];
      const [d1, v1] = points[i + 1];
      for (let d = d0; d < d1 && d < DAYS; d++) days[d].push(v0 + ((v1 - v0) * (d - d0)) / (d1 - d0 || 1));
    }
  }
}
// Only seasons with most stations reporting count (an average over a few stations would skew).
const seasonMeans = [...bySeason.entries()].map(([season, days]) => ({
  season, mean: days.map((v) => (v.length >= stations.length * 0.7 ? v.reduce((a, b) => a + b, 0) / v.length : null)),
})).filter((s) => s.mean.filter((v) => v != null).length > 200);
const snow = Array.from({ length: DAYS }, (_, d) => {
  const vals = seasonMeans.map((s) => s.mean[d]).filter((v) => v != null).sort((a, b) => a - b);
  return vals.length >= 10 ? [...[0.1, 0.25, 0.5, 0.75, 0.9].map((p) => r1(pct(vals, p))), r1(vals.at(-1))] : null;
});
const seasons = seasonMeans.map((s) => s.season).sort();
await writeFile(new URL('../public/history/colorado.json', import.meta.url), `${JSON.stringify({
  stations: hist.length, seasons: seasons.length, first: seasons[0], last: seasons.at(-1), days: snow,
})}\n`);
console.log(`Snowpack: ${hist.length} stations, ${seasons.length} seasons (${seasons[0]} – ${seasons.at(-1)})`);

// Temperature: the stations' daily percentiles, averaged.
const temps = (await Promise.all(stations.map((n) => load('temps', n)))).filter(Boolean);
const tdays = Array.from({ length: DAYS }, (_, d) => {
  const rows = temps.map((t) => t.days[d]).filter(Boolean);
  return rows.length ? [0, 1, 2, 3, 4].map((k) => r1(rows.reduce((a, r) => a + r[k], 0) / rows.length)) : null;
});
await writeFile(new URL('../public/temps/colorado.json', import.meta.url), `${JSON.stringify({
  name: 'Colorado', stations: temps.length, seasons: temps[0]?.seasons, first: temps[0]?.first, last: temps[0]?.last, days: tdays,
})}\n`);
console.log(`Temperature: ${temps.length} stations`);
