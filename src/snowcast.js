// Chances of snow, days 1–3: the Weather Prediction Center's probabilistic winter forecast (PWPF),
// the chance of at least 1″, 2″, 6″ or 12″ of snow in each 24-hour period. NOAA's map service only
// offers 4″, 8″ and 12″; the small amounts that matter most day to day come as KMZ files of
// probability contours (www.wpc.ncep.noaa.gov/pwpf/latest_kml/), which the browser can't read, so the
// build turns them into GeoJSON for the areas (public/data/snowcast.json).
import { inflateRawSync } from 'node:zlib';

export const SNOWCAST_KMZ = 'https://www.wpc.ncep.noaa.gov/pwpf/latest_kml/';
export const SNOWCAST_AMOUNTS = [1, 2, 6, 12];
const LEVELS = [10, 40, 70]; // slight / moderate / high chance contours (nested)
const BBOX = [-124.8, 32.5, -101.5, 43.0]; // California, Utah and Colorado, and a little around them

// The first file in a zip (a KMZ holds one KML).
export function unzipFirst(buf, want = /\.kml$/i) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  let at = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    if (want.test(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('no KML in the KMZ');
}

const ring = (text) => text.trim().split(/\s+/).map((p) => p.split(',').slice(0, 2).map((v) => Math.round(Number(v) * 1000) / 1000));
const near = (rings) => rings[0].some(([x, y]) => x >= BBOX[0] && x <= BBOX[2] && y >= BBOX[1] && y <= BBOX[3]);

// One KML of probability contours → { start, end, features } (GeoJSON polygons with { prob }), only
// the 10/40/70 % contours, only near the areas.
export function parseContours(kml) {
  const valid = /Valid (\d\d)Z (\d\d)\/(\d\d)\/(\d{4}) - (\d\d)Z (\d\d)\/(\d\d)\/(\d{4})/.exec(kml);
  const iso = (h, m, d, y) => `${y}-${m}-${d}T${h}:00:00Z`;
  const features = [];
  for (const pm of kml.split('<Placemark').slice(1)) {
    const prob = Number(/<name>(\d+)<\/name>/.exec(pm)?.[1]);
    if (!LEVELS.includes(prob)) continue;
    for (const poly of pm.split('<Polygon').slice(1)) {
      const outer = /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(poly);
      if (!outer) continue;
      const holes = [...poly.matchAll(/<innerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)].map((m) => ring(m[1]));
      const rings = [ring(outer[1]), ...holes];
      if (near(rings)) features.push({ type: 'Feature', properties: { prob }, geometry: { type: 'Polygon', coordinates: rings } });
    }
  }
  return {
    start: valid ? iso(valid[1], valid[2], valid[3], valid[4]) : null,
    end: valid ? iso(valid[5], valid[6], valid[7], valid[8]) : null,
    features,
  };
}

// → { checked, days: [{ day, start, end, amounts: { 1: features, 2: …, 6: …, 12: … } }] }
export async function fetchSnowcast(fetchFn = fetch) {
  const days = [];
  for (const [i, f] of ['f024', 'f048', 'f072'].entries()) {
    const amounts = {};
    let start = null;
    let end = null;
    for (const a of SNOWCAST_AMOUNTS) {
      const res = await fetchFn(`${SNOWCAST_KMZ}prb_24hsnow_ge${String(a).padStart(2, '0')}_${f}_cntr_latest.kmz`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const c = parseContours(unzipFirst(Buffer.from(await res.arrayBuffer())));
      amounts[a] = c.features;
      start ??= c.start;
      end ??= c.end;
    }
    days.push({ day: i + 1, start, end, amounts });
  }
  return { checked: new Date().toISOString(), days };
}
