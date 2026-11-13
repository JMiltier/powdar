// The map: one fixed view of every Colorado resort (no panning or zooming). Each resort has a dot at
// its real spot and a light label beside it: a small colored chip with the number, then the name as
// plain outlined text. Labels sit right next to their dot when there's room (right side first); in
// crowded spots (I-70) they step out a little with a thin hairline back to the dot.
const L = window.L;

// Esri's hillshade: just the mountains, no town names or roads to compete with the resorts, with a
// matching dark version. Free, no key.
const TILES = {
  light: 'https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
};
const isDark = () => document.documentElement.dataset.theme === 'dark';
// NASA GIBS: each day's real satellite photo (VIIRS on NOAA-20, ~250 m, a few hours after its early-
// afternoon pass), free and keyless. 'sat' is true color (snow white, clouds white too); 'satsnow' is
// shortwave-infrared false color, where snow shows bright cyan and clouds stay white.
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const SAT_LAYERS = { sat: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', satsnow: 'VIIRS_NOAA20_CorrectedReflectance_BandsM11-I2-I1' };
export const satTile = (kind, date) => `${GIBS}/${SAT_LAYERS[kind]}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
// Fine terrain shading laid over the satellite photo (multiplied in CSS) so ridges stay crisp.
const SHADE = 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';
// Shown behind the ⓘ button instead of a permanent banner.
export const CREDITS = 'Hillshade © <a href="https://www.esri.com">Esri</a> and its data partners (USGS, NASA, NGA, CGIAR and others) · '
  + 'satellite: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> (VIIRS, NOAA-20) · '
  + 'highways © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · '
  + 'snow cover: <a href="https://www.nohrsc.noaa.gov/nsa/">NOAA NOHRSC</a> · radar: <a href="https://www.nssl.noaa.gov/projects/mrms/">NOAA MRMS</a> · '
  + 'snow forecast: <a href="https://www.wpc.ncep.noaa.gov/wwd/winter_wx.shtml">NWS Weather Prediction Center</a> · '
  + 'season outlook: <a href="https://www.cpc.ncep.noaa.gov/products/predictions/long_range/seasonal.php">NOAA Climate Prediction Center</a> · <a href="https://leafletjs.com">Leaflet</a>';
// NOAA's daily national snow analysis (NOHRSC): modelled snow depth on the ground, cloud-free.
// NOAA's snow depth as an image in its official legend colors, one per depth class (inches):
// <2, 2–4, 4–10, 10–20, 20–39, 39–59, 59–98, 98–197, 197–295, 295–394, 394+. We read each pixel's class
// back from its color and repaint it as snow: icy white-blue where it's thin, deep blue where it's
// deep. (The REST export of layer 3 gives these exact colors all season; the WMS blends them.)
const SNOW_DEPTH_EXPORT = 'https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export';
const NOAA_CLASSES = [
  [171, 193, 191], [102, 193, 196], [99, 169, 203], [80, 121, 200], [60, 63, 194], [87, 32, 195],
  [125, 1, 187], [180, 4, 177], [169, 19, 119], [153, 43, 80], [139, 69, 69],
];
// Our ramp, one entry per class: [r, g, b, alpha 0–255]. Snow is drawn as snow: white, thin and see-
// through where it's shallow, solid where it's deep (a faint cool tint keeps it from reading as cloud).
// Blue stays for the resort numbers. The key's gradient (.ramp) matches it.
// Depth reads as brightness: a dusting is a dim grey-white, deep snow brilliant white; even a dusting is
// clearly there.
export const SNOW_RAMP = [
  [196, 206, 219, 135], [212, 220, 231, 165], [225, 231, 240, 192], [236, 241, 247, 215], [244, 247, 251, 232],
  [250, 252, 254, 242], [255, 255, 255, 250], [255, 255, 255, 252], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255],
];

const classOf = (r, g, b) => {
  let best = 0;
  let bestD = Infinity;
  NOAA_CLASSES.forEach(([R, G, B], i) => {
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
};

// NOAA's live radar (MRMS base reflectivity, refreshed every few minutes), in the usual radar colors:
// blue-grey for light, then teal, green, yellow, red, magenta for heavier. Repainted for snow: a soft
// white-cyan glow for light snow, brighter blue, then violet for heavy.
const RADAR_WMS = 'https://mapservices.weather.noaa.gov/eventdriven/services/radar/radar_base_reflectivity/MapServer/WMSServer';
// The same radar with its past frames (about the last 2 hours), for the loop.
const RADAR_TIME = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';
const RADAR_STOPS = [[124, 137, 175], [80, 104, 163], [70, 170, 190], [40, 180, 80], [20, 130, 40], [230, 220, 40], [240, 140, 20], [220, 30, 30], [200, 40, 200]];
export const RADAR_RAMP = [
  [235, 250, 255, 120], [205, 238, 255, 150], [160, 220, 255, 175], [110, 190, 255, 195], [70, 150, 250, 210],
  [80, 110, 240, 220], [110, 80, 230, 228], [150, 60, 220, 235], [190, 50, 210, 240],
];
const radarColor = (r, g, b) => {
  let best = 0;
  let bestD = Infinity;
  RADAR_STOPS.forEach(([R, G, B], i) => {
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return RADAR_RAMP[best];
};
// NWS Weather Prediction Center: chance of at least 4″, 8″ or 12″ of snow in each of the next three
// 24-hour periods (layers: day 1 → 1, 2, 3; day 2 → 6, 7, 8; day 3 → 11, 12, 13), as areas rated
// slight (10–39%), moderate (40–69%) or high (70%+).
const SNOWCAST = 'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_prob_winter_precip/MapServer';
export const CAST_AMOUNTS = [4, 8, 12];
const CAST_SHADES = { 1: 0.28, 2: 0.48, 3: 0.7 };

// NOAA Climate Prediction Center: odds of a wetter or drier than normal next 3 months (lead 1).
const OUTLOOK = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_sea_precip_outlk/MapServer/0/query';
// Shades by probability (33–40%, 40–50%, 50–60%, 60%+): wetter in blues, drier in tans.
const OUTLOOK_SHADES = {
  Above: ['#b9d7f2', '#86b8e8', '#4f93d8', '#2a6fbe'],
  Below: ['#f1dcb6', '#e3bd7f', '#cf9548', '#a96a24'],
};

const GAP = 2;
const DOT_R = 4;
// Margin around the resorts when fitting them (labels stick out sideways more than up and down).
const EDGE_X = 30;
const EDGE_Y = 14;

const SHORT = {
  'arapahoe-basin': 'A-Basin', 'copper-mountain': 'Copper', breckenridge: 'Breck', 'beaver-creek': 'Beaver Cr',
  'echo-mountain': 'Echo', 'granby-ranch': 'Granby', 'howelsen-hill': 'Howelsen', 'aspen-mountain': 'Aspen Mtn',
  'aspen-highlands': 'Highlands', 'crested-butte': 'Crested Butte', cooper: 'Cooper', 'winter-park': 'Winter Park',
};

// Where a label may sit, as its center relative to the dot. First the eight classic spots touching
// the dot (right, left, above, below, corners), then a fine grid further out for crowded clusters.
// Spots where the label would cover its own point are left out.
function spotsFor(w, h) {
  const gx = w / 2 + DOT_R + 3;
  const gy = h / 2 + DOT_R + 1;
  const out = [
    [gx, 0, 0], [-gx, 0, 15], [0, -gy, 25], [0, gy, 30],
    [gx - 6, -gy + 2, 35], [gx - 6, gy - 2, 40], [-gx + 6, -gy + 2, 45], [-gx + 6, gy - 2, 50],
  ];
  for (let dx = -Math.round(1.5 * w); dx <= 1.5 * w; dx += 8) {
    for (let j = -12; j <= 12; j++) {
      const dy = j * (h / 2 + 1);
      if (Math.abs(dx) < w / 2 + DOT_R + 2 && Math.abs(dy) < h / 2 + DOT_R + 1) continue; // would cover its own dot
      out.push([dx, dy, 60]);
    }
  }
  return out;
}

// A label at offset s, and the hairline from its nearest edge to the rim of its dot (null when the
// label already touches the dot).
function leader(it, [dx, dy]) {
  const l = it.p.x + dx - it.w / 2;
  const t = it.p.y + dy - it.h / 2;
  const nx = Math.min(l + it.w - 2, Math.max(l + 2, it.p.x));
  const ny = Math.min(t + it.h - 2, Math.max(t + 2, it.p.y));
  const vx = nx - it.p.x;
  const vy = ny - it.p.y;
  const len = Math.hypot(vx, vy);
  if (len <= DOT_R + 6) return { len: 0, seg: null };
  const sx = it.p.x + (vx / len) * (DOT_R + 1);
  const sy = it.p.y + (vy / len) * (DOT_R + 1);
  return { len, seg: [nx, ny, sx, sy] };
}

function segPointDist([x1, y1, x2, y2], p) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
}

function segSeg([a, b, c, d], [e, f, g, h]) {
  const cross = (x1, y1, x2, y2, x3, y3) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  const d1 = cross(e, f, g, h, a, b);
  const d2 = cross(e, f, g, h, c, d);
  const d3 = cross(a, b, c, d, e, f);
  const d4 = cross(a, b, c, d, g, h);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// Does a segment touch a box (with a little shrink so a pointer may start on its own label's edge)?
function segRect(seg, box) {
  const [x1, y1, x2, y2] = seg;
  const [l, t, r, b] = [box[0] + 1, box[1] + 1, box[2] - 1, box[3] - 1];
  const inside = (x, y) => x > l && x < r && y > t && y < b;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  return segSeg(seg, [l, t, r, t]) || segSeg(seg, [r, t, r, b]) || segSeg(seg, [l, b, r, b]) || segSeg(seg, [l, t, l, b]);
}

// getPadding() → { top, right, bottom, left }: pixels covered by the app's bars and panels.
// extend: an extra [lat, lon] to frame in (Colorado adds open plains east of the Front Range so its
// labels have room to spread instead of piling onto I-70).
// The depth color scale (the default "color" snow style): a different hue for every depth band, ice to
// teal to violet to magenta, so a foot and three feet look clearly different. Kept clear of the resort
// numbers' blue and the season's orange/tan. Per NOAA class: <2″, 2–4″, 4–10″, 10–20″, 20–39″, 39–59″,
// 59–98″, 98″+ (deeper classes share the last).
export const SNOW_COLOR = [
  [214, 222, 232, 165], [176, 236, 243, 195], [104, 212, 225, 210], [20, 146, 172, 222], [96, 96, 210, 226],
  [146, 74, 204, 232], [200, 64, 176, 238], [236, 80, 140, 244], [236, 80, 140, 244], [236, 80, 140, 244], [236, 80, 140, 244],
];

export function createSnowMap(el, { resorts, onSelect, getPadding, extend, places = [], onOutlook, onRadar, onCast }) {
  const bounds = L.latLngBounds(resorts.map((r) => r.at));
  if (extend) bounds.extend(extend);
  // A state with a single resort still needs some area around it.
  if (bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 40000) bounds.extend(bounds.getCenter().toBounds(80000));
  const map = L.map(el, {
    zoomControl: false, attributionControl: false, zoomSnap: 0, inertia: false,
    dragging: false, touchZoom: false, doubleClickZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false,
  });
  // detectRetina: sharp relief on high-resolution phone screens (one zoom level more detail).
  // (A new layer on theme change: swapping the address of the old one makes Leaflet ask for tiles
  // at a fractional zoom at this map's in-between zoom level, which come back blank.)
  // The background: shaded relief ('terrain', light or dark), or a day's satellite photo.
  let baseKind = 'terrain';
  let satDate = null;
  map.createPane('shade').style.zIndex = 220; // over a satellite photo, under the snow and labels
  let shade = null;
  const relief = () => {
    const layer = baseKind === 'terrain'
      ? L.tileLayer(isDark() ? TILES.dark : TILES.light, { maxZoom: 13, detectRetina: true })
      : L.tileLayer(satTile(baseKind, satDate), { maxZoom: 13, maxNativeZoom: 9 });
    // A tile that fails to load (a mobile network blip) gets one more try instead of leaving a blank.
    layer.on('tileerror', ({ tile }) => {
      if (tile.dataset.retried) return;
      tile.dataset.retried = '1';
      setTimeout(() => { tile.src = `${tile.src.split('?')[0]}?retry=1`; }, 1500);
    });
    return layer.addTo(map);
  };
  let base = relief();
  // Swap the background (the old one stays until the new one has loaded: no blank flash).
  function swapBase() {
    const old = base;
    base = relief();
    base.once('load', () => old.remove());
    setTimeout(() => old.remove(), 4000);
    el.dataset.base = baseKind;
    if (baseKind === 'terrain') { shade?.remove(); shade = null; }
    else if (!shade) shade = L.tileLayer(SHADE, { pane: 'shade', maxZoom: 13, detectRetina: true, className: 'sat-shade' }).addTo(map);
  }
  el.dataset.base = baseKind;

  // Snow cover gets its own pane so the color-muting filter on the base map doesn't wash it out.
  map.createPane('snow').style.zIndex = 250;
  map.createPane('dots').style.zIndex = 590; // just under the labels (markerPane is 600)
  // The overlay (one at a time): 'snow' (on the ground), 'radar' (falling now), 'outlook' (the season's
  // precipitation outlook) or 'none'. Snow and radar are one picture of the visible map from NOAA,
  // repainted pixel by pixel and smoothly upscaled; the outlook is NOAA's shapes, colored.
  let layerName = 'none';
  let snowStyle = 'color';
  let overlay = null;
  let job = 0;
  let radarTimer = null;
  let outlookData = null;
  // src(w, h, sw, ne) → image URL for the visible map in Web Mercator.
  const wms = (url) => (w, h, sw, ne) => `${url}?${new URLSearchParams({
    service: 'WMS', request: 'GetMap', version: '1.3.0', layers: '0', styles: '', format: 'image/png', transparent: 'true',
    crs: 'EPSG:3857', width: w, height: h, bbox: [sw.x, sw.y, ne.x, ne.y].join(','), t: Math.floor(Date.now() / 120000),
  })}`;
  const snowExport = (w, h, sw, ne) => `${SNOW_DEPTH_EXPORT}?${new URLSearchParams({
    bbox: [sw.x, sw.y, ne.x, ne.y].join(','), bboxSR: '3857', imageSR: '3857', size: `${w},${h}`, format: 'png32',
    transparent: 'true', layers: 'show:3', f: 'image', t: Math.floor(Date.now() / 3600000),
  })}`;
  // shadow: a soft edge color around what's drawn (white snow needs one on the light map).
  // Options: shadow (a soft edge color); depth { classify(r, g, b) → depth class } with relief (paint a
  // lit surface: brightness by depth, light from the northwest, so deep snow reads as a raised layer)
  // and/or contours ({ levels, color }: smooth lines where depth crosses each level, by marching
  // squares over a blurred depth grid).
  // smooth: a ramp ([r, g, b, a] per depth class) to draw the depth as smooth-edged bands at 3× the
  // grid's resolution, instead of NOAA's ~1 km squares.
  async function picture(src, recolor, { shadow = null, depth = null, relief = false, contours = null, smooth = null } = {}) {
    const size = map.getSize();
    const b = map.getPixelBounds();
    const sw = map.options.crs.project(map.unproject(L.point(b.min.x, b.max.y)));
    const ne = map.options.crs.project(map.unproject(L.point(b.max.x, b.min.y)));
    // About NOAA's own 1 km grid at this zoom (finer just shows its squares as stair-steps); smooth
    // upscaling below turns the squares into clean rounded edges.
    const w = Math.max(1, Math.round(size.x / 2.5));
    const h = Math.max(1, Math.round(size.y / 2.5));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src(w, h, sw, ne);
    await img.decode();
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const g = small.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, w, h);
    const d = data.data;
    // Depth field: class index (0 = under 2″ … 7 = 8 ft+), −1.5 where there's no snow, smoothed.
    let raw = null;
    let f = null;
    if (depth) {
      raw = new Float32Array(w * h);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) raw[p] = d[i + 3] < 8 ? -1.5 : Math.min(7, depth.classify(d[i], d[i + 1], d[i + 2]));
      f = raw;
      for (let pass = 0; pass < 2; pass++) {
        const out = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let sum = 0;
            let n = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx >= 0 && yy >= 0 && xx < w && yy < h) { sum += f[yy * w + xx]; n++; }
            }
            out[y * w + x] = sum / n;
          }
        }
        f = out;
      }
    }
    if (relief && f) {
      for (let y = 0, p = 0; y < h; y++) {
        for (let x = 0; x < w; x++, p++) {
          const i = p * 4;
          if (raw[p] < -1) { d[i + 3] = 0; continue; }
          const v = Math.max(0, Math.min(1, (f[p] + 0.5) / 7.5)); // 0 thin → 1 deep
          // Light from the northwest on the depth surface.
          const gx = (f[p + (x < w - 1 ? 1 : 0)] - f[p - (x > 0 ? 1 : 0)]) / 2;
          const gy = (f[p + (y < h - 1 ? w : 0)] - f[p - (y > 0 ? w : 0)]) / 2;
          const light = Math.max(0.72, Math.min(1.18, 1 + (-gx - gy) * 0.22));
          const base = 168 + 87 * Math.sqrt(v); // cool grey-white → brilliant white
          d[i] = Math.min(255, (base - 10 * (1 - v)) * light);
          d[i + 1] = Math.min(255, (base - 4 * (1 - v)) * light);
          d[i + 2] = Math.min(255, (base + 6) * light);
          d[i + 3] = Math.round(125 + 130 * Math.sqrt(v));
        }
      }
    }
    const memo = new Map();
    for (let i = 0; i < d.length && !(relief && f); i += 4) {
      if (d[i + 3] < 8) { d[i + 3] = 0; continue; }
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      let c = memo.get(key);
      if (!c) memo.set(key, (c = recolor(d[i], d[i + 1], d[i + 2])));
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
    }
    g.putImageData(data, 0, 0);
    // Smooth bands: the blurred depth field, sampled between grid points, cut into bands with a soft
    // edge only right at each boundary (so bands stay distinct but their outlines are curves).
    let source = small;
    if (smooth && f) {
      const K = 3;
      const W = w * K;
      const H = h * K;
      const hi = document.createElement('canvas');
      hi.width = W;
      hi.height = H;
      const hg = hi.getContext('2d');
      const out = hg.createImageData(W, H);
      const o = out.data;
      const step = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const top = smooth.length - 1;
      for (let Y = 0; Y < H; Y++) {
        const fy = (Y + 0.5) / K - 0.5;
        const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
        const y1 = Math.min(h - 1, y0 + 1);
        const ty = Math.max(0, Math.min(1, fy - y0));
        for (let X = 0; X < W; X++) {
          const fx = (X + 0.5) / K - 0.5;
          const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)));
          const x1 = Math.min(w - 1, x0 + 1);
          const tx = Math.max(0, Math.min(1, fx - x0));
          const v = (f[y0 * w + x0] * (1 - tx) + f[y0 * w + x1] * tx) * (1 - ty) + (f[y1 * w + x0] * (1 - tx) + f[y1 * w + x1] * tx) * ty;
          const cover = step(-0.75, -0.45, v);
          if (cover <= 0) continue;
          const c = Math.max(0, Math.min(top, v));
          const lo = Math.min(top, Math.floor(c));
          const hiC = Math.min(top, lo + 1);
          const t = step(0.44, 0.56, c - lo);
          const A = smooth[lo];
          const B = smooth[hiC];
          const i = (Y * W + X) * 4;
          o[i] = A[0] + (B[0] - A[0]) * t;
          o[i + 1] = A[1] + (B[1] - A[1]) * t;
          o[i + 2] = A[2] + (B[2] - A[2]) * t;
          o[i + 3] = (A[3] + (B[3] - A[3]) * t) * cover;
        }
      }
      hg.putImageData(out, 0, 0);
      source = hi;
    }
    // Drawn at the screen's real pixel density (crisp on phones), smoothed rather than blocky.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const big = document.createElement('canvas');
    big.width = Math.round(size.x * dpr);
    big.height = Math.round(size.y * dpr);
    const G = big.getContext('2d');
    G.imageSmoothingEnabled = true;
    G.imageSmoothingQuality = 'high';
    if (shadow) Object.assign(G, { shadowColor: shadow, shadowBlur: 5 * dpr });
    G.drawImage(source, 0, 0, big.width, big.height);
    if (contours && f) {
      G.shadowColor = 'transparent';
      const sx = big.width / w;
      const sy = big.height / h;
      G.strokeStyle = contours.color;
      G.lineWidth = 1.1 * dpr;
      G.lineJoin = G.lineCap = 'round';
      G.beginPath();
      for (const level of contours.levels) {
        const t = level - 0.5;
        const v = (x, y) => f[y * w + x];
        const lerp = (a, b2) => (t - a) / (b2 - a);
        for (let y = 0; y < h - 1; y++) {
          for (let x = 0; x < w - 1; x++) {
            const a = v(x, y); const b1 = v(x + 1, y); const c = v(x + 1, y + 1); const e = v(x, y + 1);
            const pts = [];
            if ((a >= t) !== (b1 >= t)) pts.push([x + lerp(a, b1), y]);
            if ((b1 >= t) !== (c >= t)) pts.push([x + 1, y + lerp(b1, c)]);
            if ((e >= t) !== (c >= t)) pts.push([x + lerp(e, c), y + 1]);
            if ((a >= t) !== (e >= t)) pts.push([x, y + lerp(a, e)]);
            for (let k = 0; k + 1 < pts.length; k += 2) {
              G.moveTo((pts[k][0] + 0.5) * sx, (pts[k][1] + 0.5) * sy);
              G.lineTo((pts[k + 1][0] + 0.5) * sx, (pts[k + 1][1] + 0.5) * sy);
            }
          }
        }
      }
      G.stroke();
    }
    return L.imageOverlay(big.toDataURL('image/png'), map.getBounds(), { pane: 'snow', interactive: false });
  }
  async function outlookLayer() {
    if (!outlookData) {
      const q = new URLSearchParams({
        where: '1=1', outFields: 'cat,prob,valid_seas', f: 'geojson', outSR: '4326', maxAllowableOffset: '0.02',
        geometry: '-112,34,-99,44', geometryType: 'esriGeometryEnvelope', inSR: '4326',
      });
      outlookData = await (await fetch(`${OUTLOOK}?${q}`)).json();
      onOutlook?.(outlookData.features?.[0]?.properties?.valid_seas ?? null);
    }
    return L.geoJSON(outlookData, {
      pane: 'snow', interactive: false,
      style: (f) => {
        const { cat, prob } = f.properties;
        const shade = OUTLOOK_SHADES[cat]?.[prob < 40 ? 0 : prob < 50 ? 1 : prob < 60 ? 2 : 3];
        return shade ? { className: 'outlook', stroke: true, color: shade, weight: 0.6, fillColor: shade, fillOpacity: 0.5 } : { stroke: false, fill: false };
      },
    });
  }
  // Radar loop: the last hour of NOAA's radar frames (about 5 minutes apart), each repainted once and
  // kept; playing steps through them, holding a moment on the newest. Falls back to the single
  // latest picture if the frames can't be listed.
  let frames = []; // [{ t, layer }] oldest first
  const frameCache = new Map(); // time → overlay (cleared when the map's size changes)
  let frameAt = 0;
  let playing = false;
  let playTimer = null;
  const radarSrc = (t) => (w, h, sw, ne) => `${RADAR_TIME}/exportImage?${new URLSearchParams({
    bbox: [sw.x, sw.y, ne.x, ne.y].join(','), bboxSR: '3857', imageSR: '3857', size: `${w},${h}`, format: 'png32',
    transparent: 'true', time: t, f: 'image',
  })}`;
  async function radarTimes() {
    const q = new URLSearchParams({ where: '1=1', outFields: 'idp_validtime', returnGeometry: 'false', orderByFields: 'idp_validtime', f: 'json' });
    const d = await (await fetch(`${RADAR_TIME}/query?${q}`)).json();
    const all = [...new Set((d.features ?? []).map((f) => f.attributes.idp_validtime).filter(Boolean))].sort((a, b) => b - a);
    const out = [];
    for (const t of all) {
      if (t < all[0] - 3600000) break;
      if (!out.length || out.at(-1) - t >= 5 * 60000) out.push(t);
    }
    return out.reverse();
  }
  function showFrame(i) {
    frameAt = i;
    frames.forEach((f, k) => f.layer.setOpacity(k === i ? 1 : 0));
    onRadar?.({ time: frames[i]?.t ?? null, playing, index: i, count: frames.length });
  }
  function step() {
    if (!frames.length) return;
    const next = (frameAt + 1) % frames.length;
    showFrame(next);
    // Hold on the newest frame before starting over.
    playTimer = setTimeout(step, next === frames.length - 1 ? 1600 : 450);
  }
  function play(on) {
    playing = on && frames.length > 1;
    clearTimeout(playTimer);
    if (playing) step();
    else if (frames.length) showFrame(frames.length - 1);
  }
  async function radarLayer() {
    const times = await radarTimes();
    if (!times.length) throw new Error('no radar frames');
    const built = await Promise.all(times.map(async (t) => {
      if (!frameCache.has(t)) frameCache.set(t, await picture(radarSrc(t), radarColor));
      return { t, layer: frameCache.get(t) };
    }));
    for (const t of frameCache.keys()) if (!times.includes(t)) frameCache.delete(t);
    return built;
  }

  // Snow forecast areas for a day (1–3) and amount (4, 8, 12), cached per pair.
  let cast = { day: 1, amount: 4 };
  const castCache = new Map();
  async function snowcastLayer() {
    const layer = (cast.day - 1) * 5 + 1 + CAST_AMOUNTS.indexOf(cast.amount);
    if (!castCache.has(layer)) {
      const q = new URLSearchParams({
        where: '1=1', outFields: 'dn,start_time,end_time,issue_time', f: 'geojson', outSR: '4326', maxAllowableOffset: '0.01',
        geometry: '-112,34,-99,44', geometryType: 'esriGeometryEnvelope', inSR: '4326',
      });
      castCache.set(layer, await (await fetch(`${SNOWCAST}/${layer}/query?${q}`)).json());
    }
    const data = castCache.get(layer);
    onCast?.({ ...cast, areas: data.features?.length ?? 0, start: data.features?.[0]?.properties?.start_time ?? null });
    return L.geoJSON(data, {
      pane: 'snow', interactive: false,
      style: (f) => ({ className: 'snowcast', stroke: true, weight: 0.8, color: '#7c3aed', opacity: 0.6, fillColor: '#8b5cf6', fillOpacity: CAST_SHADES[f.properties.dn] ?? 0.25 }),
    });
  }

  async function drawLayer() {
    const mine = ++job;
    clearInterval(radarTimer);
    clearTimeout(playTimer);
    let next = null;
    let nextFrames = [];
    try {
      if (layerName === 'snow') {
        // Four ways to draw it (tap the key to cycle): shaded (flat white by depth), volume (lit
        // surface), contours (shaded + depth lines), color (a blue depth scale).
        const shadow = isDark() ? 'rgba(0, 0, 0, 0.6)' : 'rgba(20, 32, 55, 0.85)';
        const depth = { classify: classOf };
        if (snowStyle === 'color') next = await picture(snowExport, (r, g, b) => SNOW_COLOR[classOf(r, g, b)], { shadow: isDark() ? 'rgba(0, 0, 0, 0.5)' : 'rgba(20, 32, 55, 0.6)', depth, smooth: SNOW_COLOR.slice(0, 8) });
        else if (snowStyle === 'volume') next = await picture(snowExport, (r, g, b) => SNOW_RAMP[classOf(r, g, b)], { shadow, depth, relief: true });
        else if (snowStyle === 'contours') {
          next = await picture(snowExport, (r, g, b) => SNOW_RAMP[classOf(r, g, b)], {
            shadow, depth, smooth: SNOW_RAMP.slice(0, 8), contours: { levels: [3, 4, 6], color: isDark() ? 'rgba(70, 90, 120, 0.8)' : 'rgba(60, 80, 110, 0.75)' },
          });
        } else next = await picture(snowExport, (r, g, b) => SNOW_RAMP[classOf(r, g, b)], { shadow, depth, smooth: SNOW_RAMP.slice(0, 8) });
      }
      else if (layerName === 'radar') {
        try {
          nextFrames = await radarLayer();
          next = L.layerGroup(nextFrames.map((f) => f.layer.setOpacity(0)));
        } catch {
          next = await picture(wms(RADAR_WMS), radarColor); // just the latest
        }
      } else if (layerName === 'outlook') next = await outlookLayer();
      else if (layerName === 'snowcast') next = await snowcastLayer();
    } catch { next = null; }
    if (mine !== job) return;
    overlay?.remove();
    overlay = next?.addTo(map) ?? null;
    frames = nextFrames;
    if (layerName === 'radar') {
      if (frames.length) {
        if (playing) play(true); else showFrame(frames.length - 1);
      } else onRadar?.({ time: null, playing: false, index: 0, count: 0 });
      // Live: new frames every 3 minutes while it's showing.
      radarTimer = setInterval(() => { if (!document.hidden) drawLayer(); }, 180000);
    } else {
      playing = false;
    }
  }

  // Towns for orientation, quieter than the resorts: small muted text by a tiny square. Most important
  // first; one that would touch a resort's label, hairline or dot (or a more important town) hides.
  map.createPane('places').style.zIndex = 580; // under the resort dots and labels
  const towns = places.map(([name, lat, lon, major]) => {
    const node = document.createElement('span');
    node.className = 'place';
    node.textContent = name;
    L.marker([lat, lon], { pane: 'places', interactive: false, keyboard: false, icon: L.divIcon({ html: node, className: 'place-host', iconSize: [0, 0] }) }).addTo(map);
    return { node, at: [lat, lon], major: Boolean(major) };
  });
  // The major towns' name boxes (container pixels), reserved before the resort labels are placed:
  // name to the right of the square, or to the left near the right edge.
  // (Only towns whose name fits on screen: the map is framed on the resorts, not the towns.)
  function reserveTowns(size, area) {
    const out = [];
    for (const t of towns) {
      t.fixed = null;
      if (!t.major) continue;
      const p = map.latLngToContainerPoint(t.at);
      t.node.hidden = false;
      t.node.dataset.side = 'right';
      const w = t.node.offsetWidth;
      const h = t.node.offsetHeight;
      const right = [p.x - 4, p.y - h / 2 - 1, p.x + w, p.y + h / 2 + 1];
      const left = [p.x - w, p.y - h / 2 - 1, p.x + 4, p.y + h / 2 + 1];
      const fits = (b) => b[0] >= area[0] && b[2] <= area[2] && b[1] >= area[1] && b[3] <= area[3];
      if (fits(right)) { t.fixed = 'right'; out.push(right); } else if (fits(left)) { t.fixed = 'left'; out.push(left); }
    }
    return out;
  }
  // Major highways: faint lines over the snow cover, and one small route shield per highway where it
  // fits (after the towns, so they never crowd anything).
  map.createPane('roads').style.zIndex = 255;
  let shields = [];
  function setRoads(data) {
    shields = [];
    for (const { ref, kind, lines } of data.routes) {
      // Interstates get an outline (casing) under them, like any road map.
      if (kind === 'I') L.polyline(lines, { pane: 'roads', className: 'road-casing', interactive: false, weight: 5 }).addTo(map);
      L.polyline(lines, { pane: 'roads', className: `road road-${kind}`, interactive: false, weight: kind === 'I' ? 2.6 : 1.6 }).addTo(map);
      // Spots for its shield: along its longest stretches, middle first.
      const spots = [...lines].sort((a, b) => b.length - a.length).slice(0, 4)
        .flatMap((l) => [0.5, 0.3, 0.7].map((f) => l[Math.floor((l.length - 1) * f)]));
      shields.push(spots.map((at) => {
        const node = document.createElement('span');
        node.className = `shield shield-${kind}`;
        node.textContent = ref;
        L.marker(at, { pane: 'places', interactive: false, keyboard: false, icon: L.divIcon({ html: node, className: 'place-host', iconSize: [0, 0] }) }).addTo(map);
        return node;
      }));
    }
    placeTowns();
  }

  function placeTowns() {
    const taken = [];
    for (const n of el.querySelectorAll('.pin:not(.hidden) .pin-bubble, .pin-dot, .pin:not(.hidden) .pin-tail line:not([style*="none"])')) taken.push(n.getBoundingClientRect());
    const overlaps = (a, b) => a.left < b.right + 3 && a.right > b.left - 3 && a.top < b.bottom + 3 && a.bottom > b.top - 3;
    const view = el.getBoundingClientRect();
    const pad = getPadding();
    const inside = (b) => b.left >= view.left + 4 && b.right <= view.right - 4 && b.top >= view.top + pad.top && b.bottom <= view.bottom - pad.bottom;
    for (const { node: t, fixed } of towns) {
      // Name to the right of its square, else left, below or above. Major towns keep the side their
      // space was reserved on (the resort labels already went around it).
      let ok = false;
      for (const side of fixed ? [fixed] : ['right', 'left', 'below', 'above']) {
        t.hidden = false;
        t.dataset.side = side;
        const box = t.getBoundingClientRect();
        if (fixed || (inside(box) && !taken.some((b) => b.width + b.height > 0 && overlaps(box, b)))) {
          taken.push(box);
          ok = true;
          break;
        }
      }
      t.hidden = !ok;
    }
    for (const spots of shields) {
      let shown = false;
      for (const n of spots) {
        n.hidden = false;
        const box = n.getBoundingClientRect();
        if (!shown && inside(box) && !taken.some((b) => b.width + b.height > 0 && overlaps(box, b))) {
          taken.push(box);
          shown = true;
        } else n.hidden = true;
      }
    }
  }

  const fit = () => {
    const p = getPadding();
    map.fitBounds(bounds, { paddingTopLeft: [p.left + EDGE_X, p.top + EDGE_Y], paddingBottomRight: [p.right + EDGE_X, p.bottom + EDGE_Y], animate: false });
  };
  fit();

  const pins = new Map();
  let order = [];

  function pinFor(r) {
    let pin = pins.get(r.id);
    if (pin) return pin;
    const root = document.createElement('div');
    root.className = 'pin';
    root.innerHTML = '<svg class="pin-tail" width="1" height="1" aria-hidden="true"><line/></svg>'
      + '<button type="button" class="pin-bubble"><b class="pin-val"></b><span class="pin-name"></span></button>';
    // Dots live on their own layer beneath every label, so no dot ever sits on top of a label.
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'pin-dot';
    dot.tabIndex = -1;
    dot.setAttribute('aria-hidden', 'true');
    // Select on the touch itself (a quick tap that barely moves), not the browser's later click event:
    // phones sometimes drop or delay that click (after a drag, or when it looks like a double-tap).
    // The click still works for mouse and keyboard; a tap already handled skips it.
    for (const node of [root, dot]) {
      let down = null;
      let handledAt = 0;
      node.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('button')) return;
        down = { x: e.clientX, y: e.clientY, t: performance.now() };
        L.DomEvent.stopPropagation(e);
      });
      node.addEventListener('pointerup', (e) => {
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        const quick = performance.now() - down.t < 800;
        down = null;
        if (moved > 12 || !quick) return;
        handledAt = performance.now();
        L.DomEvent.stopPropagation(e);
        onSelect(r.id);
      });
      node.addEventListener('pointercancel', () => { down = null; });
      node.addEventListener('click', (e) => {
        if (!e.target.closest('button')) return;
        L.DomEvent.stopPropagation(e);
        if (performance.now() - handledAt < 700) return;
        onSelect(r.id);
      });
    }
    L.marker(r.at, { pane: 'dots', icon: L.divIcon({ html: dot, className: 'pin-host', iconSize: [0, 0] }), keyboard: false }).addTo(map);
    const marker = L.marker(r.at, { icon: L.divIcon({ html: root, className: 'pin-host', iconSize: [0, 0] }), keyboard: false }).addTo(map);
    pin = {
      marker, root, dot, tail: root.querySelector('line'),
      bubble: root.querySelector('.pin-bubble'), val: root.querySelector('.pin-val'), name: root.querySelector('.pin-name'),
    };
    pins.set(r.id, pin);
    return pin;
  }

  // Label layout. Each label sits right beside its dot when there's room; otherwise it steps out a
  // little with a hairline back to the dot.
  // Hard rules: labels never overlap or cover any resort's point; hairlines never cross a label, each
  // other, or pass over another point; everything stays in the visible map.
  // Distances scale with the map you can see: a hairline may be at most ~10% of the visible map's
  // smaller side (28–90 px), so a small window never gets long, sprawling lines. If labels still don't
  // fit, the whole set is retried at 90% and then 82% size; a label that can't fit even then shows just
  // its number, and only failing that, hides (its dot stays).
  // Finished layouts are remembered (by screen size, padding and label texts, not which one is selected),
  // so tapping a resort, switching back to a view or re-rendering the same data is instant.
  // Never below ~9 px text: past that, a label shows just its number chip instead.
  const LABEL_SCALES = [1, 0.9, 0.82];
  const BUDGET_MS = 70; // per label size
  const layoutCache = new Map();
  function layout() {
    const size = map.getSize();
    const pad = getPadding();
    const key = JSON.stringify([size, pad, map.getZoom(), order.map((o) => [o.r.id, o.pin.bubble.textContent, o.pin.bubble.className.replace(/ (compact|is-selected)/g, ''), o.prio ?? 0]).sort()]);
    const cached = layoutCache.get(key);
    if (cached) {
      el.style.setProperty('--label-scale', cached.scale);
      return apply(cached.result);
    }
    let best = null;
    // Time budget: on a slow phone, settle for a slightly less polished layout instead of freezing.
    const start = performance.now();
    for (const [i, scale] of LABEL_SCALES.entries()) {
      el.style.setProperty('--label-scale', scale);
      const attempt = computeLayout(size, pad, start + BUDGET_MS * (i + 1));
      if (!best || attempt.misses < best.misses) best = { ...attempt, scale };
      if (attempt.misses === 0) break;
    }
    el.style.setProperty('--label-scale', best.scale);
    if (layoutCache.size > 40) layoutCache.clear();
    layoutCache.set(key, best);
    apply(best.result);
  }

  // One layout at the current label size → { result, misses } (misses: labels shown number-only or hidden).
  function computeLayout(size, pad, deadline) {
    const late = () => performance.now() > deadline;
    const area = [pad.left + 2, pad.top + 2, size.x - pad.right - 2, size.y - pad.bottom - 2];
    const maxLead = Math.max(28, Math.min(90, 0.1 * Math.min(area[2] - area[0], area[3] - area[1])));
    // Un-hide everything first: a label hidden by the last layout would measure as zero size.
    for (const o of order) o.pin.root.classList.remove('hidden');
    for (const o of order) o.pin.bubble.classList.remove('compact');
    const items = order.map((o) => ({ ...o, p: map.latLngToContainerPoint(o.r.at), w: o.pin.bubble.offsetWidth, h: o.pin.bubble.offsetHeight }));
    const dots = items.map((it) => it.p);
    const reserved = reserveTowns(size, area);
    const onTown = (box) => reserved.some((r) => box[0] < r[2] && box[2] > r[0] && box[1] < r[3] && box[3] > r[1]);
    const boxOf = (it, [dx, dy]) => [it.p.x + dx - it.w / 2 - GAP, it.p.y + dy - it.h / 2 - GAP, it.p.x + dx + it.w / 2 + GAP, it.p.y + dy + it.h / 2 + GAP];

    // Candidate spots for a label at its current width (recomputed if it falls back to chip-only).
    const buildCands = (it, relaxed = false) => {
      const spots = it.empty ? [] : spotsFor(it.w, it.h); // "no data" resorts show just a grey dot
      it.cands = [];
      for (const s of spots) {
        const box = boxOf(it, s);
        if (box[0] < area[0] || box[2] > area[2] || box[1] < area[1] || box[3] > area[3]) continue;
        // Hard rules: never cover another resort's point, and no pointer passing over one.
        if (dots.some((d) => d !== it.p && d.x + DOT_R + 1 > box[0] && d.x - DOT_R - 1 < box[2] && d.y + DOT_R + 1 > box[1] && d.y - DOT_R - 1 < box[3])) continue;
        if (onTown(box)) continue; // a major town's name is there
        const lead = it.empty ? { len: 0, seg: null } : leader(it, s);
        const tail = lead.seg ? { seg: lead.seg } : null;
        if (tail && reserved.some((r) => segRect(tail.seg, r))) continue;
        // (Relaxed, for the number-only fallback: a hairline may pass beside other points, and reach further.)
        if (!relaxed && tail && dots.some((d) => d !== it.p && segPointDist(tail.seg, d) < DOT_R + 3)) continue;
        // Labels that matter (open, favorite, filter match) may reach further when they must.
        if (lead.len > ((it.prio ?? 0) > 0 ? maxLead * 2.3 : relaxed ? maxLead * 1.5 : maxLead)) continue;
        // Distance from the dot (squared), a small preference for the classic spots, and a big one for
        // touching the dot: a hairline is only worth it when there's no room right beside it.
        it.cands.push({ s, box, tail, cost: lead.len * lead.len + (s[2] ?? 60) + (tail ? 1200 : 0) });
      }
      it.cands.sort((a, b) => a.cost - b.cost);
    };
    for (const it of items) {
      it.pin.bubble.classList.remove('compact');
      buildCands(it);
      it.nearest = it.cands[0] ?? null; // where it goes if selected but squeezed out (see apply)
      it.fullW = it.w;
    }

    const hit = (a, b) => a.box[0] < b.box[2] && a.box[2] > b.box[0] && a.box[1] < b.box[3] && a.box[3] > b.box[1];
    // Hard: labels overlapping, or a pointer running under another label.
    // Hard: labels overlapping, a hairline running under another label, or two hairlines crossing.
    const clash = (a, b) => hit(a, b)
      || (a.tail && segRect(a.tail.seg, b.box))
      || (b.tail && segRect(b.tail.seg, a.box))
      || (a.tail && b.tail && segSeg(a.tail.seg, b.tail.seg));
    const costOf = (it, c) => (c ? c.cost : 1e7);
    // "No data" dots take part too (on their dot only), so labels keep clear of them.
    const labels = items.filter((it) => it.cands.length);
    const pick = new Map();
    const free = (it, c) => labels.every((o) => o === it || !pick.get(o) || !clash(c, pick.get(o)));

    // 1) A layout where everything fits: crowded resorts first, each taking its cheapest free spot.
    //    Several orderings are tried; the one that hides the fewest labels (then is shortest) wins.
    const crowd = (it) => labels.filter((o) => Math.hypot(o.p.x - it.p.x, o.p.y - it.p.y) < 90).length;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let bestStart = null;
    for (let t = 0; t < 8 && !(t > 0 && late()); t++) {
      pick.clear();
      const seq = [...labels].sort((a, b) => crowd(b) - crowd(a) + (t ? (rand() - 0.5) * 6 : 0));
      let hidden = 0;
      for (const it of seq) {
        let c = null;
        let best = Infinity;
        for (const x of it.cands) {
          if (x.cost >= best) break; // sorted by cost: nothing cheaper further on
          if (!free(it, x)) continue;
          const v = costOf(it, x);
          if (v < best) { best = v; c = x; }
        }
        pick.set(it, c);
        if (!c) hidden++;
      }
      const cost = hidden * 1e7 + labels.reduce((a, it) => a + costOf(it, pick.get(it)), 0);
      if (!bestStart || cost < bestStart.cost) bestStart = { cost, picks: new Map(pick) };
    }
    pick.clear();
    for (const [k, v] of bestStart.picks) pick.set(k, v);

    // 2) Improve it: move one label at a time to another valid spot when that shortens things
    //    (sometimes accepting a worse move early on, to escape dead ends). Clashes are never allowed.
    //    The best layout seen is kept: stopping early (slow phone, time's up) never leaves a worse one.
    const total = () => labels.reduce((a, it) => a + costOf(it, pick.get(it)), 0);
    let bestSeen = { cost: total(), picks: new Map(pick) };
    let temp = 3000;
    for (let k = 0; k < 12000 && labels.length && !(k % 256 === 0 && late()); k++) {
      if (k % 256 === 255) {
        const now = total();
        if (now < bestSeen.cost) bestSeen = { cost: now, picks: new Map(pick) };
      }
      const it = labels[Math.floor(rand() * labels.length)];
      const next = it.cands[Math.floor(rand() * it.cands.length)];
      const cur = pick.get(it);
      if (next === cur || !free(it, next)) continue;
      const delta = costOf(it, next) - costOf(it, cur); // placing a hidden label is a huge win
      if (delta < 0 || rand() < Math.exp(-delta / temp)) pick.set(it, next);
      temp *= 0.9993;
    }
    if (total() > bestSeen.cost) { pick.clear(); for (const [k, v] of bestSeen.picks) pick.set(k, v); }
    // Then settle: each label moves to its cheapest free spot (closest, line-free if there's room),
    // until nothing improves. Quick, and it undoes any needless detour annealing left behind.
    const settle = () => {
      for (let pass = 0, moved = true; moved && pass < 6; pass++) {
        moved = false;
        for (const it of labels) {
          const cur = pick.get(it);
          for (const x of it.cands) {
            if (x.cost >= costOf(it, cur)) break; // sorted: nothing cheaper further on
            if (free(it, x)) { pick.set(it, x); moved = true; break; }
          }
        }
      }
    };
    settle();
    // Neighbors trade places: lift two nearby labels, re-seat them both (each order), and keep the
    // cheaper result. Catches "Copper above, Cooper below" swaps one-at-a-time moves can't make.
    const reseatBest = (it) => {
      let c = null;
      for (const x of it.cands) if (free(it, x)) { c = x; break; } // sorted: the first free is best
      return c;
    };
    // (Its own small time allowance past the deadline: a slow phone gets the swaps it has time for.)
    const swapPass = () => {
      for (let i = 0; i < labels.length && performance.now() < deadline + 40; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i];
          const b = labels[j];
          if (Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) > 160) continue;
          const was = [pick.get(a), pick.get(b)];
          // Only worth it when one of them has a hairline or no spot at all.
          if (was[0] && !was[0].tail && was[1] && !was[1].tail) continue;
          const before = costOf(a, was[0]) + costOf(b, was[1]);
          let best = null;
          for (const [x, y] of [[a, b], [b, a]]) {
            pick.set(a, null);
            pick.set(b, null);
            pick.set(x, reseatBest(x));
            pick.set(y, reseatBest(y));
            const cost = costOf(a, pick.get(a)) + costOf(b, pick.get(b));
            if (cost < before - 1 && (!best || cost < best.cost)) best = { cost, picks: [pick.get(a), pick.get(b)] };
          }
          const [pa, pb] = best ? best.picks : was;
          pick.set(a, pa);
          pick.set(b, pb);
        }
      }
    };
    swapPass();
    settle();

    // 3) Repair: for a label still squeezed out, take a spot anyway and re-seat the (few) labels in
    //    its way somewhere else. Kept only if every one of them finds a new spot.
    const bestFree = (it) => {
      let c = null;
      let best = Infinity;
      for (const x of it.cands) {
        if (!free(it, x)) continue;
        const v = costOf(it, x);
        if (v < best) { best = v; c = x; }
      }
      return c;
    };
    for (let round = 0; round < 3 && !(round > 0 && late()); round++) {
      for (const it of labels.filter((x) => !pick.get(x))) {
        // Spots needing the fewest labels moved come first.
        const options = it.cands
          .map((c) => ({ c, blockers: labels.filter((o) => o !== it && pick.get(o) && clash(c, pick.get(o))) }))
          .filter((o) => o.blockers.length <= 6)
          .sort((a, b) => a.blockers.length - b.blockers.length || a.c.cost - b.c.cost);
        for (const { c, blockers } of options) {
          const saved = blockers.map((o) => [o, pick.get(o)]);
          for (const o of blockers) pick.set(o, null);
          pick.set(it, c);
          let ok = true;
          for (const o of blockers) {
            const n = bestFree(o);
            if (!n) { ok = false; break; }
            pick.set(o, n);
          }
          if (ok) break;
          pick.set(it, null);
          for (const [o, v] of saved) pick.set(o, v);
        }
      }
    }

    // 4) Untangle: move a label to a better spot even if 1–3 labels are in the way, re-seat those
    //    elsewhere, and keep the change only if the labels involved end up closer overall.
    const near = (it) => it.cands.slice(0, 40);
    const reseat = (o) => {
      let c = null;
      let best = Infinity;
      for (const x of near(o)) {
        if (!free(o, x)) continue;
        const v = costOf(o, x);
        if (v < best) { best = v; c = x; }
      }
      return c;
    };
    for (let k = 0; k < 3500 && labels.length && !(k % 128 === 0 && late()); k++) {
      // Favour the labels that are furthest out.
      const a = labels[Math.floor(rand() * labels.length)];
      const b = labels[Math.floor(rand() * labels.length)];
      const it = (pick.get(a)?.cost ?? 1e7) >= (pick.get(b)?.cost ?? 1e7) ? a : b;
      const cur = pick.get(it);
      const opts = near(it);
      const c = opts[Math.floor(rand() * opts.length)];
      if (!c || c === cur || (cur && c.cost >= cur.cost)) continue;
      const blockers = labels.filter((o) => o !== it && pick.get(o) && clash(c, pick.get(o)));
      if (blockers.length > 4) continue;
      const group = [it, ...blockers];
      const before = group.reduce((a, o) => a + costOf(o, pick.get(o)), 0);
      const saved = group.map((o) => [o, pick.get(o)]);
      for (const o of blockers) pick.set(o, null);
      pick.set(it, c);
      if (!free(it, c)) { for (const [o, v] of saved) pick.set(o, v); continue; }
      for (const o of blockers) pick.set(o, reseat(o));
      const after = group.reduce((a, o) => a + costOf(o, pick.get(o)), 0);
      if (after >= before) for (const [o, v] of saved) pick.set(o, v);
    }
    swapPass();
    settle();

    // 4b) Priority: a label that matters more (filter match, favorite, open) still without a spot takes
    //     one from labels that matter less; they're re-seated elsewhere if possible, else go below.
    const prio = (it) => it.prio ?? 0;
    for (const it of labels.filter((x) => !pick.get(x) && prio(x) > 0).sort((a, b) => prio(b) - prio(a))) {
      // (A neighbor that matters as much may be moved too, but only if it keeps a full label.)
      for (const c of it.cands) {
        const blockers = labels.filter((o) => o !== it && pick.get(o) && clash(c, pick.get(o)));
        if (blockers.some((o) => prio(o) > prio(it)) || blockers.length > 8) continue;
        const saved = blockers.map((o) => [o, pick.get(o)]);
        for (const o of blockers) pick.set(o, null);
        pick.set(it, c);
        for (const o of blockers) pick.set(o, bestFree(o));
        if (blockers.every((o) => pick.get(o) || prio(o) < prio(it))) break;
        pick.set(it, null);
        for (const [o, v] of saved) pick.set(o, v);
      }
    }

    // 5) Still no room for name and number: show just the number chip (tap it for the resort).
    //    Most important first; one that matters (open, favorite, filter match) and still has no spot
    //    pushes less important labels down to number-only (they're placed again after it).
    const pending = items.filter((x) => !x.empty && !pick.get(x)).sort((a, b) => prio(b) - prio(a));
    for (const it of pending) {
      if (!it.compact) {
        it.compact = true;
        it.w = it.pin.val.offsetWidth;
        buildCands(it, true);
        if (!labels.includes(it)) labels.push(it);
      }
      let c = it.cands.find((x) => free(it, x));
      if (!c && prio(it) > 0) {
        for (const x of it.cands) {
          const blockers = labels.filter((o) => o !== it && pick.get(o) && clash(x, pick.get(o)));
          if (blockers.length > 3 || blockers.some((o) => prio(o) >= prio(it))) continue;
          for (const o of blockers) { pick.set(o, null); pending.push(o); }
          c = x;
          break;
        }
      }
      if (c) pick.set(it, c);
    }

    const misses = items.filter((it) => !it.empty && (it.compact || !pick.get(it))).length;
    const result = items.map((it) => {
      const c = pick.get(it);
      const n = it.nearest;
      return {
        pin: it.pin,
        alt: n && (it.compact || !c) ? {
          transform: `translate(${n.s[0] - it.fullW / 2}px, ${n.s[1] - it.h / 2}px)`,
          tail: n.tail ? n.tail.seg.map((v, k) => (v - (k % 2 ? it.p.y : it.p.x)).toFixed(1)) : null,
        } : null,
        compact: Boolean(it.compact),
        transform: c ? `translate(${c.s[0] - it.w / 2}px, ${c.s[1] - it.h / 2}px)` : null,
        tail: c?.tail ? c.tail.seg.map((v, k) => (v - (k % 2 ? it.p.y : it.p.x)).toFixed(1)) : null,
      };
    });
    return { result, misses };
  }

  // The selected resort always shows its full label: if the layout had no room for it, it sits at its
  // nearest spot on top of the others (it's raised above them) until something else is selected.
  let selectedPin = null;
  function apply(result) {
    requestAnimationFrame(placeTowns);
    for (const entry of result) {
      const { pin } = entry;
      const { transform, tail, compact } = pin === selectedPin && entry.alt ? { ...entry.alt, compact: false } : entry;
      pin.root.classList.toggle('hidden', !transform);
      pin.bubble.classList.toggle('compact', compact);
      pin.tail.style.display = tail ? '' : 'none';
      if (tail) {
        pin.tail.setAttribute('x1', tail[0]);
        pin.tail.setAttribute('y1', tail[1]);
        pin.tail.setAttribute('x2', tail[2]);
        pin.tail.setAttribute('y2', tail[3]);
      }
      if (transform) pin.bubble.style.transform = transform;
    }
  }

  // items: [{ r, text, label, level, open, selected }]
  function update(items) {
    selectedPin = null;
    order = items.map((item, i) => {
      const pin = pinFor(item.r);
      pin.val.textContent = item.text;
      pin.name.textContent = SHORT[item.r.id] ?? item.r.short ?? item.r.name;
      const empty = item.level === 'none';
      pin.bubble.className = `pin-bubble${item.open ? ' is-open' : ''}${item.selected ? ' is-selected' : ''}${empty ? ' is-empty' : ''}`;
      pin.val.className = `pin-val lvl-${item.level}`;
      pin.dot.classList.toggle('is-empty', empty);
      pin.dot.classList.toggle('is-selected', item.selected);
      pin.bubble.setAttribute('aria-label', `${item.r.name}: ${item.label}`);
      pin.marker.setZIndexOffset(item.selected ? 1000 : -i);
      if (item.selected) selectedPin = pin;
      // (Dimmed by CSS under "Open now"; not part of the layout, so nothing moves.)
      pin.root.classList.toggle('filtered-out', !item.match);
      pin.dot.classList.toggle('filtered-out', !item.match);
      return { ...item, pin, empty: item.level === 'none' };
    });
    layout();
  }

  map.on('click', () => onSelect(null));

  return {
    update,
    setRoads,
    // Light or dark relief to match the theme.
    setTheme() {
      if (baseKind === 'terrain') swapBase(); // (a satellite photo looks the same in both themes)
      if (layerName === 'snow') drawLayer(); // its edge depends on the theme
    },
    // Background: 'terrain', or a satellite photo ('sat' true color, 'satsnow' snow vs clouds) for a
    // date (YYYY-MM-DD).
    setBase(kind, date = null) {
      if (kind === baseKind && date === satDate) return;
      baseKind = kind;
      satDate = date;
      swapBase();
    },
    // Radar loop: play or pause (paused shows the newest frame).
    playRadar(on) {
      play(on);
    },
    // How snow on the ground is drawn: 'shaded', 'volume', 'contours' or 'color'.
    setSnowStyle(style) {
      if (style === snowStyle) return;
      snowStyle = style;
      if (layerName === 'snow') drawLayer();
    },
    // The snow forecast's day (1–3) and amount (4, 8 or 12 inches).
    setCast(day, amount) {
      cast = { day, amount };
      if (layerName === 'snowcast') drawLayer();
    },
    setLayer(name) {
      if (name === layerName && (overlay || name === 'none')) return;
      layerName = name;
      drawLayer();
    },
    // Switching states: remove this map entirely.
    destroy() {
      map.remove();
    },
    // Screen size or panels changed: refit everything and lay the labels out again.
    refit() {
      // No animated pan: the labels must be laid out from the map's final positions.
      map.invalidateSize({ animate: false, pan: false });
      fit();
      layout();
      frameCache.clear(); // pictures were for the old size
      if (layerName !== 'none') drawLayer();
    },
  };
}
