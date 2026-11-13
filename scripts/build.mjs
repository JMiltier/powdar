// Fetches fresh data and writes public/data.json. Run by the GitHub Action every 30 minutes.
import { writeFile } from 'node:fs/promises';
import { buildReport } from '../src/report.js';

const report = await buildReport({ log: (msg) => console.warn(msg) });
await writeFile(new URL('../public/data.json', import.meta.url), JSON.stringify(report));

const { coloradoSki, forecasts, resorts, nws, models } = report.sources;
const modelList = Object.entries(models).map(([id, ok]) => `${id} ${ok ? 'ok' : 'FAILED'}`).join(', ');
console.log(`Wrote data.json: Colorado Ski Country ${coloradoSki ? 'ok' : 'FAILED'}, NWS ${nws}/${resorts}, models: ${modelList}, forecasts ${forecasts}/${resorts}`);
// Publishing a page with no data at all is worse than keeping the last good one.
if (!coloradoSki && forecasts === 0) process.exit(1);
