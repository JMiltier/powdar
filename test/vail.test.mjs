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

test('Wolf Creek report page parses (snowfall, depth, open %, lifts, update date)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseWolfCreek } = await import('../src/wolfcreek.js');
  const r = parseWolfCreek(await readFile(new URL('./fixtures/wolfcreek-report.html', import.meta.url), 'utf8'));
  assert.equal(r.new24, 5);
  assert.equal(r.new48, 12);
  assert.equal(r.new7d, 12);
  assert.equal(r.seasonTotal, 51);
  assert.equal(r.depth, 30);
  assert.equal(r.openPct, 54.5);
  assert.equal(r.lifts, 6);
  assert.equal(r.updated, '2026-11-15');
  assert.equal(r.surface, 'Powder/Packed Powder');
});

test('Ski Utah list: opening dates, TBA, closed for the season, and open with numbers', async () => {
  const { parseSkiUtah } = await import('../src/skiutah.js');
  const row = (slug, inner) => `<li class="row"><div class="col title"><a href="https://www.skiutah.com/members/${slug}/snowreport">X</a></div>${inner}</li>`;
  const html = `<div class="resort-totals">${row('alta', '<div class="col-4 override">Opening Nov 20</div>')}${row('beaver-mountain', '<div class="col-4 override">Opening Day TBA</div>')}${row('eagle-point', '<div class="col-4 override">Closed For 2026-27 Season</div>')}${row('brian-head', '<div class="col-4">3"</div><div class="col-4">24"</div>')}</div>`;
  const m = parseSkiUtah(html, { startYear: 2026 });
  assert.deepEqual(m.get('alta'), { open: false, date: '2026-11-20' });
  assert.equal(m.get('beaver-mountain').tba, true);
  assert.equal(m.get('eagle-point').closedSeason, true);
  assert.deepEqual(m.get('brian-head'), { open: true, new24: 3, depth: 24 });
});

test('Vail snow report: Pacific time stamps, and a page of zeros is no report', () => {
  const pst = parseVailSnow(page('snowReportData', { TwentyFourHourSnowfall: { Inches: '15' }, BaseDepth: { Inches: '8' }, CurrentSeason: { Inches: '41' }, LastUpdatedText: 'Updated November 19, 2026 at 6:00 AM PST' }));
  assert.equal(pst.updated, '2026-11-19T14:00:00.000Z');
  const zeros = { Inches: '0', Centimeters: '0' };
  assert.equal(parseVailSnow(page('snowReportData', { TwentyFourHourSnowfall: zeros, FortyEightHourSnowfall: zeros, SevenDaySnowfall: zeros, BaseDepth: zeros, CurrentSeason: zeros, LastUpdatedText: 'Updated November 01, 2026 at 10:00 AM PST' })), null);
});
