import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liftsDue } from '../src/lift-hours.js';

// 2026-12-15: Denver is UTC−7, New York UTC−5.
test('Colorado: checked during the ski day only, plus once after it ends', () => {
  assert.equal(liftsDue('CO', new Date('2026-12-15T17:00:00Z')), true); // 10 am
  assert.equal(liftsDue('CO', new Date('2026-12-16T01:00:00Z'), '2026-12-15T23:45:00Z'), true); // 6 pm, last at 4:45 pm
  assert.equal(liftsDue('CO', new Date('2026-12-16T02:00:00Z'), '2026-12-16T01:00:00Z'), false); // 7 pm, already did the evening check
  assert.equal(liftsDue('CO', new Date('2026-12-16T09:00:00Z'), '2026-12-16T01:00:00Z'), false); // 2 am
  assert.equal(liftsDue('CO', new Date('2026-12-16T09:00:00Z')), true); // never checked: check
});

test('night skiing states are checked into the evening', () => {
  assert.equal(liftsDue('VT', new Date('2026-12-16T01:00:00Z'), '2026-12-16T00:45:00Z'), true); // 8 pm Eastern
  assert.equal(liftsDue('VT', new Date('2026-12-16T05:00:00Z'), '2026-12-16T04:00:00Z'), false); // midnight, checked at 11 pm
});
