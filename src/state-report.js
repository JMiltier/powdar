// Builds one state's data file (public/data/<state>.json) for states other than Colorado. Same shape
// as Colorado's data.json, minus what only Colorado has (Colorado Ski Country's feed, opening dates).
// Forecasts, snowpack and NOAA snow depth refresh every few hours (to stay inside the free forecast
// allowance); live lift status refreshes every update.
import { MODELS, modelUrl, snowHours } from './models.js';
import { parseSnotel, snotelUrl, stationSeason, waterYear } from './snotel.js';
import { feedReader, summarizeLifts } from './lifts.js';
import { nohrscUrl, parseNohrsc } from './noaa.js';
import { blendForecast, nwsSnowHours, localDate, seasonOf, getJson, getText, pool, MODEL_DAYS } from './report.js';

const NWS = 'https://api.weather.gov/gridpoints';

// Status from live lifts, the only status source outside Colorado.
function statusFromLifts(lifts) {
  if (!lifts?.total) return { state: 'unknown', label: 'No live status' };
  if (lifts.open > 0) return { state: 'open', label: 'Open', detail: `${lifts.open} of ${lifts.total} lifts` };
  if (lifts.scheduled > 0) return { state: 'soon', label: 'Opening today', detail: `${lifts.scheduled} lifts scheduled` };
  return { state: 'closed', label: 'Closed now', detail: `0 of ${lifts.total} lifts` };
}

async function fetchLifts(fetchFn, r, now, backoff, log) {
  const src = r.lifts && feedReader(r.lifts);
  if (!src) return null;
  try {
    const body = await getJson(fetchFn, src.url, { backoff });
    const lifts = src.parse(body);
    if (!lifts.length) throw new Error('no lifts found');
    return summarizeLifts(lifts, src.page, now.toISOString());
  } catch (err) {
    log(`Lift status failed for ${r.name}: ${err.message}`);
    return null;
  }
}

// prev: this state's last published file (reused for whatever isn't refreshed this time).
export async function buildStateReport({ code, name, resorts, prev, refresh, fetch: fetchFn = fetch, now = new Date(), log = () => {}, backoff = 2000 }) {
  const today = localDate(now);
  const old = new Map((prev?.resorts ?? []).map((r) => [r.id, r]));
  let forecasts = resorts.map((r) => old.get(r.id)?.forecast ?? null);
  let noaa = resorts.map((r) => old.get(r.id)?.noaa ?? null);
  let snowpack = prev?.snowpack ?? {};
  let forecastAt = prev?.forecastAt ?? null;

  if (refresh) {
    const stations = [...new Set(resorts.filter((r) => r.snotel).map((r) => r.snotel[0]))];
    const wy = waterYear(today);
    const [modelData, nwsData, nwsText, snowNow, snowNormal, noaaNow] = await Promise.all([
      Promise.all(MODELS.map((m) => getJson(fetchFn, modelUrl(m.id, resorts, MODEL_DAYS), { backoff })
        .then((d) => (Array.isArray(d) ? d : [d]))
        .catch((err) => { log(`${code} model ${m.label} failed: ${err.message}`); return null; }))),
      pool(resorts, 4, (r) => (r.nws ? getJson(fetchFn, `${NWS}/${r.nws[0]}/${r.nws[1]},${r.nws[2]}`, { backoff }).then((d) => d.properties).catch(() => null) : null)),
      pool(resorts, 4, (r) => (r.nws ? getJson(fetchFn, `${NWS}/${r.nws[0]}/${r.nws[1]},${r.nws[2]}/forecast`, { backoff }).then((d) => d.properties.periods).catch(() => null) : null)),
      stations.length ? getJson(fetchFn, snotelUrl(stations, wy.start, today), { backoff }).then(parseSnotel).catch(() => null) : null,
      stations.length ? getJson(fetchFn, snotelUrl(stations, `${wy.startYear - 1}-10-01`, `${wy.startYear}-07-31`), { backoff }).then(parseSnotel).catch(() => null) : null,
      pool(resorts, 4, (r) => getJson(fetchFn, nohrscUrl(r.at), { backoff }).then(parseNohrsc).catch(() => null)),
    ]);
    const modelsOk = modelData.some(Boolean);
    const fresh = resorts.map((r, i) => blendForecast({
      nws: nwsData[i],
      periods: nwsText[i],
      sources: [
        { id: 'nws', hours: nwsSnowHours(nwsData[i]) },
        ...MODELS.map((m, k) => ({ id: m.id, hours: snowHours(modelData[k]?.[i]) })),
      ],
    }, now));
    // Keep a previous model-based forecast rather than replace it with a thinner NWS-only one.
    forecasts = fresh.map((f, i) => (modelsOk || !(forecasts[i]?.sources?.length > 1) ? f ?? forecasts[i] : forecasts[i]));
    if (modelsOk) forecastAt = now.toISOString();
    noaa = noaaNow.map((n, i) => n ?? noaa[i]);
    if (snowNow) {
      snowpack = Object.fromEntries(stations.map((t) => {
        const st = resorts.find((r) => r.snotel?.[0] === t).snotel[1];
        const s = stationSeason({ current: snowNow.get(t), normals: snowNormal?.get(t), today });
        return [t, s && { name: st, ...s }];
      }).filter(([, s]) => s));
    }
  }

  const lifts = await pool(resorts, 4, (r) => fetchLifts(fetchFn, r, now, backoff, log));
  const out = resorts.map((r, i) => {
    const liveLifts = lifts[i] ?? (old.get(r.id)?.lifts && Date.now() - Date.parse(old.get(r.id).lifts.checked) < 3 * 3_600_000 ? old.get(r.id).lifts : null);
    return {
      id: r.id,
      name: r.name,
      short: r.short,
      region: name,
      at: r.at,
      url: r.url,
      live: false,
      status: statusFromLifts(liveLifts),
      dates: null,
      report: null,
      forecast: forecasts[i],
      lifts: liveLifts,
      noaa: noaa[i],
      avgSnow: null,
      station: r.snotel && snowpack[r.snotel[0]] ? r.snotel[0] : null,
    };
  });

  return {
    generated: now.toISOString(),
    today,
    season: seasonOf(today).name,
    state: code,
    stateName: name,
    forecastAt,
    sources: {
      forecasts: out.filter((r) => r.forecast).length,
      resorts: out.length,
      lifts: lifts.filter(Boolean).length,
      snotel: Object.keys(snowpack).length,
      noaa: noaa.filter(Boolean).length,
      models: {},
      modelsAt: forecastAt,
    },
    resorts: out,
    snowpack,
  };
}
