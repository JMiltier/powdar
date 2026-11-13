// Fetches fresh data and writes public/data.json. Run by the GitHub Action every 30 minutes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildReport } from '../src/report.js';
import { buildStateReport } from '../src/state-report.js';

const RETRY_AFTER_MS = 45_000;
const REUSE_FOR_MS = 12 * 3_600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modelsOk = (rep) => Object.values(rep.sources.models).some(Boolean);
const summary = (rep) => {
  const { coloradoSki, forecasts, resorts, nws, models, snotel, lifts, noaa } = rep.sources;
  const list = Object.entries(models).map(([id, ok]) => `${id} ${ok ? 'ok' : 'FAILED'}`).join(', ');
  return `Colorado Ski Country ${coloradoSki ? 'ok' : 'FAILED'}, NWS ${nws}/${resorts}, SNOTEL ${snotel} stations, live lifts ${lifts} resorts, NOAA snow model ${noaa}/${resorts}, models: ${list}, forecasts ${forecasts}/${resorts}`;
};

// Colorado's model forecasts refresh hourly (the models barely change faster); in between, the last
// hour's are reused. Resort reports, lifts and NWS still update every run.
const MODELS_EVERY_MS = 55 * 60_000;
let liveCo = null;
if (process.env.LIVE_URL) {
  liveCo = await fetch(new URL(`data/co.json?t=${Date.now()}`, process.env.LIVE_URL)).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ?? await fetch(new URL(`data.json?t=${Date.now()}`, process.env.LIVE_URL)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}
const skipModels = Boolean(liveCo?.sources?.modelsAt && Date.now() - Date.parse(liveCo.sources.modelsAt) < MODELS_EVERY_MS);
if (skipModels) console.log('Colorado model forecasts are under an hour old: reusing them.');

let report = await buildReport({ log: (msg) => console.warn(msg), skipModels });
console.log(summary(report));

// GitHub's servers sometimes can't connect to the weather models for a minute or two.
if (!modelsOk(report) && !skipModels) {
  console.log(`Weather models unreachable; trying again in ${RETRY_AFTER_MS / 1000}s.`);
  await sleep(RETRY_AFTER_MS);
  const again = await buildReport({ log: (msg) => console.warn(msg) });
  console.log(summary(again));
  if (modelsOk(again) || again.sources.coloradoSki) report = again;
}

// Still unreachable: keep each resort's last full forecast (up to 12 hours old) rather than
// publishing a thinner Weather-Service-only one. Status, snowpack and weather stay fresh.
if (!modelsOk(report) && process.env.LIVE_URL) {
  try {
    const live = await (await fetch(new URL(`data.json?t=${Date.now()}`, process.env.LIVE_URL))).json();
    const age = Date.now() - Date.parse(live.sources?.modelsAt ?? 0);
    if (age < REUSE_FOR_MS) {
      const old = new Map(live.resorts.map((r) => [r.id, r.forecast]));
      for (const r of report.resorts) if (old.get(r.id)?.sources?.length > 1) r.forecast = old.get(r.id);
      report.sources.modelsAt = live.sources.modelsAt;
      report.sources.modelsReused = true;
      console.log(`Reusing the published model forecast from ${Math.round(age / 60_000)} min ago.`);
    }
  } catch (err) {
    console.warn(`Couldn't read the published data: ${err.message}`);
  }
}

// Publishing a page with no data at all is worse than keeping the last good one.
if (!report.sources.coloradoSki && report.sources.forecasts === 0) process.exit(1);

await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/data.json', import.meta.url), JSON.stringify(report)); // older app versions
await writeFile(new URL('../public/data/co.json', import.meta.url), JSON.stringify(report));
console.log('Wrote Colorado');

// ---------- Every other state with ski resorts ----------
// Forecasts, snowpack and NOAA snow depth refresh about every 4 hours, a few states per update (oldest
// first), to stay inside the free forecast allowance; live lifts refresh every update.
const STALE_MS = 4 * 3_600_000;
const PER_RUN = Number(process.env.STATES_PER_RUN ?? 6);
const REGIONS = {
  West: ['AK', 'AZ', 'CA', 'CO', 'ID', 'MT', 'NM', 'NV', 'OR', 'UT', 'WA', 'WY'],
  Midwest: ['IA', 'IL', 'IN', 'MI', 'MN', 'MO', 'ND', 'OH', 'SD', 'WI'],
  Northeast: ['CT', 'MA', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'],
  South: ['AL', 'MD', 'NC', 'TN', 'VA', 'WV'],
};
const regionOf = (code) => Object.keys(REGIONS).find((k) => REGIONS[k].includes(code)) ?? 'Other';
const us = JSON.parse(await readFile(new URL('../src/us-resorts.json', import.meta.url), 'utf8'));
const byState = new Map();
for (const r of us.resorts) {
  if (!byState.has(r.state)) byState.set(r.state, []);
  byState.get(r.state).push(r);
}
// Last published files, so slow-changing parts can be reused.
async function previous(code) {
  const local = new URL(`../public/data/${code.toLowerCase()}.json`, import.meta.url);
  try {
    if (process.env.LIVE_URL) return await (await fetch(new URL(`data/${code.toLowerCase()}.json?t=${Date.now()}`, process.env.LIVE_URL))).json();
    return JSON.parse(await readFile(local, 'utf8'));
  } catch {
    return null;
  }
}
const prevs = new Map(await Promise.all([...byState.keys()].map(async (code) => [code, await previous(code)])));
const due = [...byState.keys()]
  .filter((code) => process.env.ALL_STATES || !prevs.get(code)?.forecastAt || Date.now() - Date.parse(prevs.get(code).forecastAt) > STALE_MS)
  .sort((a, b) => Date.parse(prevs.get(a)?.forecastAt ?? 0) - Date.parse(prevs.get(b)?.forecastAt ?? 0))
  .slice(0, process.env.ALL_STATES ? Infinity : PER_RUN);
console.log(`States refreshing forecasts this run: ${due.join(', ') || 'none'}`);

const index = [{ code: 'CO', name: 'Colorado', region: 'West', count: report.resorts.length, snowpack: true, open: report.resorts.filter((r) => r.status.state === 'open').length }];
for (const [code, resorts] of byState) {
  const data = await buildStateReport({
    code, name: us.states[code], resorts, prev: prevs.get(code), refresh: due.includes(code),
    log: (msg) => console.warn(msg),
  });
  await writeFile(new URL(`../public/data/${code.toLowerCase()}.json`, import.meta.url), JSON.stringify(data));
  // Spread forecast requests out: the free service also limits requests per minute.
  if (due.includes(code)) await new Promise((r) => setTimeout(r, Number(process.env.STATE_PAUSE_MS ?? 4000)));
  index.push({
    code, name: us.states[code], region: regionOf(code), count: resorts.length,
    snowpack: Object.keys(data.snowpack).length > 0, open: data.resorts.filter((r) => r.status.state === 'open').length,
  });
}
index.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(new URL('../public/states.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString(), regions: Object.keys(REGIONS), states: index }));
console.log(`Wrote ${index.length} states`);
