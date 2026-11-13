// Every resort the app shows.
//   csc:  key in Colorado Ski Country USA's public feed (live open status + snow report).
//         Resorts without it (Vail Resorts' mountains, Wolf Creek) only get forecasts
//         and the planned dates below.
//   nws:  National Weather Service forecast grid [office, x, y] near mid-mountain,
//         looked up once from api.weather.gov/points/{lat},{lon}.
export const RESORTS = [
  { id: 'arapahoe-basin', name: 'Arapahoe Basin', region: 'I-70 / Summit', csc: 'arapahoe-basin', nws: ['BOU', 32, 59], url: 'https://www.arapahoebasin.com' },
  { id: 'loveland', name: 'Loveland', region: 'I-70 / Summit', csc: 'loveland', nws: ['BOU', 31, 61], url: 'https://skiloveland.com' },
  { id: 'keystone', name: 'Keystone', region: 'I-70 / Summit', nws: ['BOU', 29, 57], url: 'https://www.keystoneresort.com' },
  { id: 'breckenridge', name: 'Breckenridge', region: 'I-70 / Summit', nws: ['BOU', 26, 53], url: 'https://www.breckenridge.com' },
  { id: 'copper-mountain', name: 'Copper Mountain', region: 'I-70 / Summit', csc: 'copper-mountain', nws: ['BOU', 22, 54], url: 'https://www.coppercolorado.com' },
  { id: 'vail', name: 'Vail', region: 'Vail Valley', nws: ['GJT', 174, 119], url: 'https://www.vail.com' },
  { id: 'beaver-creek', name: 'Beaver Creek', region: 'Vail Valley', nws: ['GJT', 168, 120], url: 'https://www.beavercreek.com' },
  { id: 'cooper', name: 'Ski Cooper', region: 'Central', csc: 'cooper', nws: ['PUB', 40, 119], url: 'https://www.skicooper.com' },
  { id: 'winter-park', name: 'Winter Park', region: 'Front Range', csc: 'winter-park', nws: ['BOU', 37, 70], url: 'https://www.winterparkresort.com' },
  { id: 'eldora', name: 'Eldora', region: 'Front Range', csc: 'eldora', nws: ['BOU', 43, 72], url: 'https://www.eldora.com' },
  { id: 'echo-mountain', name: 'Echo Mountain', region: 'Front Range', csc: 'echo-mountain', nws: ['BOU', 44, 60], url: 'https://www.echomntn.com' },
  { id: 'granby-ranch', name: 'Granby Ranch', region: 'Front Range', csc: 'granby-ranch', nws: ['BOU', 32, 78], url: 'https://granbyranch.com' },
  { id: 'steamboat', name: 'Steamboat', region: 'Northwest', csc: 'steamboat', nws: ['GJT', 162, 159], url: 'https://www.steamboat.com' },
  { id: 'howelsen-hill', name: 'Howelsen Hill', region: 'Northwest', csc: 'howelsen-hill', nws: ['GJT', 161, 160], url: 'https://www.coloradoski.com/resorts/howelsen-hill' },
  { id: 'aspen-mountain', name: 'Aspen Mountain', region: 'Aspen', csc: 'aspen-mountain', nws: ['GJT', 156, 102], url: 'https://www.aspensnowmass.com' },
  { id: 'aspen-highlands', name: 'Aspen Highlands', region: 'Aspen', csc: 'aspen-highlands', nws: ['GJT', 155, 102], url: 'https://www.aspensnowmass.com' },
  { id: 'buttermilk', name: 'Buttermilk', region: 'Aspen', csc: 'aspen-buttermilk', nws: ['GJT', 155, 103], url: 'https://www.aspensnowmass.com' },
  { id: 'snowmass', name: 'Snowmass', region: 'Aspen', csc: 'snowmass', nws: ['GJT', 152, 103], url: 'https://www.aspensnowmass.com' },
  { id: 'sunlight', name: 'Sunlight', region: 'Aspen', csc: 'sunlight', nws: ['GJT', 139, 113], url: 'https://sunlightmtn.com' },
  { id: 'powderhorn', name: 'Powderhorn', region: 'Western Slope', csc: 'powderhorn', nws: ['GJT', 109, 101], url: 'https://www.powderhorn.com' },
  { id: 'crested-butte', name: 'Crested Butte', region: 'Central', nws: ['GJT', 150, 89], url: 'https://www.skicb.com' },
  { id: 'monarch', name: 'Monarch', region: 'Central', csc: 'monarch', nws: ['PUB', 36, 81], url: 'https://www.skimonarch.com' },
  { id: 'telluride', name: 'Telluride', region: 'Southwest', csc: 'telluride', nws: ['GJT', 116, 49], url: 'https://www.tellurideskiresort.com' },
  { id: 'silverton', name: 'Silverton', region: 'Southwest', csc: 'silverton', nws: ['GJT', 121, 46], url: 'https://silvertonmountain.com' },
  { id: 'purgatory', name: 'Purgatory', region: 'Southwest', csc: 'purgatory-resort', nws: ['GJT', 115, 35], url: 'https://www.purgatory.ski' },
  { id: 'wolf-creek', name: 'Wolf Creek', region: 'Southwest', nws: ['PUB', 15, 36], url: 'https://wolfcreekski.com' },
];

// Planned dates for resorts without a live feed, keyed by season. Update each fall;
// a season with no entry shows "Date TBA" instead of last year's dates.
// `when` replaces the exact date in the wording when a resort only gave a rough target.
// Sources: Vail Resorts' 2026-27 announcement (coloradobiz.com).
export const PLANNED = {
  '2026-27': {
    breckenridge: { open: '2026-11-06' },
    vail: { open: '2026-11-13' },
    'beaver-creek': { open: '2026-11-25' },
    'crested-butte': { open: '2026-11-25' },
    keystone: { open: '2026-10-31', when: 'late October' },
  },
};
