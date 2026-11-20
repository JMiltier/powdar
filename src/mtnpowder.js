// Alterra's resorts publish their full mountain report on MtnPowder (the platform behind their own
// pages): new snow over 24/48/72 hours and 7 days at each measuring spot, base depth, season total,
// open trails and terrain. Palisades Tahoe, Alpine Meadows, Mammoth and June (Steamboat, Winter Park
// and A-Basin's lifts come from the same platform: src/lifts.js).

export const mtnpowderUrl = (id) => `https://mtnpowder.com/feed?resortId=${id}`;

// '22' → 22; '--', '' → null.
const num = (v) => {
  const n = Number(String(v ?? '').trim());
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
};

// The feed → a report like the others (src/vail.js parseVailSnow): mid-mountain's figures where it has
// them (what resorts usually quote), else the base area's, else the summit's. stations: other
// measuring spots to read instead, for a mountain that shares its feed (Alpine Meadows' are Station5,
// its mid-mountain, and Station4, its base, in Palisades'); then the resort-wide figures (season total,
// runs) are left out, as they're the other mountain's.
export function parseMtnPowderSnow(feed, stations = null) {
  const sr = feed?.SnowReport;
  if (!sr) return null;
  const spots = (stations ? stations.map((k) => sr[k]) : [sr.MidMountainArea, sr.BaseArea, sr.SummitArea]).filter(Boolean);
  const pick = (k) => spots.map((s) => num(s[k])).find((v) => v != null) ?? null;
  // "25 - 35" (base range): its middle, when no spot gives a depth.
  const range = String(sr.SnowBaseRangeIn ?? '').match(/(\d+)\s*-\s*(\d+)/);
  const depth = pick('BaseIn') || (range && !stations ? Math.round((Number(range[1]) + Number(range[2])) / 2) : null);
  // "2026-11-19T13:25:39-0800" (no colon in the offset).
  const updated = sr.LastUpdate ? new Date(String(sr.LastUpdate).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) : null;
  const trails = !stations && num(sr.TotalTrails) ? { open: num(sr.TotalOpenTrails) ?? 0, total: num(sr.TotalTrails) } : undefined;
  return {
    depth,
    new24: pick('Last24HoursIn'),
    new48: pick('Last48HoursIn'),
    new72: pick('Last72HoursIn'),
    new7d: pick('Last7DaysIn'),
    seasonTotal: stations ? null : num(sr.SeasonTotalIn),
    surface: sr.BaseConditions && sr.BaseConditions !== '--' ? sr.BaseConditions : null,
    updated: updated && !Number.isNaN(updated.getTime()) ? updated.toISOString() : null,
    ...(trails ? { trails } : {}),
    message: null,
  };
}
