// Utah's resorts, set up like Colorado's (src/resorts.js; the same fields). Locations, mid-mountain
// elevations, Weather Service grids and the nearest SNOTEL station come from the all-states work
// (src/us-resorts.json); added here: region, which way the main terrain faces (approximate),
// and each resort's Ski Utah page (skiutah: www.skiutah.com/members/<skiutah>/snowreport), the
// status and snow report source (like Colorado Ski Country's feed). Park City is a Vail Resorts
// mountain: its own pages too (src/vail.js).
export const UT_RESORTS = [
  {id: 'alta', name: 'Alta', short: 'Alta', at: [40.5736,-111.6358], elev: 9546, aspect: 'N', snotel: ['766:UT:SNTL','Snowbird'], region: 'Cottonwoods', skiutah: 'alta', nws: ['SLC',108,166], url: 'https://www.alta.com'},
  {id: 'beaver-mountain', name: 'Beaver Mountain', short: 'Beaver Mtn', at: [41.9718,-111.5499], elev: 7957, aspect: 'N', snotel: ['484:ID:SNTL','Franklin Basin'], region: 'Northern Utah', skiutah: 'beaver-mountain', nws: ['SLC',119,229], url: 'https://www.skithebeav.com/'},
  {id: 'brian-head', name: 'Brian Head', short: 'Brian Head', at: [37.6897,-112.8463], elev: 10258, aspect: 'N', snotel: ['390:UT:SNTL','Castle Valley'], region: 'Southern Utah', skiutah: 'brian-head', nws: ['SLC',49,42], url: 'https://www.brianhead.com'},
  {id: 'brighton', name: 'Brighton', short: 'Brighton', at: [40.5946,-111.5821], elev: 9598, aspect: 'N', snotel: ['366:UT:SNTL','Brighton'], region: 'Cottonwoods', skiutah: 'brighton', nws: ['SLC',110,167], url: 'https://brightonresort.com/'},
  {id: 'cherry-peak', name: 'Cherry Peak', short: 'Cherry Peak', at: [41.9253,-111.754], elev: 6390, aspect: 'N', snotel: ['823:UT:SNTL','Tony Grove Lake'], region: 'Northern Utah', skiutah: 'cherry', nws: ['SLC',112,228], url: 'https://www.skicpr.com/'},
  {id: 'deer-valley', name: 'Deer Valley', short: 'Deer Valley', at: [40.6278,-111.4829], elev: 7998, aspect: 'N', snotel: ['814:UT:SNTL','Thaynes Canyon'], region: 'Park City', skiutah: 'deer-valley', nws: ['SLC',114,168], url: 'https://www.deervalley.com/'},
  {id: 'eagle-point', name: 'Eagle Point', short: 'Eagle Point', at: [38.3222,-112.378], elev: 9950, aspect: 'N', snotel: ['339:UT:SNTL','Big Flat'], region: 'Southern Utah', skiutah: 'eagle-point', nws: ['SLC',70,68], url: 'https://www.eaglepointresort.com/'},
  {id: 'nordic-valley', name: 'Nordic Valley', short: 'Nordic Valley', at: [41.3064,-111.8666], elev: 6204, aspect: 'N', snotel: ['333:UT:SNTL','Ben Lomond Trail'], region: 'Ogden Valley', skiutah: 'nordic-valley', nws: ['SLC',104,200], url: 'https://nordicvalley.ski/'},
  {id: 'park-city', name: 'Park City', short: 'Park City', at: [40.6567,-111.5377], elev: 8435, aspect: 'NE', snotel: ['814:UT:SNTL','Thaynes Canyon'], region: 'Park City', skiutah: 'park-city-mountain', nws: ['SLC',112,169], url: 'https://parkcitymountain.com/'},
  {id: 'powder-mountain', name: 'Powder Mountain', short: 'Powder Mtn', at: [41.3758,-111.7621], elev: 7820, aspect: 'NE', snotel: ['582:UT:SNTL','Little Bear'], region: 'Ogden Valley', skiutah: 'powder-mountain', nws: ['SLC',108,203], url: 'https://powdermountain.com/'},
  {id: 'snowbasin', name: 'Snowbasin', short: 'Snowbasin', at: [41.201,-111.8629], elev: 7831, aspect: 'E', snotel: ['332:UT:SNTL','Ben Lomond Peak'], region: 'Ogden Valley', skiutah: 'snowbasin', nws: ['SLC',104,195], url: 'https://www.snowbasin.com/'},
  {id: 'snowbird', name: 'Snowbird', short: 'Snowbird', at: [40.5718,-111.6412], elev: 9358, aspect: 'N', snotel: ['766:UT:SNTL','Snowbird'], region: 'Cottonwoods', skiutah: 'snowbird', nws: ['SLC',108,166], url: 'https://www.snowbird.com/'},
  {id: 'solitude', name: 'Solitude', short: 'Solitude', at: [40.6149,-111.601], elev: 9006, aspect: 'N', snotel: ['366:UT:SNTL','Brighton'], region: 'Cottonwoods', skiutah: 'solitude', nws: ['SLC',109,168], url: 'https://solitudemountain.com/'},
  {id: 'sundance', name: 'Sundance', short: 'Sundance', at: [40.381,-111.5894], elev: 7172, aspect: 'E', snotel: ['820:UT:SNTL','Timpanogos Divide'], region: 'Provo', skiutah: 'sundance', nws: ['SLC',109,157], url: 'https://www.sundanceresort.com/'},
  {id: 'woodward-park-city', name: 'Woodward', short: 'Woodward PC', at: [40.752,-111.5843], elev: 6622, aspect: 'N', snotel: ['684:UT:SNTL','Parleys Summit'], region: 'Park City', skiutah: 'woodward-park-city', nws: ['SLC',111,174], url: 'https://www.woodwardparkcity.com/'},
];
