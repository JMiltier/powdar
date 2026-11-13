// Builds public/roads.json: Colorado's major highways for the map, simplified to about 1 km.
// Geometry © OpenStreetMap contributors (ODbL), via the Overpass API.
// Usage: node scripts/roads.mjs <overpass-output.json>
//   (query: way[highway~motorway|trunk|primary][ref~I 70|I 25|I 76|US 285|US 40|US 550|US 160|US 50|US 24]
//    in 36.95,-109.1,41.05,-102.0; out geom)
import { readFile, writeFile } from 'node:fs/promises';

const ROUTES = ['I 70', 'I 25', 'I 76', 'US 285', 'US 40', 'US 550', 'US 160', 'US 50', 'US 24'];
const TOL = 0.008; // degrees (~0.7–0.9 km)

// Douglas–Peucker on [lat, lon] points.
function simplify(pts) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ay, ax] = pts[a];
    const [by, bx] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let far = -1;
    let farD = TOL;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i][1] - ax) - dx * (pts[i][0] - ay)) / len;
      if (d > farD) { farD = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const { elements } = JSON.parse(await readFile(process.argv[2], 'utf8'));
const out = [];
for (const ref of ROUTES) {
  // One carriageway is plenty at this scale: skip the "backward" half of divided highways by keeping
  // only ways whose start is not within ~300 m of a way already kept running the other way.
  const ways = elements.filter((e) => e.type === 'way' && e.geometry && (e.tags.ref ?? '').split(';').map((s) => s.trim()).includes(ref));
  const lines = [];
  for (const w of ways) {
    const pts = w.geometry.map((g) => [g.lat, g.lon]);
    if (w.tags.oneway === 'yes' && w.tags.highway === 'motorway') {
      // Keep only the eastbound/northbound side (first point west or south of the last).
      const [s, e] = [pts[0], pts.at(-1)];
      if (Math.abs(e[1] - s[1]) > Math.abs(e[0] - s[0]) ? e[1] < s[1] : e[0] < s[0]) continue;
    }
    lines.push(pts);
  }
  // Chain pieces that share an end (either direction) into long lines, then simplify.
  const key = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const pool = lines.map((l) => [...l]);
  const joined = [];
  while (pool.length) {
    let cur = pool.pop();
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        const [cs, ce, ls, le] = [key(cur[0]), key(cur.at(-1)), key(l[0]), key(l.at(-1))];
        if (ce === ls) cur = [...cur, ...l.slice(1)];
        else if (ce === le) cur = [...cur, ...[...l].reverse().slice(1)];
        else if (cs === le) cur = [...l, ...cur.slice(1)];
        else if (cs === ls) cur = [...[...l].reverse(), ...cur.slice(1)];
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    joined.push(cur);
  }
  const simple = joined.map(simplify).filter((l) => l.length >= 2).map((l) => l.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]));
  const [kind, num] = ref.split(' ');
  out.push({ ref: num, kind, lines: simple });
  console.log(ref, ways.length, 'ways →', simple.length, 'lines,', simple.reduce((a, l) => a + l.length, 0), 'points');
}
await writeFile(new URL('../public/roads.json', import.meta.url), `${JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', routes: out })}\n`);
