// The map: one fixed view of every Colorado resort (no panning or zooming). Each resort has a dot at
// its real spot and its own one-line label ("A-Basin 3″"). Where resorts crowd together (I-70) the
// labels fan out around the cluster, and a label that sits away from its dot gets a small pointer
// tab aimed at it, so every resort stays readable on one screen without connector lines.
const L = window.L;

// OpenTopoMap: free, no key, and its terrain shading suits mountains. Colours are muted in CSS.
const TILES = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
// Shown behind the ⓘ button instead of a permanent banner.
export const CREDITS = 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · '
  + 'map style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · '
  + 'snow cover: <a href="https://www.nohrsc.noaa.gov/nsa/">NOAA NOHRSC</a> · <a href="https://leafletjs.com">Leaflet</a>';
// NOAA's daily national snow analysis (NOHRSC): modelled snow depth on the ground, cloud-free.
const SNOW_DEPTH_WMS = 'https://mapservices.weather.noaa.gov/raster/services/snow/NOHRSC_Snow_Analysis/MapServer/WMSServer';
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

// Places a label may sit, as its centre relative to the dot: on the dot, touching it on any side,
// then a grid further out (for crowded clusters).
function spotsFor(w, h) {
  const a = w / 2 + DOT_R + 2;
  const b = h / 2 + DOT_R + 1;
  const out = [[0, 0], [a, 0], [-a, 0], [0, -b], [0, b], [a, -b], [a, b], [-a, -b], [-a, b]];
  for (let i = -4; i <= 4; i++) {
    for (let j = -5; j <= 5; j++) {
      const dx = i * (w / 2 + 3);
      const dy = j * (h + GAP);
      if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue;
      out.push([dx, dy]);
    }
  }
  return out;
}

