import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blendForecast, buildReport, durationHours, nwsSnowHours, parseCsc, seasonOf, spread, statusFor, CSC_FEED } from '../src/report.js';
import { MODELS, snowHours, snowRatio } from '../src/models.js';
import { RESORTS } from '../src/resorts.js';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const feed = await fixture('csc-feed.json');
const grid = await fixture('nws-grid-abasin.json');
// Both fixtures were captured on the afternoon of Nov 12, 2026 (Colorado time).
const NOW = new Date('2026-11-12T20:00:00Z');
const season = seasonOf('2026-11-12');

test('durationHours reads NWS durations', () => {
  assert.equal(durationHours('PT6H'), 6);
  assert.equal(durationHours('P1DT21H'), 45);
  assert.equal(durationHours('P2D'), 48);
  assert.throws(() => durationHours('PT30M'));
});

test('seasonOf splits on August 1', () => {
  assert.deepEqual(seasonOf('2026-11-12'), { name: '2026-27', start: '2026-08-01', end: '2027-07-31' });
  assert.equal(seasonOf('2027-04-01').name, '2026-27');
  assert.equal(seasonOf('2027-08-01').name, '2027-28');
});

const nwsOnly = (props) => blendForecast({ nws: props, sources: [{ id: 'nws', hours: nwsSnowHours(props) }] }, NOW);

test('NWS forecast is bucketed into Colorado days in inches and °F', () => {
  const f = nwsOnly(grid.properties);
  assert.equal(f.days.length, 7);
  assert.equal(f.days[0].date, '2026-11-12');
  assert.equal(f.days[6].date, '2026-11-18');
  for (const d of f.days) {
    assert.ok(d.snow >= 0);
    assert.ok(d.hi == null || (d.hi > -40 && d.hi < 90), `high ${d.hi} looks like °F`);
  }
  const rawMm = grid.properties.snowfallAmount.values.reduce((s, v) => s + (v.value ?? 0), 0);
  assert.ok(f.next7 <= rawMm / 25.4 + 0.1);
  assert.ok(f.next72 <= f.next7 + 0.1);
  assert.deepEqual(f.sources, ['nws']);
});

test('blendForecast: the last and next 24 hours, hour by hour, the middle of the forecasts', () => {
  const hr = 3_600_000;
  const start = Math.floor(NOW.getTime() / hr) * hr;
  const src = (id, v) => ({ id, hours: [-2, -1, 0, 1].map((k) => ({ t: start + k * hr + 1_800_000, v })) });
  const { hourly } = blendForecast({ sources: [src('a', 0.1), src('b', 0.3), src('c', 0.2)] }, NOW);
  assert.equal(hourly.from, start - 24 * hr);
  assert.equal(hourly.v.length, 48);
  assert.deepEqual(hourly.v.slice(22, 26), [0.2, 0.2, 0.2, 0.2]);
  assert.equal(hourly.v[0], null);
});

test('blendForecast returns null with no usable source', () => {
  assert.equal(blendForecast({ nws: {}, sources: [{ id: 'nws', hours: nwsSnowHours({}) }] }, NOW), null);
});

test('spread takes the middle and drops the outliers from the range', () => {
  assert.deepEqual(spread([0, 2, 3, 4, 20]), { mid: 3, lo: 2, hi: 4 });
  assert.deepEqual(spread([5]), { mid: 5, lo: 5, hi: 5 });
  assert.deepEqual(spread([1, 3]), { mid: 2, lo: 1, hi: 3 });
});

test('snowRatio: rain when warm, fluffier when cold', () => {
  assert.equal(snowRatio(3), 0);
  assert.ok(snowRatio(1) > 0 && snowRatio(1) < snowRatio(-1));
  assert.ok(snowRatio(-12) > snowRatio(-2));
});

test('snowHours converts a model response with the temperature ratio', () => {
  const t0 = Date.parse('2026-11-13T00:00:00Z') / 1000;
  const loc = { hourly: { time: [t0, t0 + 3600, t0 + 7200], precipitation: [2.54, 2.54, null], temperature_2m: [-10, 5, -10] } };
  const hours = snowHours(loc);
  assert.equal(hours.length, 2);
  assert.ok(Math.abs(hours[0].v - 1.7) < 1e-9, '0.1 in of water at -10 °C → 1.7 in of snow');
  assert.equal(hours[1].v, 0, 'rain at +5 °C');
  assert.equal(snowHours({}), null);
});

