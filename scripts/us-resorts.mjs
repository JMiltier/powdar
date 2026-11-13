// Builds src/us-resorts.json: every real US ski resort outside Colorado (Colorado is hand-curated in
// src/resorts.js), with what the update needs looked up once:
//   - from OpenSkiMap (openskimap.org, ODbL): name, state, location, elevation, website
//   - NWS forecast grid (api.weather.gov/points)
//   - nearest NRCS SNOTEL station with a 30-year record (Western states)
//   - live lift feed, where Liftie (github.com/pirxpilot/liftie, BSD-3) knows a JSON one
// Usage: node scripts/us-resorts.mjs <ski_areas.geojson> <liftie-feeds.json>
// Re-run once a year (resorts open and close) or when adding a resort.
import { readFile, writeFile } from 'node:fs/promises';

const [geojsonPath, liftiePath] = process.argv.slice(2);
const UA = { 'User-Agent': 'Powdar (github.com/JMiltier/powdar)' };
const M_TO_FT = 3.28084;

const STATES = {
  AK: 'Alaska', AL: 'Alabama', AZ: 'Arizona', CA: 'California', CO: 'Colorado', CT: 'Connecticut', IA: 'Iowa', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', MA: 'Massachusetts', MD: 'Maryland', ME: 'Maine', MI: 'Michigan', MN: 'Minnesota',
  MO: 'Missouri', MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NV: 'Nevada', NY: 'New York', OH: 'Ohio', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SD: 'South Dakota', TN: 'Tennessee', UT: 'Utah', VA: 'Virginia', VT: 'Vermont', WA: 'Washington', WI: 'Wisconsin',
  WV: 'West Virginia', WY: 'Wyoming',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch { /* retry */ }
    await sleep(1500 * (i + 1));
  }
  return null;
}
const km = (a, b, c, d) => {
  const p = Math.PI / 180;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.sin(((c - a) * p) / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(((d - b) * p) / 2) ** 2));
};
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// "Mt. Rose - Ski Tahoe" → "Mt. Rose"; "Big Sky Resort" → "Big Sky"; capped for map labels.
function cleanName(name) {
  return name.split(/\s*;\s*/)[0].replace(/,\s*Q\d+$/, '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+[-–]\s+.*$/, '').replace(/\s+/g, ' ').trim();
}
// Drop generic tails ("Ski Area", "Recreation Area", "Ski & Ride"…) but keep "Mountain": "Blue Mountain"
// must not become "Blue".
function shortName(name) {
  const s = name
    .replace(/\s+(Ski (and|&) (Snowboard|Summer|Ride)( Area| Resort)?|Ski (Area|Resort|Hill|Center|Centre|Valley Resort)|(Mountain )?Recreation Area|Winter Sports (Area|Complex)|Ski Club|Resort)$/i, '')
    .replace(/\s+/g, ' ').trim();
  let out = (s.length >= 3 ? s : name).replace(/^Mount\b/, 'Mt.');
  out = out
    .replace(/^Palisades Tahoe (Olympic Valley)$/, 'Palisades')
    .replace(/^Palisades Tahoe /, '')
    .replace(/\s+(at|@)\s+(Tahoe|Lake Tahoe)$/i, '')
    .replace(/\bCollege Snow Bowl\b/, 'Snow Bowl')
    .replace(/\s+Ski Tahoe$/, '')
    .replace(/\s+(Resort )?Ski Slopes$/, '')
    .replace(/\s+Family$/, '');
  // "Whiteface Mountain" → "Whiteface" for long, distinctive names (7+ letters) and a few names skiers
  // already shorten; otherwise keep it ("Blue Mountain", "Powder Mountain", "Beaver Mountain" stay).
  const KNOWN = ['Stowe', 'Okemo', 'Burke', 'Pico', 'Gore', 'Hunter', 'Bromley', 'Stratton'];
  const m = out.match(/^(.*\S)\s+(Mountain|Mtn)$/);
  if (m && (m[1].length >= 7 || KNOWN.includes(m[1])) && !/\b(Mt|The|Big|Little)\.?$/.test(m[1])) out = m[1];
  return out;
}
// Centre of a point or polygon (average of the outer ring is plenty at this scale).
function centre(geom) {
  if (geom.type === 'Point') return geom.coordinates;
  const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
  const n = ring.length;
  return [ring.reduce((a, c) => a + c[0], 0) / n, ring.reduce((a, c) => a + c[1], 0) / n];
}

const areas = JSON.parse(await readFile(geojsonPath, 'utf8')).features;
const liftie = JSON.parse(await readFile(liftiePath, 'utf8'));

// 1) Real, operating US downhill resorts outside Colorado.
const picked = [];
for (const f of areas) {
  const p = f.properties;
  if (p.status !== 'operating' || !p.name || !(p.activities ?? []).includes('downhill')) continue;
  if (/closed|private|snowcat|heli|club\b|tubing|test|summer|bike|ranch|olympic park|Q\d{3,}/i.test(p.name)) continue;
  const place = (p.places ?? []).find((x) => x.iso3166_1Alpha2 === 'US');
  const state = place?.iso3166_2?.slice(3);
  if (!state || state === 'CO' || !STATES[state]) continue;
  const lifts = Object.values(p.statistics?.lifts?.byType ?? {}).reduce((a, x) => a + (x.count ?? 0), 0);
  const vert = (p.statistics?.maxElevation ?? 0) - (p.statistics?.minElevation ?? 0);
  // Real resorts: 2+ lifts and 150 m (500 ft) of vertical, or 1 lift and 300 m, or (Midwest-style
  // hills) 3+ lifts and 60 m (200 ft).
  if (!((lifts >= 2 && vert >= 150) || (lifts >= 1 && vert >= 300) || (lifts >= 3 && vert >= 60))) continue;
  const [lon, lat] = centre(f.geometry);
  const name = cleanName(p.name);
  // Same resort mapped twice (or two areas of one resort with the same name): keep the bigger one.
  const twin = picked.find((o) => o.state === state && (o.name === name || (km(o.at[0], o.at[1], lat, lon) < 2.5 && (o.name.includes(name) || name.includes(o.name)))));
  if (twin) {
    if (vert * M_TO_FT <= twin.vert) continue;
    picked.splice(picked.indexOf(twin), 1);
  }
  picked.push({
    id: `${state.toLowerCase()}-${slug(name)}`,
    name,
    short: shortName(name),
    state,
    at: [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4],
    elev: Math.round((((p.statistics?.maxElevation ?? 0) + (p.statistics?.minElevation ?? 0)) / 2) * M_TO_FT),
    url: p.websites?.[0] ?? null,
    vert: Math.round(vert * M_TO_FT),
  });
}
console.log(`${picked.length} resorts in ${new Set(picked.map((r) => r.state)).size} states`);

// 2) NWS forecast grid for each.
let done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (done < picked.length) {
    const r = picked[done++];
    const pt = await getJson(`https://api.weather.gov/points/${r.at[0]},${r.at[1]}`);
    r.nws = pt?.properties?.gridId ? [pt.properties.gridId, pt.properties.gridX, pt.properties.gridY] : null;
  }
}));
console.log(`NWS grids: ${picked.filter((r) => r.nws).length}/${picked.length}`);

