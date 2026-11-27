import test from 'node:test';
import assert from 'node:assert/strict';
import { auditArea } from '../src/audit.js';

const now = Date.parse('2026-11-24T17:00:00Z');
const asOf = Date.parse('2026-11-24T14:00:00Z');
const base = { state: 'CO', today: '2026-11-24', tz: 'America/Denver', sources: { modelsAt: 'x' } };

test('audit: a forecast above every source it blends is an error; a sane one passes', () => {
  const r = (n72) => ({ id: 'vail', at: [39.6, -106.4], status: { state: 'open' }, forecast: { next72: n72, next72By: { nws: 3.9, ecmwf_ifs025: 5.6, gfs_seamless: 8.7 }, past: [{ asOf, h24: 0, h72: 0, h168: 0 }] } });
  assert.deepEqual(auditArea({ ...base, resorts: [r(13.4)] }, null, now).map((f) => [f.level, f.check]), [['error', 'forecast']]);
  assert.deepEqual(auditArea({ ...base, resorts: [r(5.6)] }, null, now), []);
});

test("audit: a resort's days not adding up to its own 7-day total is flagged (Breckenridge, Nov 26)", () => {
  const log = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'].map((date, i) => ({ date, snow: i === 3 ? 2 : 0 }));
  const resort = { id: 'breckenridge', at: [39.48, -106.07], status: { state: 'open' }, report: { new24: 0, new48: 0, new7d: 5.9, updated: '2026-11-24T05:00:00-07:00' }, snowLog: log, forecast: { past: [{ asOf, h24: 0, h72: 0, h168: 0 }] } };
  assert.ok(auditArea({ ...base, resorts: [resort] }, null, now).some((f) => f.check === 'own-totals'));
});

test('audit: a big change between updates with nothing new to explain it is flagged', () => {
  const r = (d1) => ({ id: 'keystone', at: [39.6, -105.95], status: { state: 'open' }, report: { new24: d1, updated: '2026-11-24T05:45:00-07:00' }, snowLog: [], forecast: { past: [{ asOf, h24: 0, h72: d1, h168: d1 }] } });
  const found = auditArea({ ...base, resorts: [r(0)] }, { ...base, resorts: [r(8)] }, now);
  assert.ok(found.some((f) => f.check === 'jump'), JSON.stringify(found));
});
