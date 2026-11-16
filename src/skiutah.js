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
