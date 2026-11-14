// Saves past seasons of snowpack for every SNOTEL station the app uses, one small file per station
// in public/history/. Past seasons never change, so run this once a year after the season ends
// (each fall): `npm run history`.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { RESORTS } from '../src/resorts.js';
import { despike, parseSnotel, snotelUrl, waterYear } from '../src/snotel.js';

const FIRST_SEASON = 2005; // 2005-06 onward: 20+ winters
const DAY_MS = 86_400_000;
const dayNum = (ymd) => Date.parse(`${ymd}T12:00:00Z`) / DAY_MS;

const today = new Date().toISOString().slice(0, 10);
const { startYear } = waterYear(today); // the current, unfinished season starts this year
// Every station the app uses: Colorado's hand-picked ones plus the rest of the country's.
const us = JSON.parse(await readFile(new URL('../src/us-resorts.json', import.meta.url), 'utf8'));
// Colorado only, unless US_STATES=1 (see scripts/build.mjs).
const stations = new Map([...RESORTS, ...(process.env.US_STATES === '1' ? us.resorts : [])].filter((r) => r.snotel).flatMap((r) => [r.snotel, ...(r.snotelMore ?? [])]).map(([t, n]) => [t, n]));
// ONLY=780:CO:SNTL,505:CO:SNTL limits the run to those stations (e.g. after changing a resort's station).
if (process.env.ONLY) for (const t of [...stations.keys()]) if (!process.env.ONLY.split(',').includes(t)) stations.delete(t);
const outDir = new URL('../public/history/', import.meta.url);
await mkdir(outDir, { recursive: true });

for (const [triplet, name] of stations) {
  const file = new URL(`${triplet.split(':')[0]}.json`, outDir);
  // FRESH_HOURS=12 skips stations saved within the last 12 hours (to resume an interrupted run).
  if (process.env.FRESH_HOURS) {
    const age = await stat(file).then((f) => Date.now() - f.mtimeMs).catch(() => Infinity);
    if (age < Number(process.env.FRESH_HOURS) * 3_600_000) continue;
  }
  // Five winters per request: the snow-station service sometimes hangs on a long span. Each request
  // times out and is retried.
  const raw = [];
  let failed = false;
  for (let from = FIRST_SEASON; from < startYear && !failed; from += 5) {
    const to = Math.min(from + 5, startYear);
    const url = snotelUrl([triplet], `${from}-10-01`, `${to}-07-31`);
    let res;
    for (let i = 0; i < 4 && !res?.ok; i++) {
      res = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (!res?.ok) await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
    if (!res?.ok) failed = true;
    else raw.push(...(parseSnotel(await res.json()).get(triplet)?.swe ?? []));
    if (process.env.VERBOSE) console.log(`${name} ${from}–${to}: ${raw.length} days`);
  }
  if (failed) { console.warn(`${name}: no response, skipped`); continue; }
  // Bad sensor readings (one-day spikes or dropouts) are removed before anything else.
  const values = despike(raw);

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
  await writeFile(file, JSON.stringify({ station: triplet, name, seasons: list }));
  console.log(`${name.padEnd(20)} ${list.length} seasons (${list.at(-1)?.season} – ${list[0]?.season}), ${raw.filter((r) => r.value != null).length - values.length} bad readings dropped`);
}