test('past 24 hours comes only from sources that cover it', () => {
  const now = NOW.getTime();
  const model = { id: 'm', hours: [{ t: now - 20 * 3_600_000, v: 2 }, { t: now - 23.5 * 3_600_000, v: 1 }, { t: now + 3_600_000, v: 5 }] };
  const future = { id: 'nws', hours: [{ t: now + 3_600_000, v: 4 }] };
  const f = blendForecast({ nws: null, sources: [model, future] }, NOW);
  assert.equal(f.past24, 3);
  assert.deepEqual(f.past24Range, [3, 3]);
  assert.equal(blendForecast({ nws: null, sources: [future] }, NOW).past24, null);
});

test('blendForecast uses the median of sources and gives a range', () => {
  const t = NOW.getTime() + 3_600_000;
  const src = (id, v) => ({ id, hours: [{ t, v }] });
  const f = blendForecast({ nws: null, sources: [src('a', 1), src('b', 2), src('c', 3), src('d', 4), src('e', 30)] }, NOW);
  assert.equal(f.next72, 3);
  assert.deepEqual(f.next72Range, [2, 4]);
  assert.equal(f.days[0].snow, 3);
  assert.equal(f.days[0].snowHi, 4);
  assert.equal(f.sources.length, 5);
});

test('parseCsc reads open status, lifts and runs', () => {
  const csc = parseCsc(feed, season);
  const abasin = csc.get('arapahoe-basin');
  assert.equal(abasin.isOpen, true);
  assert.equal(abasin.open, '2026-10-28');
  assert.deepEqual(abasin.report.lifts, { open: 1, total: 9 });
  assert.equal(abasin.report.trails.total, 147);
  assert.equal(abasin.report.depth, 18);
  assert.equal(csc.get('winter-park').isOpen, false);
});

test('parseCsc drops dates left over from last season', () => {
  const csc = parseCsc(feed, season);
  assert.equal(csc.get('cooper').open, null, 'Cooper still lists its 2025 opening date');
  assert.equal(csc.get('cooper').close, null);
});

test('every CSC key in resorts.js exists in the feed', () => {
  const csc = parseCsc(feed, season);
  for (const r of RESORTS.filter((r) => r.csc)) assert.ok(csc.has(r.csc), `${r.name} (${r.csc}) missing from feed`);
});

test('statusFor wording', () => {
  const today = '2026-11-12';
  const report = { lifts: { open: 1, total: 9 }, trails: { open: 1, total: 147 } };
  assert.deepEqual(statusFor({ live: true, isOpen: true, report }, today), { state: 'open', label: 'Open', pct: 1, detail: '1 of 9 lifts · 1 of 147 runs' });
  assert.equal(statusFor({ live: true, isOpen: false, note: 'Resort Opens ASAP' }, today).label, 'Opening ASAP');
  assert.equal(statusFor({ live: true, isOpen: false, note: 'Resort Opens TBD' }, today).label, 'Opens TBA');
  assert.equal(statusFor({ live: true, isOpen: false, open: '2026-11-13' }, today).label, 'Opens Fri, Nov 13');
  assert.equal(statusFor({ live: false, open: '2026-11-13' }, today).detail, 'Planned date');
  assert.equal(statusFor({ live: true, isOpen: false, open: '2026-11-06' }, today).state, 'late');
  assert.equal(statusFor({ live: true, isOpen: false, open: '2026-11-12' }, today).label, 'Opens today');
  const likely = statusFor({ live: false, open: '2026-10-31', when: 'late October' }, today);
  assert.equal(likely.state, 'likely');
  assert.equal(likely.label, 'Probably open');
  assert.match(likely.detail, /late October/);
  const confirmed = statusFor({ live: false, open: '2026-10-30', opened: true }, today);
  assert.equal(confirmed.state, 'open');
  assert.match(confirmed.detail, /Opened Fri, Oct 30/);
  assert.equal(statusFor({ live: false }, today).label, 'Opens TBA');
  assert.equal(statusFor({ live: true, isOpen: false, close: '2026-11-01' }, today).state, 'done');
});

