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
    elements: 'WTEQ,SNWD,TMAX,TMIN',
    duration: 'DAILY',
    beginDate: begin,
    endDate: end,
    centralTendencyType: 'MEDIAN',
    periodRef: 'END',
  });
  return `${AWDB}?${q}`;
}

// → Map(triplet → { swe: [{date, value, median}], depth: [{date, value}], tmax, tmin: [{date, value}] })
export function parseSnotel(json) {
  const out = new Map();
  for (const station of json ?? []) {
    const entry = { swe: [], depth: [], tmax: [], tmin: [] };
    for (const series of station.data ?? []) {
      const code = series.stationElement?.elementCode;
      if (code === 'WTEQ') entry.swe = series.values ?? [];
      if (code === 'SNWD') entry.depth = series.values ?? [];
      if (code === 'TMAX') entry.tmax = series.values ?? [];
      if (code === 'TMIN') entry.tmin = series.values ?? [];
    }
    out.set(station.stationTriplet, entry);
  }
  return out;
}

// Drops bad sensor readings using what snow can physically do: snow water can't gain more than
// ~4″ in a day or lose more than ~3″. A stretch that starts with an impossible jump (up or down)
// and comes back to where it was within ~10 days is a sensor fault, however long it lasted (e.g.
// 0″ → 9.0″ for four days → 0″). Real storms, which stay, are kept.
export function despike(values, { maxRise = 4, maxDrop = 3, back = 10 } = {}) {
  const v = values.filter((x) => x.value != null);
  const out = [];
  let i = 0;
  while (i < v.length) {
    const prev = out.at(-1);
    const last = prev?.value;
    const jump = last == null ? 0 : v[i].value - last;
    // Limits scale with the days between readings (records sometimes have gaps).
    const days = prev ? Math.max(1, Math.round((Date.parse(v[i].date) - Date.parse(prev.date)) / 86_400_000)) : 1;
    if (jump > maxRise * days || -jump > maxDrop * days) {
      // Find where the readings return to the level before the jump.
      let j = i;
      while (j < v.length && j - i < back && Math.abs(v[j].value - last) > Math.max(maxDrop, 0.25 * last)) j++;
      const returned = j < v.length && j - i < back;
      // At the very end of the record we can't see a return yet: drop only truly absurd jumps.
      const atEnd = j >= v.length && Math.abs(jump) > maxRise * 1.5 * days;
      if (returned || atEnd) {
        i = j;
        continue;
      }
    }
    out.push(v[i]);
    i++;
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
  for (const v of despike(current?.swe ?? [])) {
    season.push([dayNum(v.date) - day0, v.value]);
    latest = { date: v.date, swe: v.value, normal: v.median ?? null };
  }
  if (!latest) return null;
  const depth = [...(current?.depth ?? [])].reverse().find((v) => v.value != null)?.value ?? null;
  const pct = latest.normal >= MIN_NORMAL_FOR_PCT ? Math.round((latest.swe / latest.normal) * 100) : null;
  // Every other day is plenty for a small chart and keeps data.json light.
  const thin = (pts) => pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
  return { latest: { ...latest, depth }, pct, peak, season: thin(season), normal: thin(normal), temps: seasonTemps(current, day0) };
}

// This season's daily mean temperature ((high + low) / 2, °F) as [day of season, °F]. Sensor faults
// (impossible values, a low above the high) are left out.
export function seasonTemps(current, day0) {
  const lows = new Map((current?.tmin ?? []).filter((v) => v.value != null).map((v) => [v.date, v.value]));
  const out = [];
  for (const v of current?.tmax ?? []) {
    const l = lows.get(v.date);
    if (v.value == null || l == null || v.value < -50 || v.value > 95 || l < -60 || l > 75 || l > v.value) continue;
    out.push([dayNum(v.date) - day0, Math.round(((v.value + l) / 2) * 10) / 10]);
  }
  return out;
}
