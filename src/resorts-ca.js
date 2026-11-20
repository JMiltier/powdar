// California's ski areas, set up like Colorado's (src/resorts.js; the same fields), as three tight
// areas of their own: Tahoe (with Nevada's Mt Rose and Diamond Peak, and Highways 4 and 108 to the
// south), Mammoth & June, and Southern California. Locations, mid-mountain elevations, Weather Service
// grids and the nearest SNOTEL station come from the all-states work (src/us-resorts.json); added
// here: region, which way the main terrain faces (approximate), and short names for the map.
// Mammoth and Southern California have no SNOTEL station near enough to stand for them (snotel: null).
// Heavenly, Northstar and Kirkwood are Vail Resorts mountains: their own pages (src/vail.js).

export const TAHOE_RESORTS = [
  {id: 'palisades', name: 'Palisades Tahoe', short: 'Palisades', at: [39.1934,-120.2454], elev: 7471, aspect: 'NE', snotel: ['784:CA:SNTL','Palisades Tahoe'], region: 'North Lake', nws: ['REV',27,94], url: 'https://www.palisadestahoe.com'},
  {id: 'alpine-meadows', name: 'Alpine Meadows', short: 'Alpine', at: [39.1544,-120.2382], elev: 7358, aspect: 'E', snotel: ['848:CA:SNTL','Ward Creek #3'], region: 'North Lake', nws: ['REV',27,92], url: 'https://www.palisadestahoe.com'},
  {id: 'northstar', name: 'Northstar', short: 'Northstar', at: [39.2618,-120.135], elev: 7457, aspect: 'N', snotel: ['834:CA:SNTL','Truckee #2'], region: 'North Lake', nws: ['REV',32,96], url: 'https://www.northstarcalifornia.com'},
  {id: 'homewood', name: 'Homewood', short: 'Homewood', at: [39.0783,-120.1695], elev: 7063, aspect: 'E', snotel: ['848:CA:SNTL','Ward Creek #3'], region: 'North Lake', nws: ['REV',29,88], url: 'https://www.skihomewood.com'},
  {id: 'mt-rose', name: 'Mt. Rose', short: 'Mt Rose', at: [39.3208,-119.8844], elev: 8572, aspect: 'N', snotel: ['652:NV:SNTL','Mt Rose Ski Area'], region: 'North Lake', nws: ['REV',41,97], url: 'https://skirose.com'},
  {id: 'diamond-peak', name: 'Diamond Peak', short: 'Diamond Peak', at: [39.2536,-119.9161], elev: 7627, aspect: 'W', snotel: ['615:NV:SNTL','Marlette Lake'], region: 'North Lake', nws: ['REV',39,95], url: 'https://www.diamondpeak.com'},
  {id: 'sugar-bowl', name: 'Sugar Bowl', short: 'Sugar Bowl', at: [39.3003,-120.335], elev: 7641, aspect: 'NE', snotel: ['428:CA:SNTL','Css Lab'], region: 'Donner Summit', nws: ['STO',87,92], url: 'https://www.sugarbowl.com'},
  {id: 'boreal', name: 'Boreal', short: 'Boreal', at: [39.3314,-120.3481], elev: 7435, aspect: 'N', snotel: ['428:CA:SNTL','Css Lab'], region: 'Donner Summit', nws: ['STO',87,94], url: 'https://www.rideboreal.com'},
  {id: 'soda-springs', name: 'Soda Springs', short: 'Soda Springs', at: [39.3192,-120.3842], elev: 7040, aspect: 'N', snotel: ['428:CA:SNTL','Css Lab'], region: 'Donner Summit', nws: ['STO',86,94], url: 'https://www.skisodasprings.com'},
  {id: 'donner-ski-ranch', name: 'Donner Ski Ranch', short: 'Donner Ranch', at: [39.3178,-120.3304], elev: 7400, aspect: 'N', snotel: ['428:CA:SNTL','Css Lab'], region: 'Donner Summit', nws: ['STO',87,93], url: 'https://www.donnerskiranch.com'},
  {id: 'tahoe-donner', name: 'Tahoe Donner', short: 'Tahoe Donner', at: [39.351,-120.2632], elev: 7037, aspect: 'N', snotel: ['428:CA:SNTL','Css Lab'], region: 'Donner Summit', nws: ['REV',28,101], url: 'https://www.tahoedonner.com'},
  {id: 'heavenly', name: 'Heavenly', short: 'Heavenly', at: [38.9375,-119.9107], elev: 8303, aspect: 'N', snotel: ['518:CA:SNTL','Heavenly Valley'], region: 'South Lake', nws: ['REV',37,81], url: 'https://www.skiheavenly.com'},
  {id: 'sierra-at-tahoe', name: 'Sierra-at-Tahoe', short: 'Sierra', at: [38.7975,-120.0768], elev: 7748, aspect: 'N', snotel: ['463:CA:SNTL','Echo Peak'], region: 'South Lake', nws: ['STO',92,68], url: 'https://www.sierraattahoe.com'},
  {id: 'kirkwood', name: 'Kirkwood', short: 'Kirkwood', at: [38.679,-120.0674], elev: 8638, aspect: 'N', snotel: ['356:CA:SNTL','Blue Lakes'], region: 'South Lake', nws: ['STO',91,63], url: 'https://www.kirkwood.com'},
  {id: 'bear-valley', name: 'Bear Valley', short: 'Bear Valley', at: [38.4826,-120.0503], elev: 7562, aspect: 'NE', snotel: ['356:CA:SNTL','Blue Lakes'], region: 'Highways 4 & 108', nws: ['STO',90,54], url: 'https://www.bearvalley.com'},
  {id: 'dodge-ridge', name: 'Dodge Ridge', short: 'Dodge Ridge', at: [38.1899,-119.9393], elev: 7355, aspect: 'N', snotel: ['575:CA:SNTL','Leavitt Meadows'], region: 'Highways 4 & 108', nws: ['STO',92,41], url: 'https://www.dodgeridge.com'},
];

