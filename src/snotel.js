// NRCS SNOTEL: automated snow stations reporting daily snowpack (snow water equivalent, inches of
// water) and snow depth, with the 1991–2020 median for every calendar day. Free, no key.
export const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data';

const DAY_MS = 86_400_000;
// Below this much water in the normal snowpack, "% of normal" swings wildly, so we don't show it.
const MIN_NORMAL_FOR_PCT = 0.5;

const dayNum = (ymd) => Date.parse(`${ymd}T12:00:00Z`) / DAY_MS;

// Snowpack seasons ("water years") run Oct 1 – Sep 30.
export function waterYear(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  const start = m >= 10 ? y : y - 1;
  return { start: `${start}-10-01`, startYear: start };
}

export function snotelUrl(triplets, begin, end) {
  const q = new URLSearchParams({
    stationTriplets: triplets.join(','),
    elements: 'WTEQ,SNWD',
    duration: 'DAILY',
    beginDate: begin,
    endDate: end,
    centralTendencyType: 'MEDIAN',
    periodRef: 'END',
  });
  return `${AWDB}?${q}`;
}

// → Map(triplet → { swe: [{date, value, median}], depth: [{date, value}] })
export function parseSnotel(json) {
  const out = new Map();
  for (const station of json ?? []) {
    const entry = { swe: [], depth: [] };
    for (const series of station.data ?? []) {
      const code = series.stationElement?.elementCode;
      if (code === 'WTEQ') entry.swe = series.values ?? [];
      if (code === 'SNWD') entry.depth = series.values ?? [];
    }
    out.set(station.stationTriplet, entry);
  }
  return out;
}

// One station's season so far against normal. `normals` comes from last season's request:
// medians are by calendar day, and the API only returns them for dates that have passed.
export function stationSeason({ current, normals, today }) {
  const { start, startYear } = waterYear(today);
  const day0 = dayNum(start);
  // Last season's dates → the same calendar day this season.
  const thisSeason = (ymd) => {
    const md = ymd.slice(5);
    return `${md >= '10-01' ? startYear : startYear + 1}-${md}`;
  };
  const normal = [];
  let peak = null;
  for (const v of normals?.swe ?? []) {
    if (v.median == null) continue;
    const date = thisSeason(v.date);
    normal.push([dayNum(date) - day0, v.median]);
    if (!peak || v.median > peak.swe) peak = { swe: v.median, date };
  }
  normal.sort((a, b) => a[0] - b[0]);

  const season = [];
  let latest = null;
  for (const v of current?.swe ?? []) {
    if (v.value == null) continue;
    season.push([dayNum(v.date) - day0, v.value]);
    latest = { date: v.date, swe: v.value, normal: v.median ?? null };
  }
  if (!latest) return null;
  const depth = [...(current?.depth ?? [])].reverse().find((v) => v.value != null)?.value ?? null;
  const pct = latest.normal >= MIN_NORMAL_FOR_PCT ? Math.round((latest.swe / latest.normal) * 100) : null;
  // Every other day is plenty for a small chart and keeps data.json light.
  const thin = (pts) => pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
  return { latest: { ...latest, depth }, pct, peak, season: thin(season), normal: thin(normal) };
}
