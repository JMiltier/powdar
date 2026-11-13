// NOAA's National Operational Hydrologic Remote Sensing Center (NOHRSC) snow model, SNODAS: modelled
// snow depth and snow water at any point in the US, updated daily. Read through NOAA's map service.
const NOHRSC = 'https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/identify';
export const NOHRSC_PAGE = 'https://www.nohrsc.noaa.gov/nsa/';

export function nohrscUrl([lat, lon]) {
  const q = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    sr: '4326',
    layers: 'all:3,7', // 3 = snow depth (m), 7 = snow water equivalent (mm)
    tolerance: '1',
    mapExtent: '-125,24,-66,50',
    imageDisplay: '800,600,96',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${NOHRSC}?${q}`;
}

// → { depth, water } in inches, or null when NOAA has no value there.
export function parseNohrsc(json) {
  const value = (layerId) => {
    const v = Number(json?.results?.find((r) => r.layerId === layerId)?.attributes?.['Service Pixel Value']);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };
  const depthM = value(3);
  const waterMm = value(7);
  if (depthM == null && waterMm == null) return null;
  const r1 = (n) => Math.round(n * 10) / 10;
  return { depth: depthM == null ? null : r1(depthM * 39.37), water: waterMm == null ? null : r1(waterMm / 25.4) };
}
