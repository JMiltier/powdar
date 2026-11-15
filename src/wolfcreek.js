// Wolf Creek's own snow report (wolfcreekski.com, which allows reading it): not in Colorado Ski
// Country's feed, not a Vail Resorts mountain, so without this its numbers were only model guesses.
// The full report lists label/value pairs ("24 hours" → 5", "Percentage Open" → 54.5 %, …) and when
// the ski patrol last updated it.
export const WOLF_CREEK_REPORT = 'https://wolfcreekski.com/wcs-snow-report/';

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&deg;/g, '°').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const inches = (v) => { const m = /-?\d+(\.\d+)?/.exec(v ?? ''); return m ? Number(m[0]) : null; };

// → { new24, new48, new72, new7d, storm, seasonTotal, depth, summitDepth, surface, openPct, lifts,
//     updated (YYYY-MM-DD), source } or null if the page isn't the report.
export function parseWolfCreek(html) {
  const pairs = new Map();
  const re = /snow-report-left-text"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*snow-report-right-text[^>]*>([\s\S]*?)<\/div>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) pairs.set(text(m[1]).toLowerCase(), text(m[2]));
  if (!pairs.has('24 hours')) return null;
  const upd = /Updated:[\s\S]*?<span[^>]*>([^<]+)<\/span>/.exec(html);
  const when = upd ? new Date(`${upd[1].split(' - ')[0]} 12:00 UTC`) : null;
  const surface = pairs.get('surface conditions');
  return {
    new24: inches(pairs.get('24 hours')),
    new48: inches(pairs.get('48 hours')),
    new72: inches(pairs.get('72 hours')),
    new7d: inches(pairs.get('7 days')),
    storm: inches(pairs.get('latest storm')),
    seasonTotal: inches(pairs.get('snowfall ytd')),
    depth: inches(pairs.get('midway snow depth')),
    summitDepth: inches(pairs.get('summit snow depth')),
    // (The first sentence: "Powder/Packed Powder with excellent early season conditions …")
    surface: surface ? surface.split(/ with |[.;]/)[0].trim() : null,
    openPct: inches(pairs.get('percentage open')),
    lifts: inches(pairs.get('number of lifts')),
    updated: when && !Number.isNaN(when.getTime()) ? when.toISOString().slice(0, 10) : null,
    source: WOLF_CREEK_REPORT,
  };
}
