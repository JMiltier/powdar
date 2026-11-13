// Fetches fresh data and writes public/data.json. Run by the GitHub Action every 30 minutes.
import { writeFile } from 'node:fs/promises';
import { buildReport } from '../src/report.js';

const RETRY_AFTER_MS = 45_000;
const REUSE_FOR_MS = 12 * 3_600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modelsOk = (rep) => Object.values(rep.sources.models).some(Boolean);
const summary = (rep) => {
  const { coloradoSki, forecasts, resorts, nws, models, snotel, lifts, noaa } = rep.sources;
  const list = Object.entries(models).map(([id, ok]) => `${id} ${ok ? 'ok' : 'FAILED'}`).join(', ');
  return `Colorado Ski Country ${coloradoSki ? 'ok' : 'FAILED'}, NWS ${nws}/${resorts}, SNOTEL ${snotel} stations, live lifts ${lifts} resorts, NOAA snow model ${noaa}/${resorts}, models: ${list}, forecasts ${forecasts}/${resorts}`;
};

let report = await buildReport({ log: (msg) => console.warn(msg) });
console.log(summary(report));

// GitHub's servers sometimes can't connect to the weather models for a minute or two.
if (!modelsOk(report)) {
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

await writeFile(new URL('../public/data.json', import.meta.url), JSON.stringify(report));
console.log('Wrote data.json');
