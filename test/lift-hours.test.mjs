import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liftsDue } from '../src/lift-hours.js';

// 2026-12-15: Denver is UTC−7, New York UTC−5.
test('Colorado: checked through the ski day and night skiing, plus once after', () => {
  assert.equal(liftsDue('CO', new Date('2026-12-15T17:00:00Z')), true); // 10 am
  assert.equal(liftsDue('CO', new Date('2026-12-16T02:00:00Z'), '2026-12-16T01:45:00Z'), true); // 7 pm: night skiing
  assert.equal(liftsDue('CO', new Date('2026-12-16T05:00:00Z'), '2026-12-16T04:15:00Z'), true); // 10 pm, last at 9:15 pm
  assert.equal(liftsDue('CO', new Date('2026-12-16T06:00:00Z'), '2026-12-16T05:00:00Z'), false); // 11 pm, already did the late check
  assert.equal(liftsDue('CO', new Date('2026-12-16T09:00:00Z'), '2026-12-16T05:00:00Z'), false); // 2 am, last at 10 pm
  assert.equal(liftsDue('CO', new Date('2026-12-16T09:00:00Z')), true); // never checked: check
});

test('night skiing states are checked into the evening', () => {
  assert.equal(liftsDue('VT', new Date('2026-12-16T01:00:00Z'), '2026-12-16T00:45:00Z'), true); // 8 pm Eastern
  assert.equal(liftsDue('VT', new Date('2026-12-16T05:00:00Z'), '2026-12-16T04:00:00Z'), false); // midnight, checked at 11 pm
});
