// Fetches fresh data and writes public/data.json. Run by the GitHub Action every 30 minutes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fetchSnowcast } from '../src/snowcast.js';
import { buildReport, calibrateNearby, REGIONS as STATE_REGIONS } from '../src/report.js';
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
// Previously built data can come from two places: the published site, and the `data` branch that the
// maintainer's Mac mini pushes to (it fetches the weather models when GitHub's servers can't reach
// them). Whichever has the newer forecast wins.
const DATA_BRANCH = process.env.DATA_BRANCH_URL; // e.g. https://raw.githubusercontent.com/JMiltier/powdar/data/
const getJsonOrNull = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const newer = (a, b, at) => (!a ? b : !b ? a : Date.parse(at(b) ?? 0) > Date.parse(at(a) ?? 0) ? b : a);
async function published(file) {
  const [live, mac] = await Promise.all([
    process.env.LIVE_URL ? getJsonOrNull(new URL(`${file}?t=${Date.now()}`, process.env.LIVE_URL)) : null,
    DATA_BRANCH ? getJsonOrNull(new URL(`${file}?t=${Date.now()}`, DATA_BRANCH)) : null,
  ]);
  return newer(live, mac, (d) => d.sources?.modelsAt ?? d.forecastAt);
}
const liveCo = (process.env.LIVE_URL || DATA_BRANCH) ? await published('data/co.json') : null;
// (Not when the saved forecast predates a field the app now reads: then it's fetched fresh.)
const currentShape = (d) => d?.resorts?.every((r) => !r.forecast || (r.forecast.pastDays && 'hourly' in r.forecast && 'past' in r.forecast))
  && d.resorts.some((r) => r.forecast?.days?.some((x) => x.detail || x.nightDetail))
  // Ensembles there, or tried within the hour (so a failing ensemble service doesn't mean refetching
  // every model on every run).
  && (d.ensemble?.byId || Date.now() - Date.parse(d.sources?.ensembleTriedAt ?? 0) < 3_600_000);
const skipModels = Boolean(liveCo?.sources?.modelsAt && Date.now() - Date.parse(liveCo.sources.modelsAt) < MODELS_EVERY_MS && currentShape(liveCo));
if (skipModels) console.log('Colorado model forecasts are under an hour old: reusing them.');

// Last published lift checks, reused outside the ski day.
const prevLifts = Object.fromEntries((liveCo?.resorts ?? []).filter((r) => r.lifts).map((r) => [r.id, r.lifts]));
let report = await buildReport({ log: (msg) => console.warn(msg), skipModels, prevLifts, prevEnsemble: liveCo?.ensemble ?? null, prevResorts: Object.fromEntries((liveCo?.resorts ?? []).map((r) => [r.id, r])) });
console.log(summary(report));

// GitHub's servers sometimes can't connect to the weather models for a minute or two.
if (!modelsOk(report) && !skipModels) {
  console.log(`Weather models unreachable; trying again in ${RETRY_AFTER_MS / 1000}s.`);
  await sleep(RETRY_AFTER_MS);
  const again = await buildReport({ log: (msg) => console.warn(msg), prevLifts, prevEnsemble: liveCo?.ensemble ?? null, prevResorts: Object.fromEntries((liveCo?.resorts ?? []).map((r) => [r.id, r])) });
  console.log(summary(again));
  if (modelsOk(again) || again.sources.coloradoSki) report = again;
}

