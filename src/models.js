// Weather-model forecasts from Open-Meteo (free, no key), run for each resort's mid-mountain
// elevation, turned into snowfall with a temperature-based snow-to-liquid ratio.
export const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

// The weather models: three global ones (gfs_seamless uses the 3 km HRRR for the first ~2 days in the
// US, so the mountains themselves are resolved), NOAA's National Blend of Models (its many models
// corrected against what actually fell: the Weather Service's own starting point), and the UK Met
// Office's 10 km model. days: how far each one reaches (so the request asks no further).
export const MODELS = [
  { id: 'ecmwf_ifs025', label: 'European (ECMWF)' },
  { id: 'gfs_seamless', label: 'American (GFS/HRRR)' },
  { id: 'gem_seamless', label: 'Canadian (GEM)' },
  { id: 'ncep_nbm_conus', label: 'NOAA Blend (NBM)', days: 11 },
  { id: 'ukmo_global_deterministic_10km', label: 'UK Met Office', days: 7 },
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

// Each day's highest UV index at every resort (one request for all of them).
export function uvUrl(resorts, days, tz = 'America/Denver') {
  const q = new URLSearchParams({
    latitude: resorts.map((r) => r.at[0]).join(','),
    longitude: resorts.map((r) => r.at[1]).join(','),
    daily: 'uv_index_max',
    forecast_days: String(days),
    timezone: tz,
  });
  return `${OPEN_METEO}?${q}`;
}

// tz: the area's time zone (its days run midnight to midnight there).
export function modelUrl(model, resorts, days, tz = 'America/Denver') {
  const q = new URLSearchParams({
    latitude: resorts.map((r) => r.at[0]).join(','),
    longitude: resorts.map((r) => r.at[1]).join(','),
    elevation: resorts.map((r) => Math.round(r.elev * FT_TO_M)).join(','),
    // (Sunshine, cloud and gusts too: for how the snow surface bakes, refreezes and blows around.)
    hourly: 'temperature_2m,precipitation,shortwave_radiation,cloud_cover,wind_gusts_10m',
    wind_speed_unit: 'mph',
    models: model,
    forecast_days: String(days),
    past_days: '8', // the last week too: "last 24 hours" where resorts don't report, −3d and −7d, the past-7-days bars
    timeformat: 'unixtime',
    timezone: tz,
  });
  return `${OPEN_METEO}?${q}`;
}

// Share of precipitation that falls as snow (the rest is rain), by air temperature (°C).
export function snowFraction(c) {
  if (c >= 2) return 0;
  if (c > 0) return (2 - c) / 2;
  return 1;
}

// One location's response → hourly snow: [{ t: msTimestamp, v: inches of snow, w: inches of water as snow }].
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
    out.push({ t: h.time[i] * 1000 - 1_800_000, v: (p * snowRatio(c)) / MM_PER_INCH, w: (p * snowFraction(c)) / MM_PER_INCH });
  }
  return any ? out : null;
}
