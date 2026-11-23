// Ski Utah's snow report (www.skiutah.com/snowreport; its robots.txt allows it): Utah's counterpart to
// Colorado Ski Country's feed. One list of every member resort with, before it opens, its opening
// date ("Opening Nov 20", "Opening Day TBA", "Closed For 2026-27 Season") and, once open, its 24-hour
// snow and base. Each resort's own page there is www.skiutah.com/members/<slug>/snowreport.
export const SKI_UTAH = 'https://www.skiutah.com/snowreport';
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// → Map slug → { open: bool, date?: 'YYYY-MM-DD', tba?: true, closedSeason?: true, new24?, depth? }.
// `season`: { startYear } for turning "Nov 20" into a date (Oct–Dec: the start year; Jan–Jun: after).
export function parseSkiUtah(html, season) {
  const out = new Map();
  const list = html.slice(html.indexOf('resort-totals'), html.indexOf('resort-totals') + 40000);
  for (const li of list.split('<li class="row"').slice(1)) {
    const slug = /members\/([a-z0-9-]+)\/snowreport/.exec(li)?.[1];
    if (!slug) continue;
    const cols = [...li.matchAll(/<div class="col[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => text(m[1])).filter(Boolean).slice(1);
    const all = cols.join(' ');
    const e = { open: false };
    const opening = /Opening (\w{3})\w* (\d{1,2})/i.exec(all);
    if (/closed for/i.test(all)) e.closedSeason = true;
    else if (/TBA/i.test(all)) e.tba = true;
    else if (opening && MONTHS[opening[1].toLowerCase()]) {
      const m = MONTHS[opening[1].toLowerCase()];
      e.date = `${m >= 8 ? season.startYear : season.startYear + 1}-${String(m).padStart(2, '0')}-${opening[2].padStart(2, '0')}`;
    } else {
      // Open: the numbers in the row (24-hour snow first, then base), however they're labeled.
      const nums = [...all.matchAll(/(\d+(?:\.\d+)?)\s*(?:"|″|in)/g)].map((m) => Number(m[1]));
      if (nums.length) Object.assign(e, { open: true, new24: nums[0], depth: nums[1] ?? null });
      else if (/open/i.test(all)) e.open = true;
    }
    out.set(slug, e);
  }
  return out;
}

// One resort's own page there (www.skiutah.com/members/<slug>/snowreport): when it was updated, and
// its 24 and 48 hours, last 7 days, base and season so far, which the list leaves out. → a report
// like the others (src/vail.js parseVailSnow), or null.
export const skiUtahResortUrl = (slug) => `https://www.skiutah.com/members/${slug}/snowreport`;
export function parseSkiUtahResort(html) {
  // (The snow report's own time: the last one before its figures; the page has others, for roads.)
  const at = html.indexOf('Past 24 HR');
  const updated = at < 0 ? null : [...html.slice(0, at).matchAll(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2}:\d{2})/g)].map((m) => m[1] + m[2]).at(-1) ?? null; // (fractions of a second, sometimes)
  const flat = text(html);
  const inches = (label) => {
    const m = new RegExp(`${label}\\s*(\\d+(?:\\.\\d+)?)\\s*(?:"|″|”|in)`, 'i').exec(flat.replace(/&rdquo;/g, '”'));
    return m ? Number(m[1]) : null;
  };
  const new24 = inches('Past 24 HR');
  if (new24 == null && !updated) return null;
  return {
    new24,
    new48: inches('Past 48 HR'),
    new7d: inches('last 7 days'),
    depth: inches('base depth'),
    seasonTotal: inches('year to date'),
    surface: null,
    updated: updated ? new Date(updated.replace(' ', 'T')).toISOString() : null,
    message: null,
  };
}
