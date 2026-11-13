// Saves past seasons of snowpack for every SNOTEL station the app uses, one small file per station
// in public/history/. Past seasons never change, so run this once a year after the season ends
// (each fall): `npm run history`.
import { mkdir, writeFile } from 'node:fs/promises';
import { RESORTS } from '../src/resorts.js';
import { parseSnotel, snotelUrl, waterYear } from '../src/snotel.js';

const FIRST_SEASON = 2005; // 2005-06 onward: 20+ winters
const DAY_MS = 86_400_000;
const dayNum = (ymd) => Date.parse(`${ymd}T12:00:00Z`) / DAY_MS;

const today = new Date().toISOString().slice(0, 10);
const { startYear } = waterYear(today); // the current, unfinished season starts this year
const stations = new Map(RESORTS.map((r) => [r.snotel[0], r.snotel[1]]));
const outDir = new URL('../public/history/', import.meta.url);
await mkdir(outDir, { recursive: true });

for (const [triplet, name] of stations) {
  const url = snotelUrl([triplet], `${FIRST_SEASON}-10-01`, `${startYear}-07-31`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${name}`);
  const values = parseSnotel(await res.json()).get(triplet)?.swe ?? [];

  // Group by season (Oct 1 – Jul 31), as [day of season, inches of water] every 3rd day.
  const seasons = new Map();
  for (const v of values) {
    if (v.value == null) continue;
    const [y, m] = v.date.split('-').map(Number);
    if (m === 8 || m === 9) continue;
    const start = m >= 10 ? y : y - 1;
    const key = `${start}-${String(start + 1).slice(2)}`;
    if (!seasons.has(key)) seasons.set(key, { start, points: [], peak: null });
    const s = seasons.get(key);
    s.points.push([dayNum(v.date) - dayNum(`${start}-10-01`), v.value, v.date]);
    if (!s.peak || v.value > s.peak.swe) s.peak = { swe: v.value, date: v.date };
  }
  const list = [...seasons.entries()]
    .filter(([, s]) => s.points.length > 150) // skip seasons with big gaps
    .sort((a, b) => b[1].start - a[1].start)
    .map(([season, s]) => ({
      season,
      peak: s.peak,
      points: s.points.filter((_, i) => i % 3 === 0 || i === s.points.length - 1).map(([d, w]) => [d, w]),
    }));
  const file = new URL(`${triplet.split(':')[0]}.json`, outDir);
  await writeFile(file, JSON.stringify({ station: triplet, name, seasons: list }));
  console.log(`${name.padEnd(20)} ${list.length} seasons (${list.at(-1)?.season} – ${list[0]?.season})`);
}
