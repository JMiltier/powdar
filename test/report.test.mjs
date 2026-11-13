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
  assert.equal(byId['wolf-creek'].status.state, 'tba');
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
