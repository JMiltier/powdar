// Live lift-by-lift status straight from each resort's own lift-status data, refreshed with every
// update. Endpoints follow Liftie (github.com/pirxpilot/liftie, BSD-3), which tracks these feeds.
// Vail Resorts mountains block automated requests, so they're not included.
import { ALTA_PAGE, MTROSE_PAGE, SUGARBOWL_PAGE, altaData } from './pages.js';

// Normalise the many ways resorts say it into: open, hold, scheduled, closed.
export function liftStatus(text = '') {
  const t = String(text).toLowerCase();
  if (/hold|delay|wind/.test(t)) return 'hold';
  if (/sched|expected|anticipated|opening/.test(t)) return 'scheduled';
  if (/^open|_open|\bopen\b|operating|running/.test(t) && !/closed/.test(t)) return 'open';
  return 'closed';
}

const decode = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&').replace(/&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();
// Hours only when they say something ("0:00 - 0:00" and "CLOSED" don't).
const hoursText = (h) => (h && /\d/.test(h) && !/^0:00\s*-\s*0:00$/.test(h.trim()) ? h.trim() : null);

// Runs: each open one as { name, level, groomed, area }, level one of green, blue, black, double, park
// (null when the resort doesn't say). Only open runs are kept: what the app lists.
export const run = (name, level, groomed, area) => ({ name: decode(String(name)), level: level ?? null, ...(groomed ? { groomed: true } : {}), ...(area ? { area: decode(String(area)) } : {}) });
const MTNPOWDER_LEVEL = { GreenCircle: 'green', BlueSquare: 'blue', BlueBlackSquare: 'blue', BlackDiamond: 'black', DoubleBlackDiamond: 'double', ExtremeTerrain: 'double', Park: 'park', TerrainPark: 'park', Halfpipe: 'park' };
const POWDR_LEVEL = { easiest: 'green', more_difficult: 'blue', most_difficult: 'black', extreme: 'double', extreme_terrain: 'double' };

// MtnPowder (Alterra's reporting platform): A-Basin, Steamboat, Winter Park; Palisades, Alpine, Mammoth, June.
const mtnpowder = (id, page) => ({
  url: `https://mtnpowder.com/feed/${id}/lifts`,
  page,
  type: 'json',
  parse: (rows) => rows.map((l) => {
    const day = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Denver' });
    const h = l.Hours?.[day];
    return { name: l.Name.replace(/ Lift$/, ''), status: liftStatus(l.StatusEnglish), hours: h?.Open ? `${h.Open}–${h.Close}` : null, updated: l.UpdateDate };
  }),
  // (The runs are in the resort's full feed.)
  runs: {
    url: `https://mtnpowder.com/feed?resortId=${id}`,
    type: 'json',
    parse: (feed) => (feed.MountainAreas ?? []).flatMap((a) => (a.Trails ?? []).filter((t) => liftStatus(t.StatusEnglish) === 'open' && t.Nordic !== 'Yes' && t.TrailIcon !== 'UphillArrow') // (uphill routes aren't runs)
      .map((t) => run(t.Name, MTNPOWDER_LEVEL[t.TrailIcon] ?? (/park/i.test(t.TerrainParkOnRun) ? 'park' : null), t.Grooming === 'Yes', a.Name))),
  },
});

// Powdr's API: Copper, Eldora.
const powdr = (host, page) => ({
  url: `https://${host}/api/v1/dor/drupal/lifts`,
  page,
  type: 'json',
  parse: (rows) => rows.filter((l) => l.season !== 'summer').map((l) => ({
    name: l.name, status: liftStatus(l.status), hours: l.hours || null, updated: l.updated ? new Date(l.updated * 1000).toISOString() : null,
  })),
  runs: {
    url: `https://${host}/api/v1/dor/drupal/trails`,
    type: 'json',
    parse: (rows) => rows.filter((t) => t.status === 'open' && t.season !== 'summer' && t.include !== false && ['alpine_trail', 'terrain_park_trail'].includes(t.type))
      .map((t) => run(t.name, t.type === 'terrain_park_trail' ? 'park' : POWDR_LEVEL[t.difficulty], t.groom_status === 'groomed', t.sector?.name)),
  },
});

