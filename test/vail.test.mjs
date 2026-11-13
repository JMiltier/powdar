import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedded, parseVailSnow, parseVailTerrain, snowPage, liftPage } from '../src/vail.js';

const page = (name, obj) => `<script>var FR = {}; FR.other = {"a":"}"}; FR.${name} = ${JSON.stringify(obj)};</script>`;

test('reads the JSON embedded in a Vail Resorts page, braces in strings included', () => {
  assert.deepEqual(embedded(page('x', { s: 'a { b } c', n: 1 }), 'x'), { s: 'a { b } c', n: 1 });
  assert.equal(embedded('<p>nothing</p>', 'x'), null);
});

test('snow report → base depth, new snow, conditions, update time', () => {
  const r = parseVailSnow(page('snowReportData', {
    OverallSnowConditions: 'Early Season', BaseDepth: { Inches: '18' }, TwentyFourHourSnowfall: { Inches: '2' },
    FortyEightHourSnowfall: { Inches: '3' }, SevenDaySnowfall: { Inches: '5' }, CurrentSeason: { Inches: '7' },
    LastUpdatedText: 'Updated November 13, 2026 at 6:02 AM MST',
  }));
  assert.equal(r.depth, 18);
  assert.equal(r.new24, 2);
  assert.equal(r.new48, 3);
  assert.equal(r.surface, 'Early Season');
  assert.equal(r.updated, '2026-11-13T13:02:00.000Z');
});

test('lift and run status, with the page’s own status codes', () => {
  const t = parseVailTerrain(page('TerrainStatusFeed', {
    Lifts: [{ Name: 'River Run Gondola', Status: 1, OpenTime: '09:00', CloseTime: '16:00' }, { Name: 'Peru', Status: 3 }, { Name: 'Ruby', Status: 0 }],
    GroomingAreas: [{ Trails: [{ IsOpen: true }, { IsOpen: false }] }, { Trails: [{ IsOpen: true }] }],
  }));
  assert.deepEqual(t.lifts.map((l) => l.status), ['open', 'scheduled', 'closed']);
  assert.equal(t.lifts[0].hours, '9a–4p');
  assert.deepEqual(t.trails, { open: 2, total: 3 });
});

test('Crested Butte uses its own page names', () => {
  assert.match(snowPage('https://www.skicb.com'), /weather-report\.aspx$/);
  assert.match(liftPage('https://www.vail.com'), /terrain-and-lift-status\.aspx$/);
});
