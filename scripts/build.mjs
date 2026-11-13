// Fetches fresh data and writes public/data.json. Run by the GitHub Action every 30 minutes.
import { appendFile, writeFile } from 'node:fs/promises';
import { buildReport } from '../src/report.js';

const MAX_KEEP_MS = 3 * 3_600_000;

const report = await buildReport({ log: (msg) => console.warn(msg) });
const { coloradoSki, forecasts, resorts, nws, models } = report.sources;
const modelList = Object.entries(models).map(([id, ok]) => `${id} ${ok ? 'ok' : 'FAILED'}`).join(', ');
console.log(`Colorado Ski Country ${coloradoSki ? 'ok' : 'FAILED'}, NWS ${nws}/${resorts}, models: ${modelList}, forecasts ${forecasts}/${resorts}`);

// Publishing a page with no data at all is worse than keeping the last good one.
if (!coloradoSki && forecasts === 0) process.exit(1);

// GitHub's servers sometimes can't reach the weather models for a while. Rather than publish a
// thinner Weather-Service-only forecast, keep the last full one if it's recent (scheduled CI runs only).
if (!Object.values(models).some(Boolean) && process.env.KEEP_IF_MODELS_DOWN === 'true' && process.env.LIVE_URL && process.env.GITHUB_OUTPUT) {
  try {
    const live = await (await fetch(new URL('data.json', process.env.LIVE_URL))).json();
    const age = Date.now() - Date.parse(live.generated);
    if (Object.values(live.sources?.models ?? {}).some(Boolean) && age < MAX_KEEP_MS) {
      console.log(`Models unreachable; keeping the published forecast from ${Math.round(age / 60_000)} min ago.`);
      await appendFile(process.env.GITHUB_OUTPUT, 'skip=true\n');
      process.exit(0);
    }
  } catch (err) {
    console.warn(`Couldn't read the published data: ${err.message}`);
  }
}

await writeFile(new URL('../public/data.json', import.meta.url), JSON.stringify(report));
console.log('Wrote data.json');