const t0 = Math.floor(NOW.getTime() / 1000);
const modelLoc = { hourly: { time: [t0 + 3600, t0 + 7200], precipitation: [2.54, 2.54], temperature_2m: [-6, -6] } };
const fakeFetch = (overrides = {}) => async (url) => {
  const key = Object.keys(overrides).find((k) => url.startsWith(k));
  const body = key ? overrides[key]
    : url === CSC_FEED ? feed
    : url.startsWith('https://api.open-meteo.com') ? RESORTS.map(() => modelLoc)
    : grid;
  if (body instanceof Error) throw body;
  return { ok: true, json: async () => body };
};

test('buildReport assembles every resort', async () => {
  const data = await buildReport({ fetch: fakeFetch(), now: NOW, backoff: 0 });
  assert.equal(data.season, '2026-27');
  assert.equal(data.resorts.length, RESORTS.length);
  assert.equal(data.sources.coloradoSki, true);
  assert.equal(data.sources.forecasts, RESORTS.length);
  assert.equal(data.sources.nws, RESORTS.length);
  assert.ok(Object.values(data.sources.models).every(Boolean));
  assert.equal(data.resorts[0].forecast.sources.length, 1 + MODELS.length);
  const byId = Object.fromEntries(data.resorts.map((r) => [r.id, r]));
  assert.equal(byId['arapahoe-basin'].status.state, 'open');
  assert.equal(byId['winter-park'].report, null, 'closed resorts show no snow report');
  assert.equal(byId.vail.status.label, 'Opens Fri, Nov 13');
  assert.equal(byId.breckenridge.status.state, 'likely');
  assert.equal(byId.keystone.status.state, 'open');
  // (Wolf Creek: reopening after the 2026 flood closure, from its announced day.)
  assert.equal(byId['wolf-creek'].status.state, 'soon');
  assert.match(byId['wolf-creek'].status.label, /^Reopens /);
  assert.deepEqual(byId['arapahoe-basin'].dates, { open: '2026-10-28', close: '2027-05-10', when: null, planned: false });
  assert.deepEqual(byId.vail.dates, { open: '2026-11-13', close: null, when: null, planned: true });
});

test('buildReport keeps going when a source fails', async () => {
  const vail = RESORTS.find((r) => r.id === 'vail');
  const data = await buildReport({
    fetch: fakeFetch({
      [CSC_FEED]: new Error('down'),
      [`https://api.weather.gov/gridpoints/${vail.nws[0]}/${vail.nws[1]},${vail.nws[2]}`]: new Error('500'),
      'https://api.open-meteo.com/v1/forecast?latitude': new Error('timeout'),
    }),
    now: NOW,
    backoff: 0,
  });
  assert.equal(data.sources.coloradoSki, false);
  assert.equal(data.sources.forecasts, RESORTS.length - 1, 'models down + Vail NWS down → only Vail lacks a forecast');
  assert.ok(Object.values(data.sources.models).every((ok) => !ok));
  const byId = Object.fromEntries(data.resorts.map((r) => [r.id, r]));
  assert.equal(byId.vail.forecast, null);
  assert.deepEqual(byId.loveland.forecast.sources, ['nws']);
  assert.equal(byId['arapahoe-basin'].live, false);
  assert.equal(byId['arapahoe-basin'].status.state, 'tba');
});

test('nightFor: night skiing from lift hours, or the published schedule on its days', async () => {
  const { nightFor } = await import('../src/report.js');
  const lifts = { lifts: [{ name: 'River Run Gondola', closes: '20:00' }, { name: 'Peru Express', closes: '16:00' }] };
  assert.deepEqual(nightFor({}, lifts, '2026-12-18'), { until: '20:00', lifts: ['River Run Gondola'], source: 'lifts' });
  assert.equal(nightFor({}, { lifts: [{ name: 'A', closes: '16:00' }] }, '2026-12-18'), null);
  const echo = { night: { days: [3, 4, 5, 6], from: '16:30', to: '21:00', source: 'x' } };
  assert.deepEqual(nightFor(echo, null, '2026-12-18'), { from: '16:30', until: '21:00', source: 'x' }); // a Friday
  assert.equal(nightFor(echo, null, '2026-12-20'), null); // Sunday
  assert.equal(nightFor(echo, null, '2026-12-18', false), null); // not open
});

