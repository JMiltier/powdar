// Weather-model forecasts from Open-Meteo (free, no key), run for each resort's mid-mountain
// elevation, turned into snowfall with a temperature-based snow-to-liquid ratio.
export const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

// Four independent global/regional models. gfs_seamless uses HRRR for the first ~2 days in the US.
export const MODELS = [
  { id: 'ecmwf_ifs025', label: 'European (ECMWF)' },
  { id: 'gfs_seamless', label: 'American (GFS/HRRR)' },
  { id: 'gem_seamless', label: 'Canadian (GEM)' },
  { id: 'icon_seamless', label: 'German (ICON)' },
];

const FT_TO_M = 0.3048;
const MM_PER_INCH = 25.4;

// Inches of snow per inch of water at a given air temperature (°C). Colorado's cold, dry snow
// stacks up far deeper than the 7:1 Open-Meteo assumes; near freezing it turns wet, then to rain.
export function snowRatio(c) {
  if (c >= 2) return 0;
  if (c > 0) return 5 * (2 - c); // wet snow / mix, fading to rain at +2 °C
  if (c > -4) return 11;
  if (c > -9) return 14;
  if (c > -15) return 17; // the dendrite zone: fluffiest flakes
  return 14;
}

export function modelUrl(model, resorts, days) {
  const q = new URLSearchParams({
    latitude: resorts.map((r) => r.at[0]).join(','),
    longitude: resorts.map((r) => r.at[1]).join(','),
    elevation: resorts.map((r) => Math.round(r.elev * FT_TO_M)).join(','),
    hourly: 'temperature_2m,precipitation',
    models: model,
    forecast_days: String(days),
    timeformat: 'unixtime',
    timezone: 'America/Denver',
  });
  return `${OPEN_METEO}?${q}`;
}

// One location's response → hourly snow in inches: [{ t: msTimestamp, v }].
// Open-Meteo precipitation is the sum over the preceding hour, so it's stamped at the hour's middle.
export function snowHours(loc) {
  const h = loc?.hourly;
  if (!h?.time?.length) return null;
  const out = [];
  let any = false;
  for (let i = 0; i < h.time.length; i++) {
    const p = h.precipitation?.[i];
    const c = h.temperature_2m?.[i];
    if (p == null || c == null) continue;
    any = true;
    out.push({ t: h.time[i] * 1000 - 1_800_000, v: (p * snowRatio(c)) / MM_PER_INCH });
  }
  return any ? out : null;
}
