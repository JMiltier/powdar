import test from 'node:test';
import assert from 'node:assert/strict';
import { last24, pastTotal, pastViews, reportCurrent } from '../public/views.js';

// Tuesday Nov 24, 2026, 10 AM in Denver: this morning's report time is 7 AM.
const ctx = { today: '2026-11-24', tz: 'America/Denver', now: Date.parse('2026-11-24T17:00:00Z') };
const est = (h24, h72, h168, days = []) => ({ past: [{ asOf: Date.parse('2026-11-24T14:00:00Z'), h24, h72, h168 }], pastDays: days });

test('views: an estimate covers the same hours for all three, so they nest (Echo, Nov 22)', () => {
  const r = { forecast: est(2, 2, 2) };
  const v = pastViews(r, ctx);
  assert.deepEqual([v.d1.v, v.d3.v, v.d7.v, v.d1.est], [2, 2, 2, true]);
});

test("views: a resort's 3 days stay within its own 48 hours and 7 days (Beaver Creek, Nov 23: no 21″)", () => {
  const r = {
    report: { new24: 0, new48: 2.8, new7d: 13.8, updated: '2026-11-24T05:36:00-07:00' },
    snowLog: [{ date: '2026-11-20', snow: 8.7 }, { date: '2026-11-21', snow: 11.8 }, { date: '2026-11-22', snow: 0 }],
    forecast: est(0, 3, 6),
  };
  const v = pastViews(r, ctx);
  assert.ok(v.d3.v <= 13.8 && v.d7.v === 13.8, JSON.stringify(v));
});

test("views: a 7-day total its daily reports can't account for isn't used (Northstar, Nov 26)", () => {
  const days = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'].map((date) => ({ date, snow: 0 }));
  const r = {
    report: { new24: 0, new48: 0, new7d: 39.8, updated: '2026-11-24T06:28:00-08:00' },
    snowLog: days,
    forecast: est(0, 0, 11, [{ date: '2026-11-17', snow: 11 }]),
  };
  assert.equal(pastTotal(r, 7, ctx).v, 11);
});

test("views: yesterday's report isn't the last 24 hours; the estimate is", () => {
  const r = { report: { new24: 6, updated: '2026-11-23T05:30:00-07:00' }, forecast: est(1, 3, 5) };
  assert.equal(reportCurrent(r, ctx), false);
  assert.deepEqual(last24(r, ctx), { v: 1, est: true });
});
