import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIFT_SOURCES, liftStatus, summarizeLifts } from '../src/lifts.js';

test('liftStatus understands how resorts word it', () => {
  assert.equal(liftStatus('open'), 'open');
  assert.equal(liftStatus('Open'), 'open');
  assert.equal(liftStatus('OPEN'), 'open');
  assert.equal(liftStatus('On Hold'), 'hold');
  assert.equal(liftStatus('wind hold'), 'hold');
  assert.equal(liftStatus('Scheduled'), 'scheduled');
  assert.equal(liftStatus('expected'), 'scheduled');
  assert.equal(liftStatus('closed_for_season'), 'closed');
  assert.equal(liftStatus('Closed'), 'closed');
  assert.equal(liftStatus(''), 'closed');
});

test('Loveland and Telluride page parsers read their tables', () => {
  const loveland = LIFT_SOURCES.loveland.parse('<h2 class="tablepress-table-name">Chet&#8217;s Dream - OPEN</h2><h2 class="tablepress-table-name">PTARMIGAN LIFT - CLOSED</h2>');
  assert.deepEqual(loveland.map((l) => [l.name, l.status]), [['Chet’s Dream', 'open'], ['Ptarmigan Lift', 'closed']]);
  const telluride = LIFT_SOURCES.telluride.parse('<table id="tsr-report-app-lift-table"><tbody><tr> <td><span class="tsr-report-app-icon-open"></span></td> <td>Free Gondola &#8211; Town to MV</td> <td>Village</td> <td>7:00 AM - 11:00 PM</td></tr></tbody></table>');
  assert.deepEqual(telluride, [{ name: 'Free Gondola – Town to MV', status: 'open', hours: '7:00 AM - 11:00 PM' }]);
});

test('summarizeLifts counts and keeps the latest resort update', () => {
  const s = summarizeLifts([
    { name: 'A', status: 'open', updated: '2026-11-12T09:00:00Z' },
    { name: 'B', status: 'hold', updated: '2026-11-12T10:00:00Z' },
    { name: 'C', status: 'closed' },
  ], 'https://example.com', '2026-11-12T11:00:00Z');
  assert.deepEqual([s.open, s.hold, s.scheduled, s.total], [1, 1, 0, 3]);
  assert.equal(s.updated, '2026-11-12T10:00:00Z');
});
