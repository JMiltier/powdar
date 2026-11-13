// Every resort the app shows.
//   csc:  key in Colorado Ski Country USA's public feed (live open status + snow report).
//         Resorts without it (Vail Resorts' mountains, Wolf Creek) only get forecasts
//         and the planned dates below.
//   at:   [lat, lon] for the map.
//   elev: rough mid-mountain elevation in feet ((base + summit) / 2); forecasts are run for this height.
//   nws:  National Weather Service forecast grid [office, x, y] near mid-mountain,
//         looked up once from api.weather.gov/points/{lat},{lon}.
export const RESORTS = [
  { id: 'arapahoe-basin', at: [39.6425, -105.8719], elev: 11900, name: 'Arapahoe Basin', region: 'I-70 / Summit', csc: 'arapahoe-basin', nws: ['BOU', 32, 59], url: 'https://www.arapahoebasin.com' },
  { id: 'loveland', at: [39.68, -105.8979], elev: 11900, name: 'Loveland', region: 'I-70 / Summit', csc: 'loveland', nws: ['BOU', 31, 61], url: 'https://skiloveland.com' },
  { id: 'keystone', at: [39.59, -105.945], elev: 10800, name: 'Keystone', region: 'I-70 / Summit', nws: ['BOU', 29, 57], url: 'https://www.keystoneresort.com' },
  { id: 'breckenridge', at: [39.4817, -106.0384], elev: 11300, name: 'Breckenridge', region: 'I-70 / Summit', nws: ['BOU', 26, 53], url: 'https://www.breckenridge.com' },
  { id: 'copper-mountain', at: [39.5022, -106.1511], elev: 11100, name: 'Copper Mountain', region: 'I-70 / Summit', csc: 'copper-mountain', nws: ['BOU', 22, 54], url: 'https://www.coppercolorado.com' },
  { id: 'vail', at: [39.6061, -106.355], elev: 9850, name: 'Vail', region: 'Vail Valley', nws: ['GJT', 174, 119], url: 'https://www.vail.com' },
  { id: 'beaver-creek', at: [39.6042, -106.5165], elev: 9400, name: 'Beaver Creek', region: 'Vail Valley', nws: ['GJT', 168, 120], url: 'https://www.beavercreek.com' },
  { id: 'cooper', at: [39.3606, -106.3017], elev: 11100, name: 'Ski Cooper', region: 'Central', csc: 'cooper', nws: ['PUB', 40, 119], url: 'https://www.skicooper.com' },
  { id: 'winter-park', at: [39.8868, -105.7625], elev: 10500, name: 'Winter Park', region: 'Front Range', csc: 'winter-park', nws: ['BOU', 37, 70], url: 'https://www.winterparkresort.com' },
  { id: 'eldora', at: [39.9372, -105.5828], elev: 10000, name: 'Eldora', region: 'Front Range', csc: 'eldora', nws: ['BOU', 43, 72], url: 'https://www.eldora.com' },
  { id: 'echo-mountain', at: [39.6847, -105.5194], elev: 10350, name: 'Echo Mountain', region: 'Front Range', csc: 'echo-mountain', nws: ['BOU', 44, 60], url: 'https://www.echomntn.com' },
  { id: 'granby-ranch', at: [40.0447, -105.9061], elev: 8700, name: 'Granby Ranch', region: 'Front Range', csc: 'granby-ranch', nws: ['BOU', 32, 78], url: 'https://granbyranch.com' },
  { id: 'steamboat', at: [40.4572, -106.8045], elev: 8700, name: 'Steamboat', region: 'Northwest', csc: 'steamboat', nws: ['GJT', 162, 159], url: 'https://www.steamboat.com' },
  { id: 'howelsen-hill', at: [40.4834, -106.8381], elev: 7000, name: 'Howelsen Hill', region: 'Northwest', csc: 'howelsen-hill', nws: ['GJT', 161, 160], url: 'https://www.coloradoski.com/resorts/howelsen-hill' },
  { id: 'aspen-mountain', at: [39.1863, -106.818], elev: 9600, name: 'Aspen Mountain', region: 'Aspen', csc: 'aspen-mountain', nws: ['GJT', 156, 102], url: 'https://www.aspensnowmass.com' },
  { id: 'aspen-highlands', at: [39.182, -106.8556], elev: 9850, name: 'Aspen Highlands', region: 'Aspen', csc: 'aspen-highlands', nws: ['GJT', 155, 102], url: 'https://www.aspensnowmass.com' },
  { id: 'buttermilk', at: [39.2052, -106.8612], elev: 8900, name: 'Buttermilk', region: 'Aspen', csc: 'aspen-buttermilk', nws: ['GJT', 155, 103], url: 'https://www.aspensnowmass.com' },
  { id: 'snowmass', at: [39.2084, -106.949], elev: 10300, name: 'Snowmass', region: 'Aspen', csc: 'snowmass', nws: ['GJT', 152, 103], url: 'https://www.aspensnowmass.com' },
  { id: 'sunlight', at: [39.3997, -107.3384], elev: 8900, name: 'Sunlight', region: 'Aspen', csc: 'sunlight', nws: ['GJT', 139, 113], url: 'https://sunlightmtn.com' },
  { id: 'powderhorn', at: [39.0694, -108.1508], elev: 9000, name: 'Powderhorn', region: 'Western Slope', csc: 'powderhorn', nws: ['GJT', 109, 101], url: 'https://www.powderhorn.com' },
  { id: 'crested-butte', at: [38.8986, -106.965], elev: 10750, name: 'Crested Butte', region: 'Central', nws: ['GJT', 150, 89], url: 'https://www.skicb.com' },
  { id: 'monarch', at: [38.5122, -106.332], elev: 11400, name: 'Monarch', region: 'Central', csc: 'monarch', nws: ['PUB', 36, 81], url: 'https://www.skimonarch.com' },
  { id: 'telluride', at: [37.9375, -107.8123], elev: 10900, name: 'Telluride', region: 'Southwest', csc: 'telluride', nws: ['GJT', 116, 49], url: 'https://www.tellurideskiresort.com' },
  { id: 'silverton', at: [37.8846, -107.6659], elev: 11950, name: 'Silverton', region: 'Southwest', csc: 'silverton', nws: ['GJT', 121, 46], url: 'https://silvertonmountain.com' },
  { id: 'purgatory', at: [37.6303, -107.814], elev: 9800, name: 'Purgatory', region: 'Southwest', csc: 'purgatory-resort', nws: ['GJT', 115, 35], url: 'https://www.purgatory.ski' },
  { id: 'wolf-creek', at: [37.4722, -106.7933], elev: 11100, name: 'Wolf Creek', region: 'Southwest', nws: ['PUB', 15, 36], url: 'https://wolfcreekski.com' },
];

// Planned dates for resorts without a live feed, keyed by season. Update each fall;
// a season with no entry shows "Date TBA" instead of last year's dates.
// `when` replaces the exact date in the wording when a resort only gave a rough target.
// `opened: true` once news confirms the resort actually opened (shows as Open, not "Probably open").
// Sources: Vail Resorts' 2026-27 announcement (coloradobiz.com); Keystone opened Oct 30 (unofficialnetworks.com).
export const PLANNED = {
  '2026-27': {
    breckenridge: { open: '2026-11-06' },
    vail: { open: '2026-11-13' },
    'beaver-creek': { open: '2026-11-25' },
    'crested-butte': { open: '2026-11-25' },
    keystone: { open: '2026-10-30', opened: true },
  },
};
