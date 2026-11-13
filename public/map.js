// The map: one fixed view of every Colorado resort (no panning or zooming). Each resort has a dot at
// its real spot and its own one-line label ("A-Basin 3″"). Where resorts crowd together (I-70) the
// labels fan out around the cluster, each with a short pointer reaching all the way to its dot.
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
    for (let j = -6; j <= 6; j++) {
      const dx = i * (w / 2 + 3);
      const dy = j * (h + GAP);
      if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue;
      out.push([dx, dy]);
    }
  }
  return out;
}

// A pointer from a label at offset s to its dot: the wedge's base sits on the label edge nearest the
// dot, its tip on the dot's rim. Returns the wedge polygon and its centre line (for clash checks).
function pointer(it, [dx, dy]) {
  const l = it.p.x + dx - it.w / 2;
  const t = it.p.y + dy - it.h / 2;
  const r = l + it.w;
  const b = t + it.h;
  const half = 5;
  // Nearest point on the label's outline, kept away from the rounded corners.
  const bx = Math.min(r - 8, Math.max(l + 8, it.p.x));
  const by = Math.min(b - 6, Math.max(t + 6, it.p.y));
  let base;
  let along;
  if (it.p.y > b) { base = [bx, b - 1.5]; along = [1, 0]; }
  else if (it.p.y < t) { base = [bx, t + 1.5]; along = [1, 0]; }
  else if (it.p.x > r) { base = [r - 1.5, by]; along = [0, 1]; }
  else { base = [l + 1.5, by]; along = [0, 1]; }
  const vx = it.p.x - base[0];
  const vy = it.p.y - base[1];
  const len = Math.hypot(vx, vy) || 1;
  const tip = [it.p.x - (vx / len) * (DOT_R + 0.5), it.p.y - (vy / len) * (DOT_R + 0.5)];
  return {
    points: [[base[0] - along[0] * half, base[1] - along[1] * half], [base[0] + along[0] * half, base[1] + along[1] * half], tip],
    seg: [base[0], base[1], tip[0], tip[1]],
  };
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
    root.innerHTML = '<svg class="pin-tail" width="1" height="1" aria-hidden="true"><polygon/></svg>'
      + '<button type="button" class="pin-bubble"><span class="pin-name"></span><b class="pin-val"></b></button>';
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
    pin = {
      marker, root, tail: root.querySelector('polygon'),
      bubble: root.querySelector('.pin-bubble'), val: root.querySelector('.pin-val'), name: root.querySelector('.pin-name'),
    };
    pins.set(r.id, pin);
    return pin;
  }

  // Label layout by simulated annealing. Each label sits on its dot or nearby; a label that isn't on
  // its dot gets a pointer (a wedge in the label's colour) running all the way to the dot.
  // Hard rules: labels never overlap; a pointer never crosses another label, another pointer, or
  // passes over another resort's dot; everything stays in the visible map.
  // Cost: pointer length (squared, so one long pointer costs more than several short ones).
  function layout() {
    const size = map.getSize();
    const pad = getPadding();
    const area = [pad.left + 2, pad.top + 2, size.x - pad.right - 2, size.y - pad.bottom - 2];
    // Un-hide everything first: a label hidden by the last layout would measure as zero size.
    for (const o of order) o.pin.root.classList.remove('hidden');
    const items = order.map((o) => ({ ...o, p: map.latLngToContainerPoint(o.r.at), w: o.pin.bubble.offsetWidth, h: o.pin.bubble.offsetHeight }));
    const dots = items.map((it) => it.p);
    const boxOf = (it, [dx, dy]) => [it.p.x + dx - it.w / 2 - GAP, it.p.y + dy - it.h / 2 - GAP, it.p.x + dx + it.w / 2 + GAP, it.p.y + dy + it.h / 2 + GAP];

    for (const it of items) {
      const spots = it.empty ? [[0, 0]] : spotsFor(it.w, it.h);
      it.cands = [];
      for (const s of spots) {
        const box = boxOf(it, s);
        if (box[0] < area[0] || box[2] > area[2] || box[1] < area[1] || box[3] > area[3]) continue;
        const tail = s[0] === 0 && s[1] === 0 ? null : pointer(it, s);
        // Covering another resort's dot, or a pointer passing over one, is confusing: allowed only
        // when there's no other way (the tightest clusters, on the smallest screens).
        const covers = dots.filter((d) => d !== it.p && d.x + DOT_R > box[0] && d.x - DOT_R < box[2] && d.y + DOT_R > box[1] && d.y - DOT_R < box[3]).length;
        const passes = tail ? dots.filter((d) => d !== it.p && segPointDist(tail.seg, d) < DOT_R + 3).length : 0;
        const len = tail ? Math.hypot(tail.seg[2] - tail.seg[0], tail.seg[3] - tail.seg[1]) : 0;
        it.cands.push({ s, box, tail, cost: (tail ? 30 : 0) + len * len + 80000 * (covers + passes) });
      }
      it.cands.sort((a, b) => a.cost - b.cost);
    }

    const hit = (a, b) => a.box[0] < b.box[2] && a.box[2] > b.box[0] && a.box[1] < b.box[3] && a.box[3] > b.box[1];
    // Hard: labels overlapping, or a pointer running under another label.
    const clash = (a, b) => hit(a, b)
      || (a.tail && segRect(a.tail.seg, b.box))
      || (b.tail && segRect(b.tail.seg, a.box));
    // Soft but expensive: two pointers crossing (better than hiding a label).
    const CROSS = 50000;
    const crossings = (it, c) => (c.tail ? labels.reduce((n, o) => {
      const oc = o !== it && pick.get(o);
      return n + (oc && oc.tail && segSeg(c.tail.seg, oc.tail.seg) ? 1 : 0);
    }, 0) : 0);
    const costOf = (it, c) => (c ? c.cost + CROSS * crossings(it, c) : 1e7);
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
    for (let t = 0; t < 40; t++) {
      pick.clear();
      const seq = [...labels].sort((a, b) => b.selected - a.selected || crowd(b) - crowd(a) + (t ? (rand() - 0.5) * 6 : 0));
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
    let temp = 3000;
    for (let k = 0; k < 30000 && labels.length; k++) {
      const it = labels[Math.floor(rand() * labels.length)];
      const next = it.cands[Math.floor(rand() * it.cands.length)];
      const cur = pick.get(it);
      if (next === cur || !free(it, next)) continue;
      const delta = costOf(it, next) - costOf(it, cur); // placing a hidden label is a huge win
      if (delta < 0 || rand() < Math.exp(-delta / temp)) pick.set(it, next);
      temp *= 0.9997;
    }

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
    for (let round = 0; round < 3; round++) {
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

    for (const it of items) {
      const c = pick.get(it);
      it.pin.root.classList.toggle('hidden', !c);
      it.pin.tail.setAttribute('points', '');
      if (!c) continue;
      const [dx, dy] = c.s;
      it.pin.bubble.style.transform = `translate(${dx - it.w / 2}px, ${dy - it.h / 2}px)`;
      if (!c.tail) continue;
      // Draw the wedge in the label's own colours, from its edge to the rim of the dot.
      const cs = getComputedStyle(it.pin.bubble);
      it.pin.tail.setAttribute('points', c.tail.points.map(([x, y]) => `${(x - it.p.x).toFixed(1)},${(y - it.p.y).toFixed(1)}`).join(' '));
      it.pin.tail.style.fill = cs.backgroundColor;
      it.pin.tail.style.stroke = cs.borderTopColor;
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
