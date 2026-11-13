// Live lift-by-lift status straight from each resort's own lift-status data, refreshed with every
// update. Endpoints follow Liftie (github.com/pirxpilot/liftie, BSD-3), which tracks these feeds.
// Vail Resorts mountains block automated requests, so they're not included.

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

// MtnPowder (Alterra's reporting platform): A-Basin, Steamboat, Winter Park.
const mtnpowder = (id, page) => ({
  url: `https://mtnpowder.com/feed/${id}/lifts`,
  page,
  type: 'json',
  parse: (rows) => rows.map((l) => {
    const day = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Denver' });
    const h = l.Hours?.[day];
    return { name: l.Name.replace(/ Lift$/, ''), status: liftStatus(l.StatusEnglish), hours: h?.Open ? `${h.Open}–${h.Close}` : null, updated: l.UpdateDate };
  }),
});

// Powdr's API: Copper, Eldora.
const powdr = (host, page) => ({
  url: `https://${host}/api/v1/dor/drupal/lifts`,
  page,
  type: 'json',
  parse: (rows) => rows.filter((l) => l.season !== 'summer').map((l) => ({
    name: l.name, status: liftStatus(l.status), hours: l.hours || null, updated: l.updated ? new Date(l.updated * 1000).toISOString() : null,
  })),
});

// Aspen Snowmass's lift feed, one per mountain.
const aspen = (mountain, page) => ({
  url: `https://www.aspensnowmass.com/aspensnowmass/liftstatus/feed?mountain=${mountain}`,
  page,
  type: 'json',
  parse: (data) => (data.liftStatuses ?? []).map((l) => ({ name: l.liftName, status: liftStatus(l.status), hours: hoursText(l.hoursOfOperation) })),
});

export const LIFT_SOURCES = {
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

// One resort's lifts → { open, hold, scheduled, total, lifts, page, checked }.
export function summarizeLifts(lifts, page, checked) {
  const count = (s) => lifts.filter((l) => l.status === s).length;
  const times = lifts.map((l) => l.updated).filter(Boolean).sort();
  return {
    open: count('open'), hold: count('hold'), scheduled: count('scheduled'), total: lifts.length,
    lifts: lifts.map(({ name, status, hours }) => ({ name, status, hours })),
    page,
    // The resort's own last-change time when the feed has one; otherwise when we checked.
    updated: times.at(-1) ?? null,
    checked,
  };
}