test('snowLog: the 24-hour report is the day before, 48-hour fills the day before that', async () => {
  const { snowLog } = await import('../src/report.js');
  let log = snowLog([], '2026-12-10', { new24: 4, new48: 7 });
  assert.deepEqual(log, [{ date: '2026-12-08', snow: 3 }, { date: '2026-12-09', snow: 4 }]);
  log = snowLog(log, '2026-12-10', { new24: 5, new48: 8 }); // a later update that day adds
  assert.deepEqual(log.at(-1), { date: '2026-12-09', snow: 5 });
  log = snowLog(log, '2026-12-11', { new24: 0, new48: 5 });
  assert.deepEqual(log.map((e) => e.snow), [3, 5, 0]);
});

test("snowLog: an untimed report that hasn't changed since yesterday isn't logged again", async () => {
  const { snowLog } = await import('../src/report.js');
  let log = snowLog([], '2026-11-20', { new24: 10 }); // Ski Utah: no time on it
  log = snowLog(log, '2026-11-21', { new24: 10 }); // the same report, a day on
  assert.deepEqual(log, [{ date: '2026-11-19', snow: 10 }]);
  log = snowLog(log, '2026-11-21', { new24: 4 }); // updated
  assert.deepEqual(log.map((e) => e.snow), [10, 4]);
  // (A timed report that happens to match is logged.)
  assert.equal(snowLog(log.slice(0, 1), '2026-11-21', { new24: 10, updated: '2026-11-21T14:00:00Z' }).length, 2);
});

test("newerSnow: a resort's own later report replaces the snow numbers, keeping what it leaves blank", async () => {
  const { newerSnow, isoMs } = await import('../src/report.js');
  const csc = { new24: 0, new48: 0, depth: 18, surface: 'P/PP', updated: '2026-11-21T06:00:00-07:00' };
  const own = { new24: 3, new48: 3, new72: 3, new7d: 3, depth: null, seasonTotal: 10, surface: null, updated: '2026-11-21T19:03:39.000Z' };
  assert.deepEqual({ ...csc, ...newerSnow(own) }, { new24: 3, new48: 3, new72: 3, new7d: 3, depth: 18, seasonTotal: 10, surface: 'P/PP', updated: own.updated });
  assert.equal(isoMs('2026-11-21T06:54:18.757032-07:00'), Date.parse('2026-11-21T13:54:18.757Z'));
});

test('reportAnchor: the latest 7 AM in the area (Denver by default)', async () => {
  const { reportAnchor } = await import('../src/report.js');
  assert.equal(new Date(reportAnchor(Date.parse('2026-11-22T06:45:00Z'))).toISOString(), '2026-11-21T14:00:00.000Z'); // 11:45 PM
  assert.equal(new Date(reportAnchor(Date.parse('2026-11-22T15:10:00Z'))).toISOString(), '2026-11-22T14:00:00.000Z'); // 8:10 AM
});

test("nearbyCorrection: a resort that hasn't reported borrows its neighbors' (within 20 km), nearer counting more", async () => {
  const { nearbyCorrection } = await import('../src/report.js');
  const resorts = [{ id: 'alta', at: [40.588, -111.638] }, { id: 'solitude', at: [40.62, -111.59] }, { id: 'park-city', at: [40.651, -111.508] }, { id: 'far', at: [41.2, -111.86] }];
  const own = [{ factor: 1, days: 0 }, { factor: 1.1, days: 2 }, { factor: 1.9, days: 2 }, { factor: 3, days: 5 }];
  const out = nearbyCorrection(resorts, own);
  assert.deepEqual(out[0].nearby, ['solitude', 'park-city']); // ('far' is 70 km off)
  assert.ok(out[0].factor > 1.1 && out[0].factor < 1.6);
  assert.equal(out[1], own[1]); // (its own stands)
});

