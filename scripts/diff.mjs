// What a change would do to the numbers people see, before it ships: the local build (public/data)
// against the live site, every resort, every view (−7d, −3d, −1d, +3d, +7d, base), biggest changes
// first. Run after `npm run build`: `node scripts/diff.mjs` (MIN=2 to list only changes of 2″ or more).
import { readFile } from 'node:fs/promises';
import { pastViews } from '../public/views.js';

const LIVE = process.env.LIVE_URL ?? 'https://jmiltier.github.io/powdar/';
const MIN = Number(process.env.MIN ?? 1);
const now = Date.now();
const areas = ['co', 'ut', 'tahoe', 'mammoth', 'socal'];
const views = (d, r) => {
  const ctx = { today: d.today, tz: d.tz ?? 'America/Denver', now };
  const v = pastViews(r, ctx);
  return { '−7d': v.d7.v, '−3d': v.d3.v, '−1d': v.d1.v, '+3d': r.forecast?.next72 ?? null, '+7d': r.forecast?.next7 ?? null, base: r.report?.depth ?? null };
};
const rows = [];
for (const a of areas) {
  const local = JSON.parse(await readFile(new URL(`../public/data/${a}.json`, import.meta.url), 'utf8'));
  const live = await (await fetch(`${LIVE}data/${a}.json?t=${now}`)).json();
  const was = new Map(live.resorts.map((r) => [r.id, views(live, r)]));
  for (const r of local.resorts) {
    const before = was.get(r.id);
    if (!before) continue;
    const after = views(local, r);
    for (const k of Object.keys(after)) {
      const x = before[k];
      const y = after[k];
      if (x == null && y == null) continue;
      const d = (y ?? 0) - (x ?? 0);
      if (Math.abs(d) >= MIN || (x == null) !== (y == null)) rows.push({ a, id: r.id, k, x, y, d });
    }
  }
}
rows.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
console.log(rows.length ? `${rows.length} changes of ${MIN}″ or more (local build vs live):` : `No changes of ${MIN}″ or more.`);
for (const r of rows) console.log(`  ${r.a.padEnd(8)}${r.id.padEnd(20)}${r.k.padEnd(5)}${String(r.x ?? '–').padStart(6)} → ${String(r.y ?? '–').padEnd(6)}(${r.d > 0 ? '+' : ''}${Math.round(r.d * 10) / 10})`);
