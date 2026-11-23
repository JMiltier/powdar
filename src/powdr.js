// Powdr's resorts (Copper, Eldora; Boreal in Tahoe) publish their snow report through the same API as
// their lifts and runs: each morning's report, with 24-hour, 48-hour, 72-hour, 7-day and season
// totals worked out, the base depth and when it was posted. Colorado Ski Country's feed passes on only
// the 24 and 48 hours.
export const powdrSnowUrl = (host) => `https://${host}/api/v1/dor/drupal/snow-reports`;

// The newest report → a report like the others (src/vail.js parseVailSnow), or null.
export function parsePowdrSnow(rows) {
  const r = [...(Array.isArray(rows) ? rows : [])].filter((x) => x?.computed).sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))[0];
  if (!r) return null;
  const cm = /cm/i.test(r.unit_of_measurement ?? '');
  const v = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round((cm ? x / 2.54 : x) * 10) / 10 : null);
  const c = r.computed;
  return {
    depth: v(r.base_depth),
    new24: v(c['24_hour']),
    new48: v(c['48_hour']),
    new72: v(c['72_hour']),
    new7d: v(c['7_day']),
    seasonTotal: v(c.total),
    surface: null,
    updated: r.updated ? new Date(r.updated * 1000).toISOString() : null,
    message: null,
  };
}