// Still unreachable: keep each resort's last full forecast (up to 12 hours old) rather than
// publishing a thinner Weather-Service-only one. Status, snowpack and weather stay fresh.
if (!modelsOk(report) && liveCo) {
  try {
    const live = liveCo;
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

// NOAA's per-resort snow depth sometimes fails for a few resorts: keep the last reading (NOAA only
// updates daily) rather than leave those resorts without a base.
if (liveCo) {
  const old = new Map(liveCo.resorts.map((r) => [r.id, r.noaa]));
  for (const r of report.resorts) if (!r.noaa && old.get(r.id)) r.noaa = old.get(r.id);
  report.sources.noaa = report.resorts.filter((r) => r.noaa).length;
}

// Vail Resorts' own pages occasionally don't answer (or turn GitHub's servers away): keep the last
// report from the past day for those mountains rather than drop back to announced dates.
if (liveCo) {
  const old = new Map(liveCo.resorts.map((r) => [r.id, r]));
  for (const r of report.resorts) {
    const o = old.get(r.id);
    const fresh = o?.report?.source && Date.now() - Date.parse(liveCo.generated) < 24 * 3_600_000;
    if (!r.report?.source && fresh) Object.assign(r, { report: o.report, status: o.status, lifts: r.lifts ?? o.lifts, live: o.live });
  }
}

// The forecasters' messages or alerts didn't come through: keep the last ones (up to a day old).
if (liveCo?.insights && Date.now() - Date.parse(liveCo.generated) < 24 * 3_600_000) {
  if (!report.insights?.discussions?.length) report.insights = { ...report.insights, discussions: liveCo.insights.discussions };
  if (report.insights && report.insights.alerts == null) report.insights.alerts = liveCo.insights.alerts;
}

// Publishing a page with no data at all is worse than keeping the last good one.
if (!report.sources.coloradoSki && report.sources.forecasts === 0) process.exit(1);

await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
calibrateNearby(report.resorts); // (after any reused forecast is back: from this update's reports)
await writeFile(new URL('../public/data.json', import.meta.url), JSON.stringify(report)); // older app versions
await writeFile(new URL('../public/data/co.json', import.meta.url), JSON.stringify(report));
console.log('Wrote Colorado');

// ---------- The other areas: the same pipeline as Colorado (src/report.js REGIONS) ----------
// (See AREAS in public/app.js.) Their weather models every 2 hours (Colorado's hourly), to stay inside
// the free forecast allowance; everything else (status, reports, lifts, NWS) every update. Without
// models this time, the last published forecasts carry over (up to 12 hours old).
async function buildArea(code) {
  const R = STATE_REGIONS[code];
  const file = `data/${code.toLowerCase()}.json`;
  try {
    const prev = await published(file);
    const age = Date.now() - Date.parse(prev?.sources?.modelsAt ?? 0);
    // (Forecasts from before the hour-by-hour estimate and report-time past totals were added are refetched.)
    const skip = Boolean(prev && age < 2 * 3_600_000 && prev.resorts?.every((r) => !r.forecast || ('hourly' in r.forecast && 'past' in r.forecast)));
    const rep = await buildReport({
      region: R, log: (msg) => console.warn(`${R.name}: ${msg}`), skipModels: skip,
      prevLifts: Object.fromEntries((prev?.resorts ?? []).filter((r) => r.lifts).map((r) => [r.id, r.lifts])),
      prevEnsemble: prev?.ensemble ?? null,
      prevResorts: Object.fromEntries((prev?.resorts ?? []).map((r) => [r.id, r])),
    });
    if ((skip || !Object.values(rep.sources.models ?? {}).some(Boolean)) && prev && age < 12 * 3_600_000) {
      const old = new Map(prev.resorts.map((r) => [r.id, r.forecast]));
      for (const r of rep.resorts) if (old.get(r.id)?.sources?.length > 1) r.forecast = old.get(r.id);
      rep.sources.modelsAt = prev.sources.modelsAt;
      rep.sources.modelsReused = true;
    }
    calibrateNearby(rep.resorts); // (after any reused forecast is back: from this update's reports)
    await writeFile(new URL(`../public/${file}`, import.meta.url), JSON.stringify(rep));
    console.log(`Wrote ${R.name}`);
  } catch (err) {
    console.warn(`${R.name} failed (${err.message}); keeping the last one.`);
    const last = await published(file);
    if (last) await writeFile(new URL(`../public/${file}`, import.meta.url), JSON.stringify(last));
  }
}
for (const code of Object.keys(STATE_REGIONS).filter((c) => c !== 'CO')) await buildArea(code);

// The snow forecast's chance areas (src/snowcast.js); the last published copy if WPC is unreachable.
try {
  await writeFile(new URL('../public/data/snowcast.json', import.meta.url), JSON.stringify(await fetchSnowcast()));
  console.log('Wrote the snow forecast');
} catch (err) {
  console.warn(`Snow forecast failed (${err.message}); keeping the last one.`);
  const last = await published('data/snowcast.json');
  if (last) await writeFile(new URL('../public/data/snowcast.json', import.meta.url), JSON.stringify(last));
}

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
// Powdar is Colorado-only for now. US_STATES=1 builds every other state too (the code and resort
// list are kept ready); without it, states.json lists just Colorado.
const US_STATES = process.env.US_STATES === '1';
const byState = new Map();
for (const r of US_STATES ? us.resorts.filter((x) => x.state !== 'UT') : []) { // (Utah: built above, like Colorado)
  if (!byState.has(r.state)) byState.set(r.state, []);
  byState.get(r.state).push(r);
}
// Last published files, so slow-changing parts can be reused.
async function previous(code) {
  const file = `data/${code.toLowerCase()}.json`;
  if (process.env.LIVE_URL || DATA_BRANCH) return published(file);
  return readFile(new URL(`../public/${file}`, import.meta.url), 'utf8').then(JSON.parse).catch(() => null);
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