// getPadding() → { top, right, bottom, left }: pixels covered by the app's bars and panels.
export function createSnowMap(el, { resorts, onSelect, getPadding }) {
  // Frame a little extra on the east: the Front Range resorts sit at the edge of the cluster and
  // their labels need open plains to spread into instead of piling onto I-70.
  const bounds = L.latLngBounds(resorts.map((r) => r.at)).extend([39.8, -105.1]);
  const map = L.map(el, {
    zoomControl: false, attributionControl: false, zoomSnap: 0, inertia: false,
    dragging: false, touchZoom: false, doubleClickZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false,
  });
  L.tileLayer(TILES, { subdomains: 'abc', maxZoom: 12 }).addTo(map);

  // Snow cover gets its own pane so the colour-muting filter on the base map doesn't wash it out.
  map.createPane('snow').style.zIndex = 250;
  map.createPane('dots').style.zIndex = 590; // just under the labels (markerPane is 600)
  const snowDepth = L.tileLayer.wms(SNOW_DEPTH_WMS, {
    pane: 'snow', layers: '0', format: 'image/png', transparent: true, version: '1.3.0', opacity: 0.75,
  });

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
    root.innerHTML = '<button type="button" class="pin-bubble"><span class="pin-name"></span><b class="pin-val"></b></button>';
    // Dots live on their own layer beneath every label, so no dot ever sits on top of a label.
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'pin-dot';
    dot.tabIndex = -1;
    dot.setAttribute('aria-hidden', 'true');
    for (const node of [root, dot]) {
      node.addEventListener('click', (e) => {
        if (!e.target.closest('button')) return;
        L.DomEvent.stopPropagation(e);
        onSelect(r.id);
      });
    }
    L.marker(r.at, { pane: 'dots', icon: L.divIcon({ html: dot, className: 'pin-host', iconSize: [0, 0] }), keyboard: false }).addTo(map);
    const marker = L.marker(r.at, { icon: L.divIcon({ html: root, className: 'pin-host', iconSize: [0, 0] }), keyboard: false }).addTo(map);
    pin = { marker, root, bubble: root.querySelector('.pin-bubble'), val: root.querySelector('.pin-val'), name: root.querySelector('.pin-name') };
    pins.set(r.id, pin);
    return pin;
  }

  // Label layout by simulated annealing: every label picks one of its candidate spots (or, as a last
  // resort, hides). The cost of a layout:
  //   - overlapping another label: huge;  hiding: huge
  //   - distance from its own dot (squared, so one long jump costs more than several short ones)
  //   - sitting nearer another resort's dot than its own: big, so labels never look misassigned
  // Hard rules filtered up front: a spot must stay in the visible map and not cover another dot.
  function layout() {
    const size = map.getSize();
    const pad = getPadding();
    const area = [pad.left + 2, pad.top + 2, size.x - pad.right - 2, size.y - pad.bottom - 2];
    const items = order.map((o) => {
      o.pin.bubble.className = o.pin.bubble.className.replace(/ tail-[tblr]/g, '');
      return { ...o, p: map.latLngToContainerPoint(o.r.at), w: o.pin.bubble.offsetWidth, h: o.pin.bubble.offsetHeight };
    });
    const dots = items.map((it) => it.p);
    const boxOf = (it, [dx, dy]) => [it.p.x + dx - it.w / 2 - GAP, it.p.y + dy - it.h / 2 - GAP, it.p.x + dx + it.w / 2 + GAP, it.p.y + dy + it.h / 2 + GAP];
    const distToBox = (pt, b) => Math.hypot(Math.max(b[0] - pt.x, 0, pt.x - b[2]), Math.max(b[1] - pt.y, 0, pt.y - b[3]));

    // Candidate spots per label with their fixed (own) cost.
    for (const it of items) {
      const spots = it.empty ? [[0, 0]] : spotsFor(it.w, it.h);
      it.cands = [];
      for (const s of spots) {
        const box = boxOf(it, s);
        if (box[0] < area[0] || box[2] > area[2] || box[1] < area[1] || box[3] > area[3]) continue;
        if (dots.some((d) => d !== it.p && d.x + DOT_R > box[0] && d.x - DOT_R < box[2] && d.y + DOT_R > box[1] && d.y - DOT_R < box[3])) continue;
        const own = distToBox(it.p, box);
        const nearestOther = Math.min(...dots.filter((d) => d !== it.p).map((d) => distToBox(d, box)));
        // Misleading spots (nearer another resort's dot than this one's) cost far more than distance.
        const cost = s[0] ** 2 + s[1] ** 2 + (nearestOther + 2 < own ? 40000 + 400 * (own - nearestOther) ** 2 : 0);
        it.cands.push({ s, box, cost });
      }
      it.cands.sort((a, b) => a.cost - b.cost);
    }
    const hit = (a, b) => a && b && a.box[0] < b.box[2] && a.box[2] > b.box[0] && a.box[1] < b.box[3] && a.box[3] > b.box[1];
    const labels = items.filter((it) => !it.empty && it.cands.length);
    const pick = new Map();
    const free = (it, c) => labels.every((o) => o === it || !hit(c, pick.get(o)));

    // 1) A layout where everything fits: crowded resorts first, each taking its cheapest free spot.
    //    A few orderings are tried; the one that hides the fewest labels wins.
    const crowd = (it) => labels.filter((o) => Math.hypot(o.p.x - it.p.x, o.p.y - it.p.y) < 90).length;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let bestStart = null;
    for (let t = 0; t < 30; t++) {
      pick.clear();
      const seq = [...labels].sort((a, b) => b.selected - a.selected || crowd(b) - crowd(a) + (t ? (rand() - 0.5) * 6 : 0));
      let hidden = 0;
      for (const it of seq) {
        const c = it.cands.find((x) => free(it, x)) ?? null;
        pick.set(it, c);
        if (!c) hidden++;
      }
      const cost = hidden * 1e6 + labels.reduce((a, it) => a + (pick.get(it)?.cost ?? 0), 0);
      if (!bestStart || cost < bestStart.cost) bestStart = { cost, picks: new Map(pick) };
    }
    pick.clear();
    for (const [k, v] of bestStart.picks) pick.set(k, v);

    // 2) Improve it: move one label at a time to another free spot when that lowers the cost
    //    (sometimes accepting a worse move early on, to escape dead ends). Overlaps are never allowed.
    let temp = 2000;
    for (let k = 0; k < 30000 && labels.length; k++) {
      const it = labels[Math.floor(rand() * labels.length)];
      const next = it.cands[Math.floor(rand() * it.cands.length)];
      const cur = pick.get(it);
      if (!free(it, next)) continue;
      const delta = next.cost - (cur ? cur.cost - 1e6 : 0); // placing a hidden label is a huge win
      if (delta < 0 || rand() < Math.exp(-delta / temp)) pick.set(it, next);
      temp *= 0.9997;
    }

    for (const it of items) {
      const c = it.empty ? it.cands[0] : pick.get(it);
      it.pin.root.classList.toggle('hidden', !c);
      if (!c) continue;
      const [dx, dy] = c.s;
      it.pin.bubble.style.transform = `translate(${dx - it.w / 2}px, ${dy - it.h / 2}px)`;
      // A label away from its dot gets a pointer tab on the side facing the dot.
      if (dx === 0 && dy === 0) continue;
      const left = dx - it.w / 2;
      const top = dy - it.h / 2;
      let side;
      if (top > 0) side = 't';
      else if (top + it.h < 0) side = 'b';
      else side = left > 0 ? 'l' : 'r';
      const along = side === 't' || side === 'b'
        ? Math.min(it.w - 8, Math.max(8, -left))
        : Math.min(it.h - 5, Math.max(5, -top));
      it.pin.bubble.classList.add(`tail-${side}`);
      it.pin.bubble.style.setProperty('--tail', `${along}px`);
    }
  }

  // items: [{ r, text, label, level, open, selected }]
  function update(items) {
    order = items.map((item, i) => {
      const pin = pinFor(item.r);
      pin.val.textContent = item.text;
      pin.name.textContent = SHORT[item.r.id] ?? item.r.name;
      pin.bubble.className = `pin-bubble lvl-${item.level}${item.open ? ' is-open' : ''}${item.selected ? ' is-selected' : ''}`;
      pin.bubble.setAttribute('aria-label', `${item.r.name}: ${item.label}`);
      pin.marker.setZIndexOffset(item.selected ? 1000 : -i);
      return { ...item, pin, empty: item.level === 'none' };
    });
    layout();
  }

  map.on('click', () => onSelect(null));

  return {
    update,
    setSnowDepth(on) {
      if (on) snowDepth.addTo(map);
      else snowDepth.remove();
    },
    // Screen size or panels changed: refit everything and lay the labels out again.
    refit() {
      map.invalidateSize();
      fit();
      layout();
    },
  };
}
