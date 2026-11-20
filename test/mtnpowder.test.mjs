import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMtnPowderSnow } from '../src/mtnpowder.js';

// Trimmed from mtnpowder.com/feed?resortId=60 (Mammoth), 2026-11-19.
const feed = {
  Name: 'Mammoth Mountain',
  SnowReport: {
    LastUpdate: '2026-11-19T15:18:25-0800', BaseConditions: 'Powder', SnowBaseRangeIn: '25 - 35', SeasonTotalIn: '49',
    TotalOpenTrails: 4, TotalTrails: 181,
    BaseArea: { BaseIn: '25', Last24HoursIn: '20', Last48HoursIn: '20', Last72HoursIn: '26', Last7DaysIn: '--' },
    MidMountainArea: { BaseIn: '30', Last24HoursIn: '26', Last48HoursIn: '26', Last72HoursIn: '33', Last7DaysIn: '--' },
    SummitArea: { BaseIn: '35', Last24HoursIn: '32', Last48HoursIn: '32', Last72HoursIn: '40', Last7DaysIn: '--' },
  },
};

test('MtnPowder: mid-mountain figures, the update time, trails', () => {
  const r = parseMtnPowderSnow(feed);
  assert.equal(r.new24, 26);
  assert.equal(r.new72, 33);
  assert.equal(r.depth, 30);
  assert.equal(r.seasonTotal, 49);
  assert.equal(r.new7d, null); // ('--' everywhere)
  assert.equal(r.updated, '2026-11-19T23:18:25.000Z');
  assert.deepEqual(r.trails, { open: 4, total: 181 });
});

test('MtnPowder: falls back to the base area, and the base range for depth', () => {
  const r = parseMtnPowderSnow({ SnowReport: { SnowBaseRangeIn: '20 - 30', MidMountainArea: { Last24HoursIn: '--', BaseIn: '--' }, BaseArea: { Last24HoursIn: '4' } } });
  assert.equal(r.new24, 4);
  assert.equal(r.depth, 25);
});

test("MtnPowder: a mountain read from another's feed (Alpine Meadows in Palisades')", () => {
  const r = parseMtnPowderSnow({ SnowReport: { SeasonTotalIn: '69', SnowBaseRangeIn: '20 - 30', TotalTrails: 296, TotalOpenTrails: 0,
    MidMountainArea: { Last7DaysIn: '63' }, Station5: { Last24HoursIn: '18', Last7DaysIn: '63' }, Station4: { Last24HoursIn: '14', Last7DaysIn: '52' } } }, ['Station5', 'Station4']);
  assert.equal(r.new24, 18);
  assert.equal(r.new7d, 63);
  assert.equal(r.seasonTotal, null);
  assert.equal(r.depth, null);
  assert.equal(r.trails, undefined);
});