// Boyne's feed (Brighton): lifts, and runs with difficulty and grooming.
const BOYNE = 'https://apim-marketing-001.azure-api.net/FeedService/v1/Feed/Facilities/Areas';
const BOYNE_LEVEL = { beginner: 'green', intermediate: 'blue', advanced: 'black', expert: 'double', 'terrain-park': 'park', park: 'park' };
const boyne = (code, page) => ({
  url: `${BOYNE}/Lifts/All?resortName=${code}`,
  page,
  type: 'json',
  parse: (rows) => rows.map((l) => ({ name: l.name, status: liftStatus(l.status), hours: l.openTime && l.closeTime ? `${l.openTime}–${l.closeTime}` : null })),
  runs: {
    url: `${BOYNE}/Trails/All?resortName=${code}`,
    type: 'json',
    parse: (rows) => rows.filter((t) => liftStatus(t.status) === 'open' && !t.uphill)
      .map((t) => run(t.name, BOYNE_LEVEL[t.difficultyIcon] ?? null, t.groomed === true, t.area)),
  },
});

// Aspen Snowmass's lift feed, one per mountain.
const aspen = (mountain, page) => ({
  url: `https://www.aspensnowmass.com/aspensnowmass/liftstatus/feed?mountain=${mountain}`,
  page,
  type: 'json',
  parse: (data) => (data.liftStatuses ?? []).map((l) => ({ name: l.liftName, status: liftStatus(l.status), hours: hoursText(l.hoursOfOperation) })),
});

