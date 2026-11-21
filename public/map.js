// The map: one fixed view of every Colorado resort (no panning or zooming). Each resort has a dot at
// its real spot and a light label beside it: a small colored chip with the number, then the name as
// plain outlined text. Every label has a short line to its dot, as short as the room allows (right
// side first).
const L = window.L;

// Esri's hillshade: just the mountains, no town names or roads to compete with the resorts, with a
// matching dark version. Free, no key.
const TILES = {
  light: 'https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
};
const isDark = () => document.documentElement.dataset.theme === 'dark';
// State lines (public/geo/state-lines.json: US Census boundaries via us-atlas, the West, ~1 km), loaded
// once for every map.
let stateLinesReq = null;
const stateLines = () => (stateLinesReq ??= fetch('geo/state-lines.json').then((r) => (r.ok ? r.json() : [])).catch(() => []));
// NASA GIBS: each day's real satellite photo (VIIRS, ~250 m, a few hours after the early-afternoon
// passes), free and keyless. 'sat' is true color (snow white, clouds white too); 'satsnow' is
// shortwave-infrared false color, where snow shows bright cyan and clouds stay white.
// One satellite's swath often misses part of Colorado (GIBS sends those parts black), so the photo is
// pieced together: NOAA-21, then NOAA-20 where 21 has nothing, then the day before for what's left.
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const SAT_BANDS = { sat: 'CorrectedReflectance_TrueColor', satsnow: 'CorrectedReflectance_BandsM11-I2-I1' };
const SATS = ['VIIRS_NOAA21', 'VIIRS_NOAA20'];
const gibsTile = (sat, kind, date) => `${GIBS}/${sat}_${SAT_BANDS[kind]}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
export const satTile = (kind, date) => gibsTile(SATS[0], kind, date);
const dayBefore = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
const loadImage = (src) => new Promise((ok) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => ok(img);
  img.onerror = () => ok(null);
  img.src = src;
});
const SatLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const size = this.getTileSize();
    const tile = document.createElement('canvas');
    tile.width = size.x;
    tile.height = size.y;
    const { kind, date } = this.options;
    const sources = [date, dayBefore(date)].flatMap((d) => SATS.map((sat) => gibsTile(sat, kind, d)));
    const ctx = tile.getContext('2d', { willReadFrequently: true });
    let out = null; // the pieced-together pixels
    let missing = Infinity;
    (async () => {
      for (const tpl of sources) {
        const img = await loadImage(L.Util.template(tpl, coords));
        if (!img) continue;
        if (!out) {
          ctx.drawImage(img, 0, 0, size.x, size.y);
          out = ctx.getImageData(0, 0, size.x, size.y);
        } else {
          ctx.clearRect(0, 0, size.x, size.y);
          ctx.drawImage(img, 0, 0, size.x, size.y);
          const add = ctx.getImageData(0, 0, size.x, size.y).data;
          const px = out.data;
          for (let i = 0; i < px.length; i += 4) if (empty(px, i) && !empty(add, i)) { px[i] = add[i]; px[i + 1] = add[i + 1]; px[i + 2] = add[i + 2]; }
        }
        missing = 0;
        for (let i = 0; i < out.data.length; i += 16) if (empty(out.data, i)) missing++;
        if (!missing) break;
      }
      if (out) ctx.putImageData(out, 0, 0);
      done(null, tile);
    })();
    return tile;
  },
});
// No data: black (JPEG blurs the edge a little, so near-black counts too).
const empty = (px, i) => px[i] < 10 && px[i + 1] < 10 && px[i + 2] < 10;
// Fine terrain shading laid over the satellite photo (multiplied in CSS) so ridges stay crisp.
const SHADE = 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';
// Shown behind the ⓘ button instead of a permanent banner.
export const CREDITS = 'Hillshade © <a href="https://www.esri.com">Esri</a> and its data partners (USGS, NASA, NGA, CGIAR and others) · '
  + 'satellite: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> (VIIRS, NOAA-21 and NOAA-20) · '
  + 'highways © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · '
  + 'snow cover: <a href="https://www.nohrsc.noaa.gov/nsa/">NOAA NOHRSC</a> · radar: <a href="https://www.nssl.noaa.gov/projects/mrms/">NOAA MRMS</a> · clouds: <a href="https://nowcoast.noaa.gov/">NOAA nowCOAST</a> (GOES-East) · '
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
// Clouds under the radar: GOES-East longwave infrared every 5 minutes (NOAA nowCOAST), so they show
// day and night; cold (high, thick) cloud is bright in it, the ground dark. Shown as soft white cloud.
const CLOUDS_WMS = 'https://nowcoast.noaa.gov/geoserver/satellite/wms';
const CLEAR = [0, 0, 0, 0];
const cloudColor = (r) => {
  const a = Math.max(0, Math.min(1, (r - 125) / 95));
  return a < 0.04 ? CLEAR : [236, 240, 246, Math.round(a ** 1.3 * 125)];
};
const RADAR_STOPS = [[124, 137, 175], [80, 104, 163], [70, 170, 190], [40, 180, 80], [20, 130, 40], [230, 220, 40], [240, 140, 20], [220, 30, 30], [200, 40, 200]];
// (Saturated from the lightest step up: falling snow has to stand out on the white clouds under it.)
export const RADAR_RAMP = [
  [95, 200, 255, 175], [60, 175, 255, 200], [35, 145, 250, 215], [30, 115, 240, 225], [55, 85, 235, 232],
  [95, 65, 228, 236], [135, 50, 220, 240], [175, 40, 210, 244], [210, 35, 190, 248],
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
// The snow forecast's amounts (inches in 24 hours) and its contours: 10 %, 40 % and 70 % chance,
// nested, each a light wash so overlaps darken with the chance.
export const CAST_AMOUNTS = [1, 2, 6, 12];

// NOAA Climate Prediction Center: odds of a wetter or drier than normal next 3 months (lead 1).
const OUTLOOK = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_sea_precip_outlk/MapServer/0/query';
// Shades by probability (33–40%, 40–50%, 50–60%, 60%+): wetter in blues, drier in tans.
const OUTLOOK_SHADES = {
  Above: ['#b9d7f2', '#86b8e8', '#4f93d8', '#2a6fbe'],
  Below: ['#f1dcb6', '#e3bd7f', '#cf9548', '#a96a24'],
};

const GAP = 1; // (each side: labels sit 2 px apart)
const DOT_R = 4;
// Every label has a line to its dot, one look for all of them (so it's always clear which dot a label
// belongs to), and the lines are as short as the room allows: at least STUB px between the dot's rim
// and the label.
const STUB = 6;
// Margin around the resorts when fitting them (labels stick out sideways more than up and down).
const EDGE_X = 30;
const EDGE_Y = 14;

const SHORT = {
  'arapahoe-basin': 'A-Basin', 'copper-mountain': 'Copper', breckenridge: 'Breck', 'beaver-creek': 'Beaver Cr',
  'echo-mountain': 'Echo', 'granby-ranch': 'Granby', 'howelsen-hill': 'Howelsen', 'aspen-mountain': 'Aspen Mtn',
  'aspen-highlands': 'Highlands', 'crested-butte': 'Crested Butte', cooper: 'Cooper', 'winter-park': 'Winter Park',
};

// Where a label may sit, as its center relative to the dot. First the spots nearest the dot, the
// shortest line away (right, left, above, below, slid along each side, corners), then a fine grid
// further out for crowded clusters. Nothing nearer the dot than the short line.
function spotsFor(w, h) {
  const gx = w / 2 + DOT_R + 1 + STUB;
  const gy = h / 2 + DOT_R + 1 + STUB;
  const out = [
    [gx, 0, 0], [-gx, 0, 15], [0, -gy, 25], [0, gy, 30],
    // (Slid along each side, the dot still facing the label: past a neighbor's dot or label.)
    ...[-0.4, -0.2, 0.2, 0.4].flatMap((f) => [[f * w, -gy, 28], [f * w, gy, 33]]),
    ...[-0.3, 0.3].flatMap((f) => [[gx, f * h, 5], [-gx, f * h, 20]]),
    [gx - 6, -gy + 2, 35], [gx - 6, gy - 2, 40], [-gx + 6, -gy + 2, 45], [-gx + 6, gy - 2, 50],
  ];
  for (let dx = -Math.round(1.5 * w); dx <= 1.5 * w; dx += 8) {
    for (let j = -12; j <= 12; j++) {
      const dy = j * (h / 2 + 1);
      if (Math.abs(dx) < gx && Math.abs(dy) < gy) continue; // nearer than the short line
      out.push([dx, dy, 60]);
    }
  }
  return out;
}

// A label at offset s, and the line from its nearest edge (just under it) to the rim of its dot.
function leader(it, [dx, dy]) {
  const l = it.p.x + dx - it.w / 2;
  const t = it.p.y + dy - it.h / 2;
  const nx = Math.min(l + it.w - 2, Math.max(l + 2, it.p.x));
  const ny = Math.min(t + it.h - 2, Math.max(t + 2, it.p.y));
  const vx = nx - it.p.x;
  const vy = ny - it.p.y;
  const len = Math.hypot(vx, vy);
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

// labelSides: { resortId: 'N' | 'S' | 'E' | 'W' }: a side a resort's label should sit on, where the
// short-line layout alone reads ambiguously (Aspen's tight cluster).
// getObstacles(size) → [[left, top, right, bottom]…]: the map's own floating buttons, in map pixels
// (no label or line goes under them).
// frame: [[s, w], [n, e]] to show instead of the resorts' own extent (the West).
// west: { areas, onPick(code), onDismiss() }: the map of every area (no resort labels: a bubble per
// area, its resorts as dots; see setAreas), with all the same layers as an area's map.
export function createSnowMap(el, { resorts, onSelect, getPadding, extend, places = [], onOutlook, onRadar, onCast, labelSides = {}, getObstacles = () => [], frame = null, west = null }) {
  const bounds = frame ? L.latLngBounds(frame) : L.latLngBounds(resorts.map((r) => r.at));
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
      : new SatLayer({ kind: baseKind, date: satDate, maxZoom: 13, maxNativeZoom: 9 });
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
  async function picture(src, recolor, { shadow = null, depth = null, relief = false, contours = null, smooth = null, maxCell = Infinity } = {}) {
    const size = map.getSize();
    const b = map.getPixelBounds();
    const sw = map.options.crs.project(map.unproject(L.point(b.min.x, b.max.y)));
    const ne = map.options.crs.project(map.unproject(L.point(b.max.x, b.min.y)));
    // About NOAA's own 1 km grid at this zoom (finer just shows its squares as stair-steps); smooth
    // upscaling below turns the squares into clean rounded edges.
    // (maxCell: the coarsest picture, in meters per pixel, a service will draw; NOAA's snow comes back
    // blank past about 10 km, which a phone-sized picture of the whole US would be.)
    const k = Math.max(1, (ne.x - sw.x) / (size.x / 2.5) / maxCell);
    const w = Math.max(1, Math.round((size.x / 2.5) * k));
    const h = Math.max(1, Math.round((size.y / 2.5) * k));
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
    // How much of the picture has anything on it (radar frames NOAA lists before they're ready come back blank).
    let painted = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] >= 8) painted++;
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
    // (Encoded off the main thread, unlike toDataURL; the memory's freed when the picture is dropped.)
    const blob = await new Promise((done) => big.toBlob(done, 'image/png'));
    const url = URL.createObjectURL(blob);
    const overlay = L.imageOverlay(url, map.getBounds(), { pane: 'snow', interactive: false });
    overlay.coverage = painted / (w * h);
    overlay.dispose = () => URL.revokeObjectURL(url);
    return overlay;
  }
  async function outlookLayer() {
    if (!outlookData) {
      const q = new URLSearchParams({
        where: '1=1', outFields: 'cat,prob,valid_seas', f: 'geojson', outSR: '4326', maxAllowableOffset: '0.02',
        // (Around this area's resorts, with room to spare: the map shows more than just them.)
        geometry: (() => { const b = bounds.pad(1); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(2)).join(','); })(),
        geometryType: 'esriGeometryEnvelope', inSR: '4326',
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
  let frames = []; // [{ t, layer, clouds }] oldest first
  const frameCache = new Map(); // time → overlay (cleared when the map's size changes)
  const cloudCache = new Map(); // time → cloud overlay (or null when the satellite didn't answer)
  // (A frame leaving the cache: its pictures' memory is freed.)
  const dropFrame = (t) => { frameCache.get(t)?.dispose?.(); cloudCache.get(t)?.dispose?.(); frameCache.delete(t); cloudCache.delete(t); };
  const cloudSrc = (t) => (w, h, sw, ne) => `${CLOUDS_WMS}?${new URLSearchParams({
    service: 'WMS', version: '1.3.0', request: 'GetMap', layers: 'goes_longwave_imagery', styles: '', crs: 'EPSG:3857',
    bbox: [sw.x, sw.y, ne.x, ne.y].join(','), width: w, height: h, format: 'image/png', time: new Date(t).toISOString(),
  })}`;
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
    frames.forEach((f, k) => { f.layer.setOpacity(k === i ? 1 : 0); f.clouds?.setOpacity(k === i ? 1 : 0); });
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
      const [radar, clouds] = await Promise.all([
        frameCache.get(t) ?? picture(radarSrc(t), radarColor, { shadow: isDark() ? 'rgba(0, 0, 0, 0.7)' : 'rgba(12, 28, 70, 0.6)' }),
        cloudCache.has(t) ? cloudCache.get(t) : picture(cloudSrc(t), cloudColor).catch(() => null),
      ]);
      frameCache.set(t, radar);
      cloudCache.set(t, clouds);
      return { t, layer: radar, clouds };
    }));
    for (const t of [...frameCache.keys()]) if (!times.includes(t)) dropFrame(t);
    // NOAA lists its newest times a little before their pictures are ready, and those come back blank:
    // a frame far emptier than the others is left out (and not kept, so the next refresh tries again).
    const covs = built.map((f) => f.layer.coverage).sort((a, b) => a - b);
    const median = covs[Math.floor(covs.length / 2)] ?? 0;
    const good = median > 0.005 ? built.filter((f) => f.layer.coverage >= median * 0.3) : built;
    for (const f of built) if (!good.includes(f)) dropFrame(f.t);
    return good;
  }

  // Snow forecast areas for a day (1–3) and amount (4, 8, 12), cached per pair.
  let cast = { day: 1, amount: 1 };
  // (The build's copy of the Weather Prediction Center's contours: data/snowcast.json, see
  // src/snowcast.js. Fetched once, then again after an hour.)
  let castFile = null;
  const castData = async (day, amount) => {
    if (!castFile || Date.now() - castFile.at > 3_600_000) {
      castFile = { at: Date.now(), data: await (await fetch(`data/snowcast.json?t=${Math.floor(Date.now() / 600000)}`)).json() };
    }
    const d = castFile.data.days?.find((x) => x.day === day);
    return { features: d?.amounts?.[amount] ?? [], start: d?.start ?? null };
  };
  async function snowcastLayer() {
    // (Only areas on the visible map count: the query covers the neighboring states too.)
    const view = map.getBounds();
    const onMap = (d) => (d.features ?? []).filter((f) => L.geoJSON(f).getBounds().intersects(view)).length;
    const data = await castData(cast.day, cast.amount);
    const areas = onMap(data);
    // (Whether any amount has areas: with none at the smallest, there's nothing to choose between.)
    const any = cast.amount === CAST_AMOUNTS[0] ? areas > 0 : onMap(await castData(cast.day, CAST_AMOUNTS[0])) > 0;
    onCast?.({ ...cast, areas, any, start: data.start });
    return L.geoJSON({ type: 'FeatureCollection', features: data.features }, {
      pane: 'snow', interactive: false,
      style: () => ({ className: 'snowcast', stroke: true, weight: 0.8, color: '#7c3aed', opacity: 0.5, fillColor: '#8b5cf6', fillOpacity: 0.24 }),
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
        if (snowStyle === 'color') next = await picture(snowExport, (r, g, b) => SNOW_COLOR[classOf(r, g, b)], { shadow: isDark() ? 'rgba(0, 0, 0, 0.5)' : 'rgba(20, 32, 55, 0.6)', depth, maxCell: 8000, smooth: SNOW_COLOR.slice(0, 8) });
        else if (snowStyle === 'volume') next = await picture(snowExport, (r, g, b) => SNOW_RAMP[classOf(r, g, b)], { shadow, depth, maxCell: 8000, relief: true });
        else if (snowStyle === 'contours') {
          next = await picture(snowExport, (r, g, b) => SNOW_RAMP[classOf(r, g, b)], {
            shadow, depth, maxCell: 8000, smooth: SNOW_RAMP.slice(0, 8), contours: { levels: [3, 4, 6], color: isDark() ? 'rgba(70, 90, 120, 0.8)' : 'rgba(60, 80, 110, 0.75)' },
          });
        } else next = await picture(snowExport, (r, g, b) => SNOW_RAMP[classOf(r, g, b)], { shadow, depth, maxCell: 8000, smooth: SNOW_RAMP.slice(0, 8) });
      }
      else if (layerName === 'radar') {
        try {
          nextFrames = await radarLayer();
          // (Each frame's clouds first, so its radar sits on top.)
          next = L.layerGroup(nextFrames.flatMap((f) => [f.clouds?.setOpacity(0), f.layer.setOpacity(0)]).filter(Boolean));
        } catch {
          next = await picture(wms(RADAR_WMS), radarColor); // just the latest
        }
      } else if (layerName === 'outlook') next = await outlookLayer();
      else if (layerName === 'snowcast') next = await snowcastLayer();
    } catch { next = null; }
    if (mine !== job) { next?.dispose?.(); return; }
    overlay?.remove();
    overlay?.dispose?.(); // (a single picture: its memory freed; radar frames stay cached)
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
  // (places: [name, lat, lon, major, resortTown, kind]: a resort's own town shows only with the labels
  // off; kind 'state': a state's name, quiet, centered on its spot, placed last.)
  // (A state can also have alts: [[lat, lon]…], other spots to try when its first is taken.)
  const towns = places.map(([name, lat, lon, major, resortTown, kind, alts = []]) => {
    const node = document.createElement('span');
    node.className = kind === 'state' ? 'place state-name' : 'place';
    node.textContent = name;
    const marker = L.marker([lat, lon], { pane: 'places', interactive: false, keyboard: false, icon: L.divIcon({ html: node, className: 'place-host', iconSize: [0, 0] }) }).addTo(map);
    return { node, marker, at: [lat, lon], alts, major: Boolean(major), resortTown: Boolean(resortTown), state: kind === 'state' };
  });
  // State lines: thin and quiet, over the relief and the snow (under the labels).
  map.createPane('stateLines').style.zIndex = 256;
  stateLines().then((lines) => {
    if (!lines.length) return;
    const ll = lines.map((l) => l.map(([lon, lat]) => [lat, lon]));
    // (A soft halo under the dashes, so the line reads over snow, radar and the outlook alike.)
    L.polyline(ll, { pane: 'stateLines', className: 'state-halo', weight: 3, interactive: false }).addTo(map);
    L.polyline(ll, { pane: 'stateLines', className: 'state-line', weight: 1.2, interactive: false }).addTo(map);
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
    // (All the writes, then all the reads, then the decisions, then the writes: the browser lays the
    // page out once, not once per town and side tried.)
    const view = el.getBoundingClientRect();
    for (const t of towns) { t.node.hidden = false; t.node.dataset.side = t.state ? 'C' : 'right'; if (t.alts.length) t.marker.setLatLng(t.at); }
    for (const spots of shields) for (const n of spots) n.hidden = false;
    const taken = [];
    for (const n of el.querySelectorAll('.pin:not(.hidden) .pin-bubble, .pin-dot, .pin:not(.hidden) .pin-tail line:not([style*="none"]), .west-bubble')) taken.push(n.getBoundingClientRect());
    const rights = towns.map(({ node }) => node.getBoundingClientRect());
    const shieldBoxes = shields.map((spots) => spots.map((n) => n.getBoundingClientRect()));
    const overlaps = (a, b) => a.left < b.right + 3 && a.right > b.left - 3 && a.top < b.bottom + 3 && a.bottom > b.top - 3;
    const pad = getPadding();
    const inside = (b) => b.left >= view.left + 4 && b.right <= view.right - 4 && b.top >= view.top + pad.top && b.bottom <= view.bottom - pad.bottom;
    // Each side's box from the right-hand one: mirrored for left; for above and below, the name
    // (without the square) centered over or under the square.
    const boxFor = (r, a, side) => {
      if (side === 'right' || side === 'C') return r; // (a state's name: measured where it sits)
      if (side === 'left') return { left: 2 * a.x - r.right, right: 2 * a.x - r.left, top: r.top, bottom: r.bottom };
      const w = r.right - r.left - 9;
      const h = r.bottom - r.top + 7;
      const top = side === 'below' ? a.y - 3 : a.y + 3 - h;
      return { left: a.x - w / 2, right: a.x + w / 2, top, bottom: top + h };
    };
    const labelsOff = el.classList.contains('labels-off');
    const spotOf = new Map(); // a state placed at one of its other spots → that spot
    const sides = towns.map((t, i) => {
      if (t.resortTown && !labelsOff) return null;
      const p = map.latLngToContainerPoint(t.at);
      const a = { x: view.left + p.x, y: view.top + p.y };
      if (t.state) {
        // Its spots in turn (the name measured at the first, moved to each): the first that's clear.
        for (const at of [t.at, ...t.alts]) {
          const q = map.latLngToContainerPoint(at);
          const r = rights[i];
          const box = { left: r.left + q.x - p.x, right: r.right + q.x - p.x, top: r.top + q.y - p.y, bottom: r.bottom + q.y - p.y };
          if (inside(box) && !taken.some((b) => b.width + b.height > 0 && overlaps(box, b))) {
            taken.push({ ...box, width: box.right - box.left, height: box.bottom - box.top });
            if (at !== t.at) spotOf.set(t, at);
            return 'C';
          }
        }
        return null;
      }
      for (const side of t.fixed ? [t.fixed] : t.state ? ['C'] : ['right', 'left', 'below', 'above']) {
        const box = boxFor(rights[i], a, side);
        if (t.fixed || (inside(box) && !taken.some((b) => b.width + b.height > 0 && overlaps(box, b)))) {
          // (Copied field by field: a DOMRect's fields aren't its own, so {...box} would be empty.)
          taken.push({ left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.right - box.left, height: box.bottom - box.top });
          return side;
        }
      }
      return null;
    });
    const shown = shieldBoxes.map((boxes) => {
      const k = boxes.findIndex((box) => inside(box) && !taken.some((b) => b.width + b.height > 0 && overlaps(box, b)));
      if (k >= 0) taken.push(boxes[k]);
      return k;
    });
    towns.forEach((t, i) => {
      t.node.hidden = !sides[i];
      if (sides[i]) t.node.dataset.side = sides[i];
      if (spotOf.has(t)) t.marker.setLatLng(spotOf.get(t));
    });
    shields.forEach((spots, i) => spots.forEach((n, k) => { n.hidden = k !== shown[i]; }));
  }

  // (The West: more room at the sides, for the bubbles beside each area.)
  const [ex, ey] = west ? [64, 30] : [EDGE_X, EDGE_Y];
  const fit = () => {
    const p = getPadding();
    map.fitBounds(bounds, { paddingTopLeft: [p.left + ex, p.top + ey], paddingBottomRight: [p.right + ex, p.bottom + ey], animate: false });
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
        // A label is exactly one resort; a dot may sit among others: pick from what's under the finger.
        if (node === dot) pickNear(e.clientX, e.clientY);
        else onSelect(r.id);
      });
      node.addEventListener('pointercancel', () => { down = null; });
      node.addEventListener('click', (e) => {
        if (!e.target.closest('button')) return;
        L.DomEvent.stopPropagation(e);
        if (performance.now() - handledAt < 700) return;
        if (node === dot) pickNear(e.clientX, e.clientY);
        else onSelect(r.id);
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
  // The label font (style.css) arriving after a first layout would change every label's width: lay
  // out again once it's in.
  document.fonts?.load("700 12px 'Powdar Labels'").then(() => { layoutCache.clear(); if (order.length) layout(); }).catch(() => {});
  const BUDGET_MS = 160; // the finished layout
  const TRIAL_MS = 70; // each label size's trial (only to see how many fit)
  const layoutCache = new Map();
  // Finished layouts are also kept on the device (they take a moment to work out, and come out the
  // same for the same screen, padding and labels): a reload or a view switch is then instant. Bump
  // the version whenever the layout itself changes.
  const SAVED = 'powdar:layouts';
  const LAYOUT_VERSION = 11;
  const savedLayout = (key) => {
    try {
      const entry = JSON.parse(localStorage.getItem(SAVED) ?? '{}')[key];
      if (!entry) return null;
      const result = entry.result.map((e) => ({ ...e, pin: pins.get(e.id) }));
      return result.every((e) => e.pin) ? { scale: entry.scale, result } : null;
    } catch { return null; }
  };
  const saveLayout = (key, { scale, result }) => {
    // (Not until the label font is in: a layout measured with a stand-in font would be wrong later.)
    if (document.fonts && !document.fonts.check("800 12px 'Powdar Labels'")) return;
    try {
      const all = JSON.parse(localStorage.getItem(SAVED) ?? '{}');
      all[key] = { scale, result: result.map(({ pin, ...e }) => e), at: Date.now() };
      // (The 8 most recent: a phone sees a few screen heights, the address bar showing or not.)
      const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 8);
      localStorage.setItem(SAVED, JSON.stringify(Object.fromEntries(keep)));
    } catch { /* storage full or off: just not kept */ }
  };
  let laidOutHidden = false;
  function layout() {
    // (Labels turned off measure 0 px wide: lay them out when they're shown again, not now.)
    if (el.classList.contains('labels-off')) { laidOutHidden = true; return; }
    const size = map.getSize();
    const pad = getPadding();
    // (Every number any label shows, in any view: the chips' one width comes from the widest of them.)
    const texts = [...new Set(order.flatMap((o) => o.texts ?? []))].sort();
    const key = JSON.stringify([LAYOUT_VERSION, labelSides, getObstacles(size), size, pad, map.getZoom(), texts, order.map((o) => [o.r.id, o.prio ?? 0]).sort()]);
    const cached = layoutCache.get(key) ?? savedLayout(key);
    if (cached) layoutCache.set(key, cached);
    if (cached) {
      el.style.setProperty('--label-scale', cached.scale);
      return apply(cached.result);
    }
    let best = null;
    // Time budget: on a slow phone, settle for a slightly less polished layout instead of freezing.
    const start = performance.now();
    // Each size first without the costly finishing steps (far-out names, map order); then those run
    // once, at the size that fit best.
    // Every size is tried; the best is the one with the fewest labels that don't fit, then the
    // shortest hairlines (labels close to their dots). Smaller text costs a lot: full size wins unless
    // a smaller size really is needed to fit names.
    // (A name lost to number-only costs more than text 10 % smaller: on a small phone, every name
    // shows, a touch smaller, rather than one going missing.)
    const score = (a, scale) => a.misses * 600 + a.length + (1 - scale) * 5000;
    for (const [i, scale] of LABEL_SCALES.entries()) {
      el.style.setProperty('--label-scale', scale);
      const attempt = computeLayout(size, pad, start + TRIAL_MS * (i + 1), false);
      if (!best || score(attempt, scale) < score(best, best.scale)) best = { ...attempt, scale, i };
      if (best.misses === 0) break; // (every name fits at this size: smaller text can't do better)
    }
    el.style.setProperty('--label-scale', best.scale);
    // The finished layout from a few different random starts (the search can settle differently
    // from each); the best one wins.
    const scale = best.scale;
    best = null;
    for (const seed of [7, 101, 2027]) {
      const attempt = computeLayout(size, pad, performance.now() + BUDGET_MS / 3, true, seed);
      if (!best || attempt.score < best.score) best = { ...attempt, scale };
    }
    // Still a name squeezed to its number (a small or slow phone): the next size down too, kept if it
    // shows every name. (A hidden name is worse than slightly smaller text.)
    // (First two more tries at this size, then each smaller size: three tries apiece, as above. Only
    // when a name would otherwise go missing, so it costs nothing the rest of the time.)
    const tries = [[scale, 31], [scale, 4099], ...LABEL_SCALES.slice(LABEL_SCALES.indexOf(scale) + 1).flatMap((k) => [[k, 7], [k, 101], [k, 2027]])];
    for (const [k, seed] of tries) {
      if (best.misses === 0) break;
      el.style.setProperty('--label-scale', k);
      const attempt = { ...computeLayout(size, pad, performance.now() + BUDGET_MS / 3, true, seed), scale: k };
      if (attempt.misses < best.misses || (attempt.misses === best.misses && attempt.scale === best.scale && attempt.score < best.score)) best = attempt;
    }
    el.style.setProperty('--label-scale', best.scale);
    if (layoutCache.size > 40) layoutCache.clear();
    layoutCache.set(key, best);
    // (Kept on the device only when every name fits: one squeezed by a busy moment gets another try
    // next time, instead of being kept for good.)
    if (best.misses === 0) saveLayout(key, best);
    apply(best.result);
  }

  // One layout at the current label size → { result, misses } (misses: labels shown number-only or hidden).
  function computeLayout(size, pad, deadline, finish = true, startSeed = 7) {
    const late = () => performance.now() > deadline;
    const area = [pad.left + 2, pad.top + 2, size.x - pad.right - 2, size.y - pad.bottom - 2];
    const maxLead = Math.max(28, Math.min(90, 0.1 * Math.min(area[2] - area[0], area[3] - area[1])));
    // Un-hide everything first: a label hidden by the last layout would measure as zero size.
    for (const o of order) o.pin.root.classList.remove('hidden');
    for (const o of order) o.pin.bubble.classList.remove('compact');
    // Every number chip is the same width, the widest number any label shows in any view, so the
    // labels look alike and every view gets the same layout: switching views never moves a label (or
    // the name beside its number). Placed in a fixed order, for the same reason.
    const probe = order[0]?.pin.val;
    let chipW = 0;
    if (probe) {
      const shown = probe.textContent;
      probe.style.minWidth = '';
      for (const t of new Set(order.flatMap((o) => o.texts ?? [o.pin.val.textContent]))) { probe.textContent = t; chipW = Math.max(chipW, probe.offsetWidth); }
      probe.textContent = shown;
    }
    // (All the writes, then all the reads: one layout pass, not one per label.)
    for (const o of order) o.pin.val.style.minWidth = `${chipW}px`;
    const sizes = new Map(order.map((o) => [o, { w: o.pin.bubble.offsetWidth, h: o.pin.bubble.offsetHeight, valW: chipW }]));
    const measure = (o) => sizes.get(o);
    const items = [...order].sort((a, b) => a.r.id.localeCompare(b.r.id))
      .map((o) => ({ ...o, empty: false, p: map.latLngToContainerPoint(o.r.at), ...measure(o) }));
    const dots = items.map((it) => it.p);
    // Each resort's way out of its cluster: from the middle of its neighbors (within 70 px) to it.
    const OUTWARD = 600;
    for (const it of items) {
      const nb = items.filter((o) => o !== it && Math.hypot(o.p.x - it.p.x, o.p.y - it.p.y) < 70);
      if (!nb.length) { it.away = null; continue; }
      const cx = nb.reduce((t, o) => t + o.p.x, 0) / nb.length;
      const cy = nb.reduce((t, o) => t + o.p.y, 0) / nb.length;
      const d = Math.hypot(it.p.x - cx, it.p.y - cy);
      it.away = d > 3 ? [(it.p.x - cx) / d, (it.p.y - cy) / d] : null;
    }
    const reserved = [...reserveTowns(size, area), ...getObstacles(size)];
    const onTown = (box) => reserved.some((r) => box[0] < r[2] && box[2] > r[0] && box[1] < r[3] && box[3] > r[1]);
    const boxOf = (it, [dx, dy]) => [it.p.x + dx - it.w / 2 - GAP, it.p.y + dy - it.h / 2 - GAP, it.p.x + dx + it.w / 2 + GAP, it.p.y + dy + it.h / 2 + GAP];

    // Candidate spots for a label at its current width (recomputed if it falls back to chip-only).
    const buildCands = (it, relaxed = false, far = false) => {
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
        // (A dot right against this one may be grazed, as any line out of the pair must; one overlapping
        // it, like Buttermilk's and Highlands', reads as the same spot and doesn't count.)
        const clear = (d) => { const apart = Math.hypot(d.x - it.p.x, d.y - it.p.y); return apart < 2 * DOT_R + 1 ? 0 : apart < 14 ? DOT_R - 1 : DOT_R + 3; };
        if (!relaxed && tail && dots.some((d) => d !== it.p && segPointDist(tail.seg, d) < clear(d))) continue;
        // Labels that matter (open, favorite, filter match) may reach further when they must.
        // (Far: the last try for a full name before number-only.)
        if (lead.len > (far ? maxLead * 3.2 : (it.prio ?? 0) > 0 ? maxLead * 2.3 : relaxed ? maxLead * 1.5 : maxLead)) continue;
        // The line's length (squared, and steeper past a short line: one long line is worse than several
        // a little longer), and a small
        // preference for the classic spots. Outward: in a cluster, a label pointing back across its
        // neighbors costs extra (the cartographer's rule: Keystone, on the cluster's east side, labels
        // east; Copper, west).
        const out = it.away ? Math.max(0, -(s[0] * it.away[0] + s[1] * it.away[1]) / (Math.hypot(s[0], s[1]) || 1)) : 0;
        // (A preferred side, labelSides: worth a fair bit more line.)
        const side = Math.abs(s[1]) > Math.abs(s[0]) * 0.6 ? (s[1] < 0 ? 'N' : 'S') : s[0] > 0 ? 'E' : 'W';
        const sided = labelSides[it.r.id] && labelSides[it.r.id] !== side ? 1500 : 0;
        const long = Math.max(0, lead.len - 25); // (past ~20 px of visible line, length costs much more)
        // (The area the label and its line cover: a quick first check for clashes.)
        const ext = tail ? [Math.min(box[0], tail.seg[2]), Math.min(box[1], tail.seg[3]), Math.max(box[2], tail.seg[2]), Math.max(box[3], tail.seg[3])] : box;
        it.cands.push({ s, box, tail, ext, len: lead.len, cost: lead.len * lead.len + 6 * long * long + (s[2] ?? 60) + out * OUTWARD + sided });
      }
      it.cands.sort((a, b) => a.cost - b.cost);
    };
    // Far-out spots for a full label (computed once per label, then reused).
    const useFar = (it) => {
      if (!it.far) { const keep = it.cands; buildCands(it, true, true); it.far = it.cands; it.cands = keep; }
      it.cands = it.far;
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
    const clash = (a, b) => a.ext[0] < b.ext[2] && a.ext[2] > b.ext[0] && a.ext[1] < b.ext[3] && a.ext[3] > b.ext[1] && (hit(a, b)
      || (a.tail && segRect(a.tail.seg, b.box))
      || (b.tail && segRect(b.tail.seg, a.box))
      || (a.tail && b.tail && segSeg(a.tail.seg, b.tail.seg)));
    const mid = (it, c) => [it.p.x + c.s[0], it.p.y + c.s[1]];
    // A pair reads as swapped when each label is nearer the other's dot than its own (the two labels'
    // distances to their dots, added up, beaten by a margin with the dots traded), or when close
    // neighbors' labels sit in the opposite order to their dots.
    const inverted = (a, ca, b, cb) => {
      const [ax, ay] = mid(a, ca);
      const [bx, by] = mid(b, cb);
      const own = Math.hypot(ax - a.p.x, ay - a.p.y) + Math.hypot(bx - b.p.x, by - b.p.y);
      const traded = Math.hypot(ax - b.p.x, ay - b.p.y) + Math.hypot(bx - a.p.x, by - a.p.y);
      if (own - traded > 24) return true;
      // Close neighbors also keep their east-west and north-south order (Copper's dot is west of
      // Keystone's, so its label shouldn't be east of Keystone's).
      const dx = b.p.x - a.p.x;
      const dy = b.p.y - a.p.y;
      if (Math.hypot(dx, dy) > 80) return false;
      return (Math.abs(dx) > 12 && (bx - ax) * dx < 0 && Math.abs(bx - ax) > 20)
        || (Math.abs(dy) > 12 && (by - ay) * dy < 0 && Math.abs(by - ay) > 10);
    };
    // (Each label's neighbors within 160 px, found once: this runs inside the layout's inner loops.)
    for (const it of items) it.nearby = items.filter((o) => o !== it && Math.hypot(o.p.x - it.p.x, o.p.y - it.p.y) < 160);
    const misordered = (it, c) => {
      let n = 0;
      for (const o of it.nearby) { const oc = pick.get(o); if (oc && inverted(it, c, o, oc)) n++; }
      return n;
    };
    // A label's cost: its own distance and spot, plus a penalty for each nearby pair it reads as
    // swapped with (about a 120 px hairline's worth), so layouts keep neighbors in map order.
    const ORDER_PENALTY = 3000;
    const costOf = (it, c) => (c ? c.cost + ORDER_PENALTY * misordered(it, c) : 1e7);
    // "No data" dots take part too (on their dot only), so labels keep clear of them.
    const labels = items.filter((it) => it.cands.length);
    const pick = new Map();
    const free = (it, c) => labels.every((o) => o === it || !pick.get(o) || !clash(c, pick.get(o)));

    // 1) A layout where everything fits: crowded resorts first, each taking its cheapest free spot.
    //    Several orderings are tried; the one that hides the fewest labels (then is shortest) wins.
    const crowd = (it) => labels.filter((o) => Math.hypot(o.p.x - it.p.x, o.p.y - it.p.y) < 90).length;
    let seed = startSeed;
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

    // A label's cheapest free spot (used by the moves below).
    const reseatBest = (it) => {
      // (Cheapest free spot counting map order too; the sorted base cost is a lower bound.)
      let c = null;
      let best = Infinity;
      for (const x of it.cands) {
        if (x.cost >= best) break;
        if (!free(it, x)) continue;
        const v = costOf(it, x);
        if (v < best) { best = v; c = x; }
      }
      return c;
    };
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
      // (Mostly the nearer spots: they're where the short lines are.)
      const next = it.cands[Math.floor(rand() ** 3 * it.cands.length)];
      const cur = pick.get(it);
      if (next === cur) continue;
      temp *= 0.9993;
      if (free(it, next)) {
        const delta = costOf(it, next) - costOf(it, cur); // placing a hidden label is a huge win
        if (delta < 0 || rand() < Math.exp(-delta / temp)) pick.set(it, next);
        continue;
      }
      // Or a kick: the (up to 2) labels in the way move to their own best free spots, if that's better
      // overall (chains one-at-a-time moves can't make: Vail nearer its dot, Loveland's label stepping
      // aside; Highlands' label taking Buttermilk's side of Aspen).
      const inWay = labels.filter((o) => o !== it && pick.get(o) && clash(next, pick.get(o)));
      if (inWay.length > 2) continue;
      const was = inWay.map((o) => pick.get(o));
      const before = costOf(it, cur) + inWay.reduce((t, o, k) => t + costOf(o, was[k]), 0);
      pick.set(it, next);
      for (const o of inWay) pick.set(o, null);
      let ok = true;
      for (const o of inWay) { const n = reseatBest(o); pick.set(o, n); if (!n) ok = false; }
      const delta = ok ? costOf(it, next) + inWay.reduce((t, o) => t + costOf(o, pick.get(o)), 0) - before : Infinity;
      if (!(delta < 0 || rand() < Math.exp(-delta / temp))) { pick.set(it, cur); inWay.forEach((o, k) => pick.set(o, was[k])); }
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
    // (Its own small time allowance past the deadline: a slow phone gets the swaps it has time for.)
    const swapPass = () => {
      for (let i = 0; i < labels.length && performance.now() < deadline + 40; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i];
          const b = labels[j];
          if (Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) > 160) continue;
          const was = [pick.get(a), pick.get(b)];
          // Only worth it when one of them is off its nearest spot (or has none), or they read swapped.
          if (was[0] === a.cands[0] && was[1] === b.cands[0] && !inverted(a, was[0], b, was[1])) continue;
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

    // 4c) Keep neighbors in map order: when one resort is east of another, its label shouldn't end
    //     up by the other (Keystone's label where Copper is, Copper's off to the east). Such a pair
    //     is re-seated together in the cheapest spots that read right, even at some extra length.
    const keepOrder = (extra) => {
    for (let round = 0; round < 3 && (round === 0 || performance.now() < deadline + extra); round++) {
      let changed = false;
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i];
          const b = labels[j];
          const ca = pick.get(a);
          const cb = pick.get(b);
          if (!ca || !cb || Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) > 160 || !inverted(a, ca, b, cb)) continue;
          const wrongBefore = misordered(a, ca) + misordered(b, cb);
          pick.set(a, null);
          pick.set(b, null);
          let best = null;
          for (const x of a.cands.slice(0, 100)) {
            if (!free(a, x)) continue;
            pick.set(a, x);
            for (const y of b.cands.slice(0, 100)) {
              if (inverted(a, x, b, y) || !free(b, y)) continue;
              pick.set(b, y);
              const wrong = misordered(a, x) + misordered(b, y);
              pick.set(b, null);
              const cost = x.cost + y.cost + wrong * 20000;
              if (wrong < wrongBefore && (!best || cost < best.cost)) best = { cost, x, y };
            }
            pick.set(a, null);
          }
          // No free pair of spots: make room, moving up to 3 other labels (each must find a spot).
          if (!best) {
            const combos = [];
            for (const x of a.cands.slice(0, 50)) {
              for (const y of b.cands.slice(0, 50)) {
                if (clash(x, y) || inverted(a, x, b, y)) continue;
                combos.push({ x, y, c: x.cost + y.cost });
              }
            }
            combos.sort((p1, p2) => p1.c - p2.c);
            let tried = 0;
            for (const { x, y } of combos) {
              if (tried >= 10) break;
              const blockers = labels.filter((o) => o !== a && o !== b && pick.get(o) && (clash(x, pick.get(o)) || clash(y, pick.get(o))));
              if (blockers.length > 4) continue;
              tried++;
              const saved = blockers.map((o) => [o, pick.get(o)]);
              for (const o of blockers) pick.set(o, null);
              pick.set(a, x);
              pick.set(b, y);
              let ok = true;
              for (const o of blockers) {
                let n = bestFree(o);
                if (!n && !o.compact) {
                  const keep = o.cands;
                  useFar(o);
                  n = bestFree(o);
                  if (!n) o.cands = keep;
                }
                if (!n) { ok = false; break; }
                pick.set(o, n);
              }
              const wrong = ok ? misordered(a, x) + misordered(b, y) + blockers.reduce((t, o) => t + misordered(o, pick.get(o)), 0) : Infinity;
              if (ok && wrong < wrongBefore) { best = { x, y }; break; }
              for (const [o, v] of saved) pick.set(o, v);
              pick.set(a, null);
              pick.set(b, null);
            }
          }
          pick.set(a, best ? best.x : ca);
          pick.set(b, best ? best.y : cb);
          if (best) changed = true;
        }
      }
      if (!changed) break;
    }
    };
    // (Total hairline length, for choosing the label size.)
    const lineLength = () => labels.reduce((t, it) => { const c = pick.get(it); return t + (c?.tail ? Math.hypot(c.tail.seg[2] - c.tail.seg[0], c.tail.seg[3] - c.tail.seg[1]) : 0); }, 0);
    if (!finish) return { result: null, misses: items.filter((it) => !it.empty && !pick.get(it)).length, length: lineLength() };

    // 5) Still no room for name and number: show just the number chip (tap it for the resort).
    //    Most important first; one that matters (open, favorite, filter match) and still has no spot
    //    pushes less important labels down to number-only (they're placed again after it).
    const pending = items.filter((x) => !x.empty && !pick.get(x)).sort((a, b) => prio(b) - prio(a));
    // Take a spot for `it` anyway and move the (up to 3) labels in its way elsewhere (further out if
    // need be); kept only if every one of them finds a new spot. → the spot, or null.
    const makeRoom = (it) => {
      const options = it.cands
        .map((c) => ({ c, blockers: labels.filter((o) => o !== it && pick.get(o) && clash(c, pick.get(o))) }))
        .filter((o) => o.blockers.length && o.blockers.length <= 3)
        .sort((x, y) => x.blockers.length - y.blockers.length || x.c.cost - y.c.cost)
        .slice(0, 60);
      for (const { c, blockers } of options) {
        const saved = blockers.map((o) => [o, pick.get(o)]);
        for (const o of blockers) pick.set(o, null);
        pick.set(it, c);
        let ok = true;
        for (const o of blockers) {
          let n = bestFree(o);
          if (!n && !o.compact) {
            const keep = o.cands;
            useFar(o);
            n = bestFree(o);
            if (!n) o.cands = keep;
          }
          if (!n) { ok = false; break; }
          pick.set(o, n);
        }
        // (Moving others aside mustn't leave one of them on a long line.)
        if (ok && blockers.every((o) => !pick.get(o).tail || Math.hypot(pick.get(o).tail.seg[2] - pick.get(o).tail.seg[0], pick.get(o).tail.seg[3] - pick.get(o).tail.seg[1]) <= maxLead * 1.5)) return c;
        pick.set(it, null);
        for (const [o, v] of saved) pick.set(o, v);
      }
      return null;
    };
    // Names stay: first the full label further out (a longer hairline, allowed past other points);
    // number-only is the very last resort.
    for (const it of [...pending]) {
      if (it.compact) continue;
      useFar(it);
      if (!labels.includes(it)) labels.push(it);
      let best = null;
      for (const x of it.cands) if (free(it, x) && (!best || x.cost < best.cost)) best = x;
      if (!best) best = makeRoom(it);
      if (best) { pick.set(it, best); pending.splice(pending.indexOf(it), 1); }
    }
    for (const it of pending) {
      if (!it.compact) {
        it.compact = true;
        it.w = it.valW;
        buildCands(it, true, true);
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
      if (!c) c = makeRoom(it); // (a number chip at least: nothing goes missing)
      if (c) pick.set(it, c);
    }

    // Tidy up after the far-out placements: single moves and neighbor swaps (which also weigh map
    // order), then the order pass itself.
    settle();
    swapPass();
    settle();
    keepOrder(120);

    // 6) Shortest lines last: for the longest lines first, try a cheaper spot (nearer the dot, or on
    //    its preferred side), moving the (up to 2) labels in the way elsewhere; kept when the labels
    //    involved cost less overall (length squared, so evening out one long line counts) and none of
    //    the moved ones ends up on a long line.
    const lineLen = (o) => pick.get(o)?.len ?? 0;
    const linesUntil = performance.now() + 60; // (its own small time allowance)
    for (const it of labels.filter((o) => pick.get(o)).sort((a, b) => lineLen(b) - lineLen(a))) {
      if (performance.now() > linesUntil) break;
      const was = pick.get(it);
      if (!was) continue;
      for (const c of it.cands.filter((x) => x.cost < was.cost - 20).slice(0, 12)) {
        const blockers = labels.filter((o) => o !== it && pick.get(o) && clash(c, pick.get(o)));
        if (blockers.length > 2) continue;
        const saved = [[it, was], ...blockers.map((o) => [o, pick.get(o)])];
        const sq = () => saved.reduce((t, [o]) => t + (pick.get(o)?.cost ?? 1e7), 0);
        const before = sq();
        for (const o of blockers) pick.set(o, null);
        pick.set(it, c);
        let ok = true;
        for (const o of blockers) {
          const n = bestFree(o);
          if (!n) { ok = false; break; }
          pick.set(o, n);
        }
        if (ok && sq() < before && blockers.every((o) => lineLen(o) <= maxLead * 1.3) && misordered(it, c) <= misordered(it, was)) break;
        for (const [o, v] of saved) pick.set(o, v);
      }
    }

    const misses = items.filter((it) => !it.empty && (it.compact || !pick.get(it))).length;
    const result = items.map((it) => {
      const c = pick.get(it);
      const n = it.nearest;
      return {
        pin: it.pin,
        alt: n && (it.compact || !c) ? {
          place: { s: n.s, w: it.fullW, h: it.h },
          tail: n.tail ? n.tail.seg.map((v, k) => (v - (k % 2 ? it.p.y : it.p.x)).toFixed(1)) : null,
        } : null,
        id: it.r.id,
        chip: it.valW,
        compact: Boolean(it.compact),
        place: c ? { s: c.s, w: it.w, h: it.h } : null,
        tail: c?.tail ? c.tail.seg.map((v, k) => (v - (k % 2 ? it.p.y : it.p.x)).toFixed(1)) : null,
      };
    });
    // (How good: labels squeezed to their number, then the lines' length, squared.)
    const sq = labels.reduce((t, it) => t + (pick.get(it)?.len ?? 0) ** 2, 0);
    return { result, misses, score: misses * 1e5 + sq };
  }

  // The selected resort always shows its full label: if the layout had no room for it, it sits at its
  // nearest spot on top of the others (it's raised above them) until something else is selected.
  let selectedPin = null;
  function apply(result) {
    requestAnimationFrame(placeTowns);
    // Chips first (the layout's width), then every label's width read in one go, then the moves: no
    // layout pass per label.
    for (const entry of result) if (entry.chip) entry.pin.val.style.minWidth = `${entry.chip}px`;
    for (const entry of result) entry.pin.bubble.classList.toggle('compact', entry.compact);
    const widths = result.map((entry) => entry.pin.bubble.offsetWidth);
    result.forEach((entry, k) => {
      const { pin } = entry;
      const { place, tail, compact } = pin === selectedPin && entry.alt ? { ...entry.alt, compact: false } : entry;
      pin.root.classList.toggle('hidden', !place);
      pin.bubble.classList.toggle('compact', compact);
      // The spot was sized for the widest number; a shorter one keeps the edge nearest its dot (a
      // label right of its dot keeps its left edge, one to the left its right edge), so it never shifts.
      const transform = place && (() => {
        const actual = widths[k];
        const left = place.s[0] - place.w / 2;
        const shift = place.s[0] < -2 ? place.w - actual : Math.abs(place.s[0]) <= 2 ? (place.w - actual) / 2 : 0;
        return `translate(${left + shift}px, ${place.s[1] - place.h / 2}px)`;
      })();
      pin.tail.style.display = tail ? '' : 'none';
      if (tail) {
        pin.tail.setAttribute('x1', tail[0]);
        pin.tail.setAttribute('y1', tail[1]);
        pin.tail.setAttribute('x2', tail[2]);
        pin.tail.setAttribute('y2', tail[3]);
      }
      if (transform) pin.bubble.style.transform = transform;
    });
  }

  // items: [{ r, text, label, level, open, selected }]
  function update(items) {
    selectedPin = null;
    closeChooser();
    order = items.map((item, i) => {
      const pin = pinFor(item.r);
      pin.val.textContent = item.text;
      pin.name.textContent = SHORT[item.r.id] ?? item.r.short ?? item.r.name;
      const empty = item.level === 'none';
      pin.bubble.className = `pin-bubble${item.open ? ' is-open' : ''}${item.selected ? ' is-selected' : ''}${empty ? ' is-empty' : ''}`;
      pin.val.className = `pin-val lvl-${item.level}`;
      pin.dot.classList.toggle('is-empty', empty);
      pin.dot.classList.toggle('is-selected', item.selected);
      pin.dot.classList.toggle('is-snowing', Boolean(item.snowing)); // (the forecasts have it snowing there now)
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

  // Taps near the dots: the small dots are hard to hit, so a tap within a fingertip (26 px) of one
  // counts; where several are that close (Aspen's four), a little list of them to choose from.
  // A tap with nothing near closes what's open.
  let chooser = null;
  const closeChooser = () => { chooser?.remove(); chooser = null; };
  function pickNear(clientX, clientY) {
    closeChooser();
    const box = el.getBoundingClientRect();
    const at = L.point(clientX - box.left, clientY - box.top);
    if (el.classList.contains('dots-off')) return onSelect(null);
    const near = order
      .filter((o) => !o.pin.dot.classList.contains('filtered-out'))
      .map((o) => ({ o, d: map.latLngToContainerPoint(o.r.at).distanceTo(at) }))
      .filter((x) => x.d <= 26)
      .sort((a, b) => a.d - b.d);
    if (!near.length) return onSelect(null);
    // One resort, unless another's dot overlaps it (then there's no telling which was meant).
    const p0 = map.latLngToContainerPoint(near[0].o.r.at);
    const overlapping = near.slice(1).filter((x) => map.latLngToContainerPoint(x.o.r.at).distanceTo(p0) < 16);
    if (!overlapping.length && (near.length === 1 || near[0].d * 2 < near[1].d)) return onSelect(near[0].o.r.id);
    chooser = document.createElement('div');
    chooser.className = 'dot-chooser';
    chooser.setAttribute('role', 'menu');
    chooser.innerHTML = near.map(({ o }) => `<button type="button" role="menuitem" data-id="${o.r.id}"><b>${o.pin.val.textContent}</b> ${o.r.name}</button>`).join('');
    chooser.style.left = `${Math.min(Math.max(8, at.x - 90), box.width - 188)}px`;
    chooser.style.top = `${Math.max(8, at.y + 14)}px`;
    chooser.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      L.DomEvent.stopPropagation(e);
      if (b) { closeChooser(); onSelect(b.dataset.id); }
    });
    chooser.addEventListener('pointerdown', (e) => L.DomEvent.stopPropagation(e));
    el.appendChild(chooser);
  }
  map.on('click', (e) => pickNear(e.originalEvent.clientX, e.originalEvent.clientY));
  map.on('movestart zoomstart', closeChooser);
  // Any touch outside the list closes it (a label, the panel, the buttons…), as does a new view.
  document.addEventListener('pointerdown', (e) => { if (chooser && !chooser.contains(e.target)) closeChooser(); }, true);

  // The West: a bubble per area (its best number for the current view) beside its resorts' dots.
  const bubbles = new Map();
  const dotted = new Set();
  const keepOnScreen = () => {
    const box = el.getBoundingClientRect();
    for (const a of west?.areas ?? []) {
      const node = bubbles.get(a.code);
      node.classList.remove('side-E', 'side-W', 'side-C');
      node.classList.add(`side-${a.side ?? 'E'}`);
      if (a.side === 'C') continue;
      const b = node.getBoundingClientRect();
      if (b.right > box.right - 6) node.classList.replace('side-E', 'side-W');
      else if (b.left < box.left + 6) node.classList.replace('side-W', 'side-E');
    }
  };
  if (west) {
    map.createPane('westDots').style.zIndex = 590;
    for (const a of west.areas) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = `west-bubble side-${a.side ?? 'E'}`;
      node.innerHTML = '<b class="pin-val"></b><span class="west-name"></span>';
      node.querySelector('.west-name').textContent = a.name;
      L.DomEvent.disableClickPropagation(node);
      node.addEventListener('click', () => west.onPick(a.code));
      L.marker(a.at, { icon: L.divIcon({ html: node, className: 'west-host', iconSize: [0, 0] }), keyboard: false, zIndexOffset: 1000 }).addTo(map);
      bubbles.set(a.code, node);
    }
    map.on('click', () => west.onDismiss?.()); // (the map around the bubbles: back to the area)
    requestAnimationFrame(placeTowns);
  }

  return {
    // The West's bubbles. values: { code: { text, level, label, current, dots: [[lat, lon]…] } }.
    setAreas(values) {
      for (const [code, node] of bubbles) {
        const v = values[code] ?? { text: '·', level: 'none' };
        if (v.dots && !dotted.has(code)) {
          dotted.add(code);
          for (const at of v.dots) L.circleMarker(at, { pane: 'westDots', radius: 2.5, weight: 1, className: 'west-dot', interactive: false }).addTo(map);
        }
        const val = node.querySelector('.pin-val');
        val.textContent = v.text;
        val.className = `pin-val lvl-${v.level}`;
        node.classList.toggle('is-current', Boolean(v.current));
        node.setAttribute('aria-label', `${node.querySelector('.west-name').textContent}: ${v.label ?? v.text}`);
      }
      keepOnScreen();
      requestAnimationFrame(placeTowns); // (the cities go around the bubbles)
    },
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
    // How much of the resorts to show: 'all', 'dots' (labels off, the dots stay tappable) or 'none'
    // (just the map), to see what's under them.
    setMarks(mode) {
      el.classList.toggle('labels-off', mode !== 'all');
      el.classList.toggle('dots-off', mode === 'none');
      if (mode === 'all' && laidOutHidden) { laidOutHidden = false; layout(); }
      requestAnimationFrame(placeTowns); // (towns fill the room the labels leave)
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
      if (west) { keepOnScreen(); requestAnimationFrame(placeTowns); } else layout();
      for (const t of [...frameCache.keys()]) dropFrame(t); // pictures were for the old size
      if (layerName !== 'none') drawLayer();
    },
  };
}
