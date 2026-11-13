import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStateReport } from '../src/state-report.js';

const resort = (id, extra = {}) => ({ id, name: id, short: id, state: 'UT', at: [40.6, -111.6], elev: 9000, url: null, nws: null, snotel: null, ...extra });
const NOW = new Date('2026-11-13T18:00:00Z');

test('status comes from live lifts; forecasts are reused when not due', async () => {
  const prev = { forecastAt: '2026-11-13T16:00:00Z', resorts: [{ id: 'alta', forecast: { next7: 5, sources: ['nws', 'gfs_seamless'] }, noaa: { depth: 20, water: 6 } }], snowpack: {} };
  const fetchFn = async () => ({
    ok: true,
    json: async () => [{ Name: 'Collins', StatusEnglish: 'open', Hours: {} }, { Name: 'Wildcat', StatusEnglish: 'closed', Hours: {} }],
  });
  const data = await buildStateReport({
    code: 'UT', name: 'Utah', prev, refresh: false, fetch: fetchFn, now: NOW, backoff: 0,
    resorts: [resort('alta', { lifts: { tool: 'intrawest', url: 'https://example.com/feed', page: 'https://example.com' } }), resort('beaver')],
  });
  const [alta, beaver] = data.resorts;
  assert.equal(alta.status.state, 'open');
  assert.equal(alta.status.detail, '1 of 2 lifts');
  assert.equal(alta.forecast.next7, 5, 'forecast reused from the last file');
  assert.deepEqual(alta.noaa, { depth: 20, water: 6 });
  assert.equal(beaver.status.state, 'unknown');
  assert.equal(data.forecastAt, '2026-11-13T16:00:00Z');
  assert.equal(data.stateName, 'Utah');
});