test("calibrateNearby: past days scaled by the neighbors' report-to-model ratio those days", async () => {
  const { calibrateNearby } = await import('../src/report.js');
  const fc = (snow) => ({ pastDays: [{ date: '2026-11-20', snow }], past: [{ asOf: Date.parse('2026-11-21T14:00:00Z'), h24: snow, h72: snow, h168: snow }], correction: { factor: 1 } });
  const resorts = [
    { id: 'alta', at: [40.588, -111.638], forecast: fc(2.3), snowLog: [] },
    { id: 'solitude', at: [40.62, -111.59], forecast: fc(3.5), snowLog: [{ date: '2026-11-20', snow: 9 }] },
  ];
  calibrateNearby(resorts);
  const n = resorts[0].forecast.nearby;
  assert.deepEqual(n.from, ['solitude']);
  assert.equal(n.days['2026-11-20'], 5.1); // 2.3 × (9+1)/(3.5+1)
  assert.equal(n.past[0].h24, 5.1);
});

test("snowLog: an afternoon update doesn't log the night's snow twice, and the next morning's 48 hours set the day before", async () => {
  const { snowLog } = await import('../src/report.js');
  // Beaver Creek, Nov 21–23, 2026 (closed; reporting the storm).
  let log = snowLog([], '2026-11-21', { new24: 8.7, new48: 9.5, updated: '2026-11-21T05:30:00-07:00' }, {}, { open: false });
  log = snowLog(log, '2026-11-21', { new24: 11.8, new48: 12.6, updated: '2026-11-21T15:40:00-07:00' }, {}, { open: false }); // afternoon revision
  assert.deepEqual(log.map((e) => [e.date, e.snow]), [['2026-11-19', 0.8], ['2026-11-20', 8.7]]);
  log = snowLog(log, '2026-11-22', { new24: 2.8, new48: 11.5, updated: '2026-11-22T05:30:00-07:00' }, {}, { open: false });
  log = snowLog(log, '2026-11-23', { new24: 0, new48: 2.8, new7d: 13.8, updated: '2026-11-23T05:36:00-07:00' }, {}, { open: false });
  assert.deepEqual(log.map((e) => [e.date, e.snow]), [['2026-11-19', 0.8], ['2026-11-20', 8.7], ['2026-11-21', 2.8]]);
  // A logged day the resort's own later 48 hours contradict is corrected (Vail: 7.9″ logged, 0.8″ by Monday's report).
  const fixed = snowLog([{ date: '2026-11-21', snow: 7.9 }], '2026-11-23', { new24: 0, new48: 0.8, updated: '2026-11-23T05:36:00-07:00' });
  assert.deepEqual(fixed.map((e) => [e.date, e.snow]), [['2026-11-21', 0.8], ['2026-11-22', 0]]);
});

test('modelCorrection: learns how far off the models run at a resort, cautiously', async () => {
  const { modelCorrection } = await import('../src/report.js');
  assert.equal(modelCorrection([]).factor, 1);
  assert.equal(modelCorrection([{ date: 'a', snow: 0, model: 0.2 }, { date: 'b', snow: 0, model: 0 }]).factor, 1); // dry: nothing to judge
  // Wolf Creek, Nov 13–14: 7″ and 5″ reported where the models had 0.1″ and 4.3″.
  const wc = modelCorrection([{ date: 'a', snow: 7, model: 0.1 }, { date: 'b', snow: 5, model: 4.3 }]);
  assert.ok(wc.factor > 1.4 && wc.factor < 1.8, String(wc.factor)); // one storm: a cautious nudge
  // Lots of evidence, models running double: about ½.
  assert.equal(modelCorrection([{ date: 'a', snow: 10, model: 20 }, { date: 'b', snow: 10, model: 20 }]).factor, 0.5); // (60″ of evidence: full weight)
});

test('reportDay: a morning report covers the day before; old reports cover nothing', async () => {
  const { reportDay } = await import('../src/report.js');
  assert.equal(reportDay('2026-12-10T06:00:00-07:00', '2026-12-10'), '2026-12-09');
  assert.equal(reportDay('2026-12-10T16:30:00-07:00', '2026-12-10'), '2026-12-09'); // afternoon update: the same report day, revised
  assert.equal(reportDay('2026-12-09T06:00:00-07:00', '2026-12-10'), '2026-12-08'); // not updated today
  assert.equal(reportDay('2026-12-06T06:00:00-07:00', '2026-12-10'), null);
  assert.equal(reportDay('2026-12-10', '2026-12-10'), '2026-12-09'); // date only (Wolf Creek)
});

