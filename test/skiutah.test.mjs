import test from 'node:test';
import assert from 'node:assert/strict';

test("Ski Utah resort page: the snow report's own time (not the roads'), 24/48 hours, 7 days, base, season", async () => {
  const { parseSkiUtahResort } = await import('../src/skiutah.js');
  const html = `<span x-text="data">2026-11-23 12:13:26+00:00</span> roads
    <span>updated</span><span x-text="data">2026-11-23 12:42:40.584000+00:00</span>
    <dt>Overnight</dt><dd>0&rdquo;</dd><dt>Past 24 HR</dt><dd>1&rdquo;</dd><dt>Past 48 HR</dt><dd>1&rdquo;</dd>
    <span>last 7 days</span><span>23&rdquo; total</span><dt>base depth</dt><dd>18&rdquo;</dd><dt>year to date</dt><dd>52&rdquo;</dd>`;
  assert.deepEqual(parseSkiUtahResort(html), { new24: 1, new48: 1, new7d: 23, depth: 18, seasonTotal: 52, surface: null, updated: '2026-11-23T12:42:40.000Z', message: null });
});
