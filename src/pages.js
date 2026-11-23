// Snow reports read from a resort's own page, for resorts with no feed: Alta (the data its page is
// built from, window.Alta) and Mt. Rose (its report block). Each → a report like the others
// (src/vail.js parseVailSnow), or null. Lifts and runs from the same pages: src/lifts.js.

// "2026-11-23 12:05:06" in a time zone → ISO.
export function zonedIso(local, tz) {
  const t = Date.parse(`${local.replace(' ', 'T')}Z`);
  if (!Number.isFinite(t)) return null;
  const asZone = new Date(new Date(t).toLocaleString('en-US', { timeZone: tz })).getTime();
  const asUtc = new Date(new Date(t).toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return new Date(t - (asZone - asUtc)).toISOString();
}

export const ALTA_PAGE = 'https://www.alta.com/lift-terrain-status';
export function altaData(html) {
  const at = html.indexOf('window.Alta = ');
  if (at < 0) return null;
  const end = html.indexOf('</script>', at);
  try {
    return JSON.parse(html.slice(at + 'window.Alta = '.length, end).trim().replace(/;\s*$/, ''));
  } catch {
    return null;
  }
}
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
export function parseAltaSnow(html) {
  const c = altaData(html)?.conditions;
  if (!c) return null;
  return {
    depth: num(c.base_depth),
    new24: num(c.last24),
    new48: null,
    seasonTotal: num(c.year_to_date),
    stormTotal: num(c.storm_total),
    surface: null,
    // (Its time is Alta's own, Mountain time.)
    updated: c.dated_at ? zonedIso(c.dated_at, 'America/Denver') : null,
    message: null,
  };
}

export const MTROSE_PAGE = 'https://skirose.com/snow-report/';
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&quot;|&#8221;|&rdquo;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
// "28"-40"": the middle of a range; "-": nothing reported.
const middle = (s) => {
  const n = [...String(s).matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  return n.length ? Math.round(n.reduce((a, b) => a + b, 0) / n.length) : null;
};
export function parseMtRoseSnow(html) {
  const stats = Object.fromEntries([...html.matchAll(/<h2 class="stat">([\s\S]*?)<\/h2>\s*<p class="subtitle">([\s\S]*?)<\/p>/g)].map((m) => [text(m[2]), text(m[1])]));
  const when = /Updated:\s*([A-Z][a-z]+ \d{1,2}, \d{4} \d{1,2}:\d{2} [ap]m)/i.exec(text(html))?.[1];
  if (!Object.keys(stats).length) return null;
  let updated = null;
  if (when) {
    const d = new Date(`${when.replace(/ ([ap]m)$/i, ' $1')} UTC`);
    if (Number.isFinite(d.getTime())) updated = zonedIso(d.toISOString().slice(0, 19).replace('T', ' '), 'America/Los_Angeles');
  }
  return {
    depth: middle(stats['Base Depth'] ?? ''),
    new24: /\d/.test(stats['New Snow'] ?? '') ? middle(stats['New Snow']) : null,
    new48: null,
    seasonTotal: middle(stats['Season Total'] ?? ''),
    stormTotal: /\d/.test(stats['Storm Total'] ?? '') ? middle(stats['Storm Total']) : null,
    surface: null,
    updated,
    message: null,
  };
}

// Sugar Bowl: its conditions page's header block ("36" Base Depth · 109" Year to Date · 0" 24 Hour ·
// 61" 7-Day"), no time given.
export const SUGARBOWL_PAGE = 'https://www.sugarbowl.com/conditions';
export function parseSugarBowlSnow(html) {
  const flat = text(html);
  const v = (label) => {
    const m = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*"\\s*${label}`).exec(flat);
    return m ? Number(m[1]) : null;
  };
  const out = { depth: v('Base Depth'), new24: v('24 Hour'), new48: null, new7d: v('7-Day'), seasonTotal: v('Year to Date'), surface: null, updated: null, message: null };
  return out.depth == null && out.new24 == null ? null : out;
}