test('freshSnow drops 24h/48h/7-day snow from a report over two days old', async () => {
  const { freshSnow } = await import('../src/report.js');
  const now = new Date('2026-12-10T20:00:00Z');
  assert.equal(freshSnow({ new24: 4, updated: '2026-12-10T13:00:00Z' }, now).new24, 4);
  const old = freshSnow({ new24: 4, depth: 30, updated: '2026-12-07T13:00:00Z' }, now);
  assert.equal(old.new24, null); assert.equal(old.depth, 30); assert.equal(old.staleSince, '2026-12-07T13:00:00Z');
});

test('nightFor: a village gondola running to 5 pm, or a closed lift, is not night skiing', async () => {
  const { nightFor } = await import('../src/report.js');
  assert.equal(nightFor({}, { lifts: [{ name: 'BreckConnect Gondola', status: 'scheduled', closes: '17:00' }] }, '2026-12-18'), null);
  assert.equal(nightFor({}, { lifts: [{ name: 'Riverfront', status: 'closed', closes: '20:00' }] }, '2026-12-18'), null);
  assert.equal(nightFor({}, { lifts: [{ name: 'River Run Gondola', status: 'open', closes: '20:00' }] }, '2026-12-18', false), null); // resort not open
});

test('liftsToday: running now, else the day’s peak after close, else scheduled', async () => {
  const { liftsToday } = await import('../src/report.js');
  assert.equal(liftsToday({ open: 4, hold: 1, scheduled: 0, ranToday: 6 }), 5);
  assert.equal(liftsToday({ open: 0, hold: 0, scheduled: 0, ranToday: 6 }), 6); // after hours
  assert.equal(liftsToday({ open: 0, hold: 0, scheduled: 5, ranToday: 0 }), 5); // before opening
});

test('snowcast: WPC probability KML → 10/40/70 % polygons near Colorado, with the valid window', async () => {
  const { parseContours } = await import('../src/snowcast.js');
  const pm = (p, coords) => `<Placemark><name>${p}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  const kml = `<snippet>Valid 00Z 11/16/2026 - 00Z 11/17/2026</snippet>${pm(10, '-106,39,0 -105,39,0 -105,40,0 -106,39,0')}${pm(5, '-106,39,0 -105,39,0 -105,40,0')}${pm(40, '-80,30,0 -79,30,0 -79,31,0')}`;
  const c = parseContours(kml);
  assert.equal(c.start, '2026-11-16T00:00:00Z');
  assert.equal(c.features.length, 1); // the 5 % contour and the far-away one are left out
  assert.equal(c.features[0].properties.prob, 10);
});

test('modelCorrection: a 0″ day under half a foot of model snow is a resort not measuring yet', async () => {
  const { modelCorrection } = await import('../src/report.js');
  // Kirkwood before its season: its page read 0 while the models (and its neighbors) had 2 feet.
  const c = modelCorrection([{ date: '2026-11-17', snow: 0, model: 0 }, { date: '2026-11-18', snow: 0, model: 25.6 }, { date: '2026-11-19', snow: 3, model: 2.5 }]);
  assert.equal(c.days, 2);
  assert.ok(c.factor >= 1);
});

test("snowLog: a closed resort's 0″ isn't logged, and 0″ days from before it opened are dropped", async () => {
  const { snowLog } = await import('../src/report.js');
  const report = { new24: 0, updated: '2026-11-19T06:00:00-07:00' };
  assert.deepEqual(snowLog([], '2026-11-19', report, {}, { open: false }), []);
  const prev = [{ date: '2026-11-17', snow: 0, model: 5 }, { date: '2026-11-18', snow: 3, model: 2 }];
  const log = snowLog(prev, '2026-11-20', null, {}, { open: true, openedOn: '2026-11-20' });
  assert.deepEqual(log.map((e) => e.date), ['2026-11-18']);
});
