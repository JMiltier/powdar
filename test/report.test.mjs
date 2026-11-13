import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildReport, durationHours, parseCsc, parseForecast, seasonOf, statusFor, CSC_FEED } from '../src/report.js';
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

test('parseForecast buckets snow into Colorado days and converts units', () => {
  const f = parseForecast(grid.properties, NOW);
  assert.equal(f.days.length, 7);
  assert.equal(f.days[0].date, '2026-11-12');
  assert.equal(f.days[6].date, '2026-11-18');
  for (const d of f.days) {
    assert.ok(d.snow >= 0);
    assert.ok(d.hi == null || (d.hi > -40 && d.hi < 90), `high ${d.hi} looks like °F`);
  }
  // Totals agree with the raw NWS millimetres for the same window.
  const rawMm = grid.properties.snowfallAmount.values.reduce((s, v) => s + (v.value ?? 0), 0);
  assert.ok(f.next7 <= rawMm / 25.4 + 0.1);
  assert.ok(f.next72 <= f.next7 + 0.1);
});

test('parseForecast copes with missing series', () => {
  const f = parseForecast({}, NOW);
  assert.equal(f.next72, 0);
  assert.equal(f.days[0].hi, null);
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
  assert.deepEqual(statusFor({ live: true, isOpen: true, report }, today), { state: 'open', label: 'Open', detail: '1 of 9 lifts · 1 of 147 runs' });
  assert.equal(statusFor({ live: true, isOpen: false, open: '2026-11-13' }, today).label, 'Opens Fri, Nov 13');
  assert.equal(statusFor({ live: false, open: '2026-11-13' }, today).detail, 'Planned date');
  assert.equal(statusFor({ live: true, isOpen: false, open: '2026-11-06' }, today).state, 'late');
  const likely = statusFor({ live: false, open: '2026-10-31', when: 'late October' }, today);
  assert.equal(likely.state, 'likely');
  assert.equal(likely.label, 'Probably open');
  assert.match(likely.detail, /late October/);
  const confirmed = statusFor({ live: false, open: '2026-10-30', opened: true }, today);
  assert.equal(confirmed.state, 'open');
  assert.match(confirmed.detail, /Opened Fri, Oct 30/);
  assert.equal(statusFor({ live: false }, today).label, 'Opening date TBA');
  assert.equal(statusFor({ live: true, isOpen: false, close: '2026-11-01' }, today).state, 'done');
});

const fakeFetch = (overrides = {}) => async (url) => {
  const body = url in overrides ? overrides[url] : url === CSC_FEED ? feed : grid;
  if (body instanceof Error) throw body;
  return { ok: true, json: async () => body };
};

test('buildReport assembles every resort', async () => {
  const data = await buildReport({ fetch: fakeFetch(), now: NOW });
  assert.equal(data.season, '2026-27');
  assert.equal(data.resorts.length, RESORTS.length);
  assert.deepEqual(data.sources, { coloradoSki: true, forecasts: RESORTS.length, resorts: RESORTS.length });
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
    fetch: fakeFetch({ [CSC_FEED]: new Error('down'), [`https://api.weather.gov/gridpoints/${vail.nws[0]}/${vail.nws[1]},${vail.nws[2]}`]: new Error('500') }),
    now: NOW,
  });
  assert.equal(data.sources.coloradoSki, false);
  assert.equal(data.sources.forecasts, RESORTS.length - 1);
  const byId = Object.fromEntries(data.resorts.map((r) => [r.id, r]));
  assert.equal(byId.vail.forecast, null);
  assert.equal(byId['arapahoe-basin'].live, false);
  assert.equal(byId['arapahoe-basin'].status.state, 'tba');
});
