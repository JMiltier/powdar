// Builds src/cams.json: each resort's webcams, as still images that update on their own (shown as
// thumbnails, credited and linked to the resort's cam page), plus a live view where there is one.
//  - Vail Resorts' mountains: read from their mountain-cams pages (Brownrice players + snow stake
//    stills; see vail.js).
//  - The rest: curated by hand (scripts/cams-manual.json: { "<resort id>": { page, cams: [{ name, image,
//    live? }] } }), each image URL checked to load.
// Re-run each fall, or when a resort's cams change: node scripts/cams.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { VAIL_SITES, camsPage, parseVailCams } from '../src/vail.js';

const UA = { 'User-Agent': 'Powdar/1.0 (github.com/JMiltier/powdar)' };
// Names for cameras whose ids don't read well.
const NAMES = {
  vailch11: 'Chair 11', vailch21: 'Chair 21', vailch2: 'Chair 2', breckenridge7: 'Peak 7', breckenridge9: 'Peak 9',
  breckenridge10: 'Peak 10', bcsnowstake2: 'Snow Stake', bcspruce: 'Spruce Saddle', bcredbuffalo: 'Red Buffalo', bcmccoy: 'McCoy Park',
  bctalons: 'Talons', bcahoutsidebar: 'Outside Bar',
};
const PREFIXES = { vail: ['vail'], 'beaver-creek': ['beavercreek', 'bc'], breckenridge: ['breckenridge', 'breck'], keystone: ['keystone'], 'crested-butte': ['crestedbutte', 'cb'] };

const out = {};
for (const [id, site] of Object.entries(VAIL_SITES)) {
  try {
    const res = await fetch(camsPage(site), { headers: UA });
    const cams = res.ok ? parseVailCams(await res.text(), PREFIXES[id]) : [];
    for (const c of cams) {
      const key = c.live?.split('/').pop();
      if (key && NAMES[key]) c.name = NAMES[key];
    }
    cams.sort((a, b) => (b.name === 'Snow Stake') - (a.name === 'Snow Stake'));
    if (cams.length) out[id] = { page: camsPage(site), cams };
  } catch (err) {
    console.warn(`${id}: ${err.message}`);
  }
}
const manual = JSON.parse(await readFile(new URL('./cams-manual.json', import.meta.url), 'utf8').catch(() => '{}'));
for (const [id, entry] of Object.entries(manual)) {
  if (out[id]?.cams.length) continue; // a resort's own page beats the hand list
  out[id] = entry;
}
// Keep only images that load right now.
for (const [id, entry] of Object.entries(out)) {
  const ok = await Promise.all(entry.cams.map((c) => fetch(c.image, { headers: { ...UA, Referer: 'https://jmiltier.github.io/' }, signal: AbortSignal.timeout(20000) })
    .then((r) => r.ok && /^image\//.test(r.headers.get('content-type') ?? '')).catch(() => false)));
  entry.cams = entry.cams.filter((_, i) => ok[i]).slice(0, 6);
  console.log(`${id.padEnd(16)} ${entry.cams.length} cams  ${entry.cams.map((c) => c.name).join(' | ')}`);
}
await writeFile(new URL('../src/cams.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