export const LIFT_SOURCES = {
  // California (src/resorts-ca.js)
  palisades: mtnpowder(61, 'https://www.palisadestahoe.com/mountain-information/lift-and-grooming-status'),
  'alpine-meadows': mtnpowder(62, 'https://www.palisadestahoe.com/mountain-information/lift-and-grooming-status#tab=alpine-meadows-'),
  'mammoth-mountain': mtnpowder(60, 'https://www.mammothmountain.com/on-the-mountain/mountain-report#lifts-and-trails'),
  june: mtnpowder(59, 'https://www.junemountain.com/mountain-information/mountain-report#/'),
  boreal: powdr('api.rideboreal.com', 'https://www.rideboreal.com/the-mountain/the-mountain/trail-lift-info/full-trail-report'),
  // Utah (src/resorts-ut.js)
  snowbird: powdr('api.snowbird.com', 'https://www.snowbird.com/the-mountain/mountain-report/lift-trail-report/'),
  solitude: mtnpowder(65, 'https://www.solitudemountain.com/mountain-and-village/conditions-and-maps#/'),
  'deer-valley': mtnpowder(49, 'https://www.deervalley.com/explore-the-mountain/mountain-report#/lifts'),
  brighton: boyne('br', 'https://brightonresort.com/conditions'),
  // Southern California: Big Bear's two mountains.
  'bear-mountain': mtnpowder(57, 'https://www.bigbearmountainresort.com/mountain-information/mountain-report'),
  'snow-summit': mtnpowder(58, 'https://www.bigbearmountainresort.com/mountain-information/mountain-report'),
  'arapahoe-basin': mtnpowder(93, 'https://www.arapahoebasin.com/snow-report/#lift-and-trail-status'),
  steamboat: mtnpowder(6, 'https://www.steamboat.com/the-mountain/mountain-report#/lifts'),
  'winter-park': mtnpowder(5, 'https://www.winterparkresort.com/the-mountain/weather-dashboard#mountain-status'),
  'copper-mountain': powdr('api.coppercolorado.com', 'https://www.coppercolorado.com/the-mountain/trail-lift-info/winter-trail-report'),
  eldora: powdr('api.eldora.com', 'https://www.eldora.com/the-mountain/trail-lift-info/winter-trail-report'),
  'aspen-mountain': aspen('AspenMountain', 'https://www.aspensnowmass.com/our-mountains/aspen-mountain/lift-status'),
  'aspen-highlands': aspen('AspenHighlands', 'https://www.aspensnowmass.com/our-mountains/aspen-highlands/lift-status'),
  buttermilk: aspen('Buttermilk', 'https://www.aspensnowmass.com/our-mountains/buttermilk/lift-status'),
  snowmass: aspen('Snowmass', 'https://www.aspensnowmass.com/our-mountains/snowmass/lift-status'),
  // These three publish lift status only on their web pages (plain tables).
  loveland: {
    url: 'https://skiloveland.com/trail-lift-report/',
    page: 'https://skiloveland.com/trail-lift-report/',
    type: 'html',
    parse: (html) => [...html.matchAll(/tablepress-table-name[^>]*>([^<]+)</g)]
      .map((m) => decode(m[1]))
      .filter((t) => / - /.test(t))
      .map((t) => {
        const i = t.lastIndexOf(' - ');
        return { name: t.slice(0, i).replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase()), status: liftStatus(t.slice(i + 3)), hours: null };
      }),
    // Each lift's table lists its runs: difficulty icon, status icon, name, grooming icon, area.
    runs: {
      parse: (html) => [...html.matchAll(/<tr class="row-\d+">\s*<td class="column-1">([\s\S]*?)<\/td><td class="column-2">([\s\S]*?)<\/td><td class="column-3">([\s\S]*?)<\/td><td class="column-4">([\s\S]*?)<\/td><td class="column-5">([\s\S]*?)<\/td>/g)]
        .filter((m) => /icon_open/i.test(m[2]) && decode(m[3]))
        .map((m) => run(decode(m[3]), { beginner: 'green', more_difficult: 'blue', most_difficult: 'black', expert: 'double', terrainpark: 'park' }[/icon_([a-z_]+)\.png/i.exec(m[1])?.[1]?.toLowerCase()] ?? null, /groom/i.test(m[4]), decode(m[5])))
        .filter((r, i, all) => all.findIndex((x) => x.name === r.name) === i), // (a run under two lifts once)
    },
  },
  monarch: {
    url: 'https://skimonarch.com/conditions/',
    page: 'https://skimonarch.com/conditions/',
    type: 'html',
    parse: (html) => {
      const table = html.match(/<table class="lifts-table">([\s\S]*?)<\/table>/)?.[1] ?? '';
      return [...table.matchAll(/<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map((m) => ({ name: decode(m[1]).replace(/\s+\(.+\)$/, ''), status: liftStatus(decode(m[2])), hours: null }));
    },
    // Its trail tables: name, difficulty (a colored shape), groomed, status.
    runs: {
      parse: (html) => [...html.matchAll(/<table class="trails-table"[\s\S]*?<\/table>/g)].flatMap((t) => [...t[0].matchAll(/<tr>\s*<td data-label="Trail">([\s\S]*?)<\/td>\s*<td[^>]*data-label="Difficulty">([\s\S]*?)<\/td>\s*<td[^>]*data-label="Groomed">([\s\S]*?)<\/td>\s*<td[^>]*data-label="Status">([\s\S]*?)<\/td>/g)])
        .filter((m) => liftStatus(decode(m[4])) === 'open')
        .map((m) => {
          const shape = m[2];
          // (Green circle, blue square, black diamond, two diamonds; an oval for a terrain park.)
          const level = /<circle/i.test(shape) ? 'green' : /<rect/i.test(shape) ? 'blue' : /<ellipse/i.test(shape) ? 'park'
            : (shape.match(/<polygon|<path/g) ?? []).length >= 2 ? 'double' : /<polygon|<path/.test(shape) ? 'black' : null;
          return run(decode(m[1]), level, /\S/.test(decode(m[3])) || /<svg|<img|✓|✔/.test(m[3]), null);
        }),
    },
  },
  telluride: {
    url: 'https://tellurideskiresort.com/snow-report',
    page: 'https://tellurideskiresort.com/snow-report',
    type: 'html',
    parse: (html) => {
      const table = html.match(/<table id="tsr-report-app-lift-table">([\s\S]*?)<\/table>/)?.[1] ?? '';
      return [...table.matchAll(/<tr>\s*<td>\s*<span class="tsr-report-app-icon-([a-z-]+)"[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>/g)]
        .map((m) => ({ name: decode(m[2]), status: liftStatus(m[1]), hours: hoursText(decode(m[3])) }));
    },
  },
};

// Pages without a feed. Alta: the data its page is built from (lifts, each with its runs).
LIFT_SOURCES.alta = {
  url: ALTA_PAGE,
  page: ALTA_PAGE,
  type: 'html',
  parse: (html) => (altaData(html)?.liftStatus?.lifts ?? []).map((l) => ({
    name: l.name, status: l.open ? 'open' : 'closed', hours: l.opening_at_formatted && l.closing_at_formatted ? `${l.opening_at_formatted}–${l.closing_at_formatted}` : null,
  })),
  runs: {
    parse: (html) => (altaData(html)?.liftStatus?.lifts ?? []).flatMap((l) => l.runs ?? []).filter((r) => r.open)
      .filter((r, i, all) => all.findIndex((x) => x.name === r.name) === i)
      .map((r) => run(r.name, { green: 'green', blue: 'blue', black: 'black', double_black: 'double', 'double-black': 'double' }[r.difficulty] ?? null, r.groomed === true, null)),
  },
};
// Mt. Rose: its report page's lift table (name, then a colored status word).
LIFT_SOURCES['mt-rose'] = {
  url: MTROSE_PAGE,
  page: MTROSE_PAGE,
  type: 'html',
  parse: (html) => {
    const block = html.slice(html.indexOf('id="lift-status"'), html.indexOf('id="lift-status"') + 40000);
    return [...block.matchAll(/<div class="rose-name">([\s\S]*?)<\/div>[\s\S]*?<div class="column column-status">([\s\S]*?)<\/div>/g)]
      .map((m) => ({ name: decode(m[1]), status: liftStatus(decode(m[2])), hours: null }));
  },
};
// Sugar Bowl: each lift's block on its conditions page (name, then status).
LIFT_SOURCES['sugar-bowl'] = {
  url: SUGARBOWL_PAGE,
  page: SUGARBOWL_PAGE,
  type: 'html',
  parse: (html) => [...html.matchAll(/lift_status_top">\s*<div>\s*<div class="fw_semi_bold">([^<]+)<\/div>[\s\S]*?_status_text">([^<]*)</g)]
    .map((m) => ({ name: decode(m[1]), status: liftStatus(m[2]), hours: null })),
};
// Soda Springs: Powdr's API, like Boreal.
LIFT_SOURCES['soda-springs'] = powdr('api.skisodasprings.com', 'https://www.skisodasprings.com/the-mountain/trail-lift-info');

// Readers for the JSON feed types Liftie uses, so any resort with one of these can be read.
export function feedReader({ tool, url, page }) {
  if (tool === 'intrawest') return { ...mtnpowder(0, page), url };
  if (tool === 'powdr') return { ...powdr(new URL(url).host, page), url };
  if (tool === 'aspen') return { ...aspen(new URL(url).searchParams.get('mountain'), page), url };
  return null;
}

// One resort's lifts → { open, hold, scheduled, total, lifts, page, checked }.
export function summarizeLifts(lifts, page, checked, runs = null) {
  const count = (s) => lifts.filter((l) => l.status === s).length;
  const times = lifts.map((l) => l.updated).filter(Boolean).sort();
  return {
    open: count('open'), hold: count('hold'), scheduled: count('scheduled'), total: lifts.length,
    lifts: lifts.map(({ name, status, hours, closes }) => ({ name, status, hours, ...(closes ? { closes } : {}) })),
    // The open runs by name, where the resort lists them (see run).
    ...(runs ? { runList: runs } : {}),
    page,
    // The resort's own last-change time when the feed has one; otherwise when we checked.
    updated: times.at(-1) ?? null,
    checked,
  };
}
