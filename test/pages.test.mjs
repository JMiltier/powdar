import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAltaSnow, parseMtRoseSnow, zonedIso } from '../src/pages.js';

test("own-page reports: Alta's data object and Mt. Rose's report block, times in their zones", () => {
  assert.equal(zonedIso('2026-11-23 12:00:00', 'America/Denver'), '2026-11-23T19:00:00.000Z');
  const alta = `<script>window.Alta = {"conditions":{"dated_at":"2026-11-23 06:00:00","last12":"1.0","last24":"3.0","base_depth":"41.0","storm_total":"9.0","year_to_date":"71.0"}};</script>`;
  assert.deepEqual(parseAltaSnow(alta), { depth: 41, new24: 3, new48: null, seasonTotal: 71, stormTotal: 9, surface: null, updated: '2026-11-23T13:00:00.000Z', message: null });
  const rose = `<h2 class="stat">-</h2><p class="subtitle">New Snow</p><h2 class="stat">28&quot;-40&quot;</h2><p class="subtitle">Base Depth</p>
    <h2 class="stat">68-82&quot;</h2><p class="subtitle">Season Total</p><div class="weather-updated"> Updated: November 23, 2026 9:07 am </div>`;
  const r = parseMtRoseSnow(rose);
  assert.deepEqual([r.new24, r.depth, r.seasonTotal, r.updated], [null, 34, 75, '2026-11-23T17:07:00.000Z']); // ("-": nothing reported, not 0″)
});
