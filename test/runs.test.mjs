import test from 'node:test';
import assert from 'node:assert/strict';
import { LIFT_SOURCES } from '../src/lifts.js';

test('open runs from MtnPowder and Powdr feeds: name, difficulty, groomed, area', () => {
  const feed = { MountainAreas: [{ Name: 'Front Side', Trails: [
    { Name: 'High Noon', StatusEnglish: 'open', TrailIcon: 'BlueSquare', Grooming: 'Yes' },
    { Name: 'Pallavicini', StatusEnglish: 'closed', TrailIcon: 'DoubleBlackDiamond', Grooming: 'No' },
  ] }] };
  assert.deepEqual(LIFT_SOURCES['arapahoe-basin'].runs.parse(feed), [{ name: 'High Noon', level: 'blue', groomed: true, area: 'Front Side' }]);
  const rows = [
    { name: 'Rhapsody', status: 'open', season: 'winter', type: 'alpine_trail', difficulty: 'more_difficult', groom_status: 'groomed', sector: { name: 'Center' } },
    { name: 'Bike Path', status: 'open', season: 'summer', type: 'mountain_bike_trail' },
    { name: 'Woodward', status: 'open', season: 'winter', type: 'terrain_park_trail', groom_status: 'not_groomed' },
  ];
  assert.deepEqual(LIFT_SOURCES['copper-mountain'].runs.parse(rows), [
    { name: 'Rhapsody', level: 'blue', groomed: true, area: 'Center' },
    { name: 'Woodward', level: 'park' },
  ]);
});