// 3) SNOTEL: nearest station with a record back to 1995 (so it has 1991–2020 normals), within 40 km,
//    preferring a similar elevation (300 ft of difference counts like 1 km of distance).
const stations = (await getJson('https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?activeOnly=true&returnStationElements=false') ?? [])
  .filter((s) => s.stationTriplet.endsWith(':SNTL') && s.beginDate <= '1995-10-01');
for (const r of picked) {
  const best = stations
    .map((s) => ({ s, d: km(r.at[0], r.at[1], s.latitude, s.longitude) }))
    .filter((x) => x.d <= 40)
    .sort((a, b) => (a.d + Math.abs(a.s.elevation - r.elev) / 300) - (b.d + Math.abs(b.s.elevation - r.elev) / 300))[0];
  r.snotel = best ? [best.s.stationTriplet, best.s.name] : null;
}
console.log(`SNOTEL stations: ${picked.filter((r) => r.snotel).length}/${picked.length}`);

// 4) Live lift feeds Liftie knows (JSON ones only), matched by location.
for (const r of picked) {
  const hit = Object.entries(liftie).find(([, f]) => f.ll && km(r.at[0], r.at[1], f.ll[1], f.ll[0]) < 5);
  if (hit) r.lifts = { tool: hit[1].tool, url: hit[1].url, page: hit[1].page };
}
console.log(`Live lift feeds: ${picked.filter((r) => r.lifts).length}`);

picked.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
await writeFile(new URL('../src/us-resorts.json', import.meta.url), `${JSON.stringify({ states: STATES, resorts: picked }, null, 0)}\n`);
console.log('Wrote src/us-resorts.json');
