import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePowdrSnow } from '../src/powdr.js';

test("Powdr snow report: the newest report's worked-out totals, base and time posted", () => {
  const rows = [
    { updated: 1795350000, base_depth: 16, unit_of_measurement: 'in', computed: { '24_hour': 4, '48_hour': 6, '72_hour': 6, '7_day': 7, total: 13 } },
    { updated: 1795436538, base_depth: 18, unit_of_measurement: 'in', computed: { '24_hour': 0, '48_hour': 2, '72_hour': 6, '7_day': 7, total: 13 } },
  ];
  const r = parsePowdrSnow(rows);
  assert.deepEqual([r.new24, r.new48, r.new72, r.new7d, r.seasonTotal, r.depth], [0, 2, 6, 7, 13, 18]);
  assert.equal(r.updated, new Date(1795436538 * 1000).toISOString());
  assert.equal(parsePowdrSnow([]), null);
  assert.equal(parsePowdrSnow([{ updated: 1, unit_of_measurement: 'cm', base_depth: 50.8, computed: { '24_hour': 25.4 } }]).new24, 10);
});
