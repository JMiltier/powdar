import { test } from 'node:test';
import assert from 'node:assert/strict';
import { despike, parseSnotel, stationSeason, waterYear } from '../src/snotel.js';
import { blendForecast, nwsDaily } from '../src/report.js';

test('waterYear starts Oct 1', () => {
  assert.deepEqual(waterYear('2026-11-12'), { start: '2026-10-01', startYear: 2026 });
  assert.deepEqual(waterYear('2027-03-01'), { start: '2026-10-01', startYear: 2026 });
});

const station = (swe, depth = []) => [{ stationTriplet: '1:CO:SNTL', data: [
  { stationElement: { elementCode: 'WTEQ' }, values: swe },
  { stationElement: { elementCode: 'SNWD' }, values: depth },
] }];

test('stationSeason compares to normal and maps last season’s normals onto this season', () => {
  const current = parseSnotel(station(
    [{ date: '2026-10-01', value: 0, median: 0 }, { date: '2026-11-11', value: 7.2, median: 4.3 }, { date: '2026-11-12', value: null, median: 4.4 }],
    [{ date: '2026-11-11', value: 20 }],
  )).get('1:CO:SNTL');
  const normals = parseSnotel(station([
    { date: '2025-10-01', value: 0, median: 0 }, { date: '2026-04-15', value: 30, median: 31 }, { date: '2026-06-30', value: 0, median: 2 },
  ])).get('1:CO:SNTL');
  const s = stationSeason({ current, normals, today: '2026-11-12' });
  assert.deepEqual(s.latest, { date: '2026-11-11', swe: 7.2, normal: 4.3, depth: 20 });
  assert.equal(s.pct, 167);
  assert.deepEqual(s.peak, { swe: 31, date: '2027-04-15' });
  assert.equal(s.normal.at(-1)[0], 272, 'Jun 30 is day 272 of the season');
});

test('stationSeason hides % of normal while the normal is still tiny', () => {
  const current = parseSnotel(station([{ date: '2026-10-20', value: 0.4, median: 0.1 }])).get('1:CO:SNTL');
  assert.equal(stationSeason({ current, normals: null, today: '2026-10-21' }).pct, null);
  assert.equal(stationSeason({ current: parseSnotel(station([])).get('1:CO:SNTL'), normals: null, today: '2026-10-21' }), null);
});

test('week 2 and the water projection only use sources that reach that far', () => {
  const now = new Date('2026-11-12T20:00:00Z');
  const hourly = (days, v, w) => Array.from({ length: days * 24 }, (_, h) => ({ t: now.getTime() + h * 3_600_000, v, w }));
  const f = blendForecast({ nws: null, sources: [
    { id: 'long1', hours: hourly(16, 0.1, 0.01) },
    { id: 'long2', hours: hourly(16, 0.3, 0.02) },
    { id: 'short', hours: hourly(7, 5, 0.5) },
  ] }, now);
  assert.equal(f.week2.sources, 2);
  assert.ok(f.week2.mid > 10 && f.week2.mid < 40, `week 2 ${f.week2.mid} ignores the 7-day source`);
  assert.equal(f.waterAhead.length, 14);
});

test('nwsDaily splits day and night periods by local date', () => {
  const d = nwsDaily([
    { startTime: '2026-11-14T06:00:00-07:00', isDaytime: true, shortForecast: 'Snow Showers', windSpeed: '10 to 15 mph', windDirection: 'W', detailedForecast: 'Snow showers. High near 25.', probabilityOfPrecipitation: { value: 97 } },
    { startTime: '2026-11-14T18:00:00-07:00', isDaytime: false, shortForecast: 'Mostly Cloudy', probabilityOfPrecipitation: { value: 20 } },
  ]);
  assert.deepEqual(d.get('2026-11-14'), { sky: 'Snow Showers', wind: '10 to 15 mph', pop: 97, windDir: 'W', detail: 'Snow showers. High near 25.', night: 'Mostly Cloudy', nightPop: 20 });
});

test('despike drops one-off sensor spikes and dropouts but keeps real storms', () => {
  const day = (i, value) => ({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, value });
  const spike = [0.5, 0.6, 0.6, 9, 0.7, 0.7, 0.8].map((v, i) => day(i, v));
  assert.deepEqual(despike(spike).map((x) => x.value), [0.5, 0.6, 0.6, 0.7, 0.7, 0.8]);
  const dropout = [14, 14.2, 14.3, 0, 14.5, 14.6, 14.6].map((v, i) => day(i, v));
  assert.ok(!despike(dropout).some((x) => x.value === 0));
  const storm = [5, 5, 5.1, 8, 8.4, 8.6, 8.7, 8.8].map((v, i) => day(i, v));
  assert.equal(despike(storm).length, storm.length, 'a 3″ storm that stays is real');
});

test('parseNohrsc converts NOAA snow model values to inches', async () => {
  const { parseNohrsc } = await import('../src/noaa.js');
  const json = { results: [
    { layerId: 3, attributes: { 'Service Pixel Value': '0.69' } },
    { layerId: 7, attributes: { 'Service Pixel Value': '218' } },
  ] };
  assert.deepEqual(parseNohrsc(json), { depth: 27.2, water: 8.6 });
  assert.equal(parseNohrsc({ results: [] }), null);
});