export const MAMMOTH_RESORTS = [
  {id: 'mammoth', name: 'Mammoth Mountain', short: 'Mammoth', at: [37.6444,-119.0094], elev: 9542, aspect: 'NE', snotel: null, region: 'Eastern Sierra', nws: ['REV',58,18], url: 'https://www.mammothmountain.com'},
  {id: 'june', name: 'June Mountain', short: 'June', at: [37.7537,-119.0757], elev: 8855, aspect: 'NE', snotel: ['846:CA:SNTL','Virginia Lakes Ridge'], region: 'Eastern Sierra', nws: ['REV',56,23], url: 'https://www.junemountain.com'},
];

export const SOCAL_RESORTS = [
  {id: 'bear-mountain', name: 'Bear Mountain', short: 'Bear Mtn', at: [34.2197,-116.8605], elev: 7967, aspect: 'N', snotel: null, region: 'Big Bear', nws: ['SGX',78,78], url: 'https://www.bigbearmountainresort.com'},
  {id: 'snow-summit', name: 'Snow Summit', short: 'Snow Summit', at: [34.2276,-116.8905], elev: 7572, aspect: 'N', snotel: null, region: 'Big Bear', nws: ['SGX',77,78], url: 'https://www.bigbearmountainresort.com'},
  {id: 'snow-valley', name: 'Snow Valley', short: 'Snow Valley', at: [34.2145,-117.0363], elev: 7279, aspect: 'N', snotel: null, region: 'Big Bear', nws: ['SGX',72,79], url: 'https://snow-valley.com'},
  {id: 'mountain-high', name: 'Mountain High', short: 'Mtn High', at: [34.3701,-117.6895], elev: 7385, aspect: 'N', snotel: null, region: 'San Gabriels', nws: ['LOX',177,55], url: 'https://www.mthigh.com'},
  {id: 'mt-baldy', name: 'Mt. Baldy', short: 'Baldy', at: [34.2724,-117.6102], elev: 7521, aspect: 'N', snotel: null, region: 'San Gabriels', nws: ['SGX',52,85], url: 'https://www.mtbaldyresort.com'},
];
