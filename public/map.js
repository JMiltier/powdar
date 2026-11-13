// The map: one fixed view of every Colorado resort (no panning or zooming). Each resort has a dot at
// its real spot and a light label beside it: a small colored chip with the number, then the name as
// plain outlined text. Labels sit right next to their dot when there's room (right side first); in
// crowded spots (I-70) they step out a little with a thin hairline back to the dot.
const L = window.L;

// Esri's hillshade: just the mountains, no town names or roads to compete with the resorts, with a
// matching dark version. Free, no key.
const TILES = {
  light: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
};
const isDark = () => document.documentElement.dataset.theme === 'dark';
// Shown behind the ⓘ button instead of a permanent banner.
export const CREDITS = 'Hillshade © <a href="https://www.esri.com">Esri</a> and its data partners (USGS, NASA, NGA, CGIAR and others) · '
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
export function createSnowMap(el, { resorts, onSelect, getPadding, extend, outline }) {
  const bounds = L.latLngBounds(resorts.map((r) => r.at));
  if (extend) bounds.extend(extend);
  // A state with a single resort still needs some area around it.
  if (bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 40000) bounds.extend(bounds.getCenter().toBounds(80000));
  const map = L.map(el, {
    zoomControl: false, attributionControl: false, zoomSnap: 0, inertia: false,
    dragging: false, touchZoom: false, doubleClickZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false,
  });
  const base = L.tileLayer(isDark() ? TILES.dark : TILES.light, { maxZoom: 12 }).addTo(map);
  // The state stands out: everything outside its border is dimmed, and the border is a fine line.
  // [[lat, lon], …]
  if (outline) {
    map.createPane('mask').style.zIndex = 260; // over the snow cover, under the resorts
    const world = [[85, -180], [85, 180], [-85, 180], [-85, -180]];
    L.polygon([world, outline], { pane: 'mask', className: 'outside', interactive: false, stroke: false }).addTo(map);
    L.polyline(outline, { pane: 'mask', className: 'state-line', interactive: false }).addTo(map);
  }

  // Snow cover gets its own pane so the color-muting filter on the base map doesn't wash it out.
  map.createPane('snow').style.zIndex = 250;
  map.createPane('dots').style.zIndex = 590; // just under the labels (markerPane is 600)
  const snowDepth = L.tileLayer.wms(SNOW_DEPTH_WMS, {
    pane: 'snow', layers: '0', format: 'image/png', transparent: true, version: '1.3.0', opacity: 0.85,
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
    const key = JSON.stringify([size, pad, map.getZoom(), order.map((o) => [o.r.id, o.pin.bubble.textContent, o.pin.bubble.className.replace(/ (compact|is-selected)/g, '')]).sort()]);
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
        const lead = it.empty ? { len: 0, seg: null } : leader(it, s);
        const tail = lead.seg ? { seg: lead.seg } : null;
        // (Relaxed, for the number-only fallback: a hairline may pass beside other points, and reach further.)
        if (!relaxed && tail && dots.some((d) => d !== it.p && segPointDist(tail.seg, d) < DOT_R + 3)) continue;
        if (lead.len > (relaxed ? maxLead * 1.5 : maxLead)) continue;
        // Distance from the dot (squared), plus a small preference for the classic spots.
        it.cands.push({ s, box, tail, cost: lead.len * lead.len + (s[2] ?? 60) + (tail ? 40 : 0) });
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
    let temp = 3000;
    for (let k = 0; k < 12000 && labels.length && !(k % 256 === 0 && late()); k++) {
      const it = labels[Math.floor(rand() * labels.length)];
      const next = it.cands[Math.floor(rand() * it.cands.length)];
      const cur = pick.get(it);
      if (next === cur || !free(it, next)) continue;
      const delta = costOf(it, next) - costOf(it, cur); // placing a hidden label is a huge win
      if (delta < 0 || rand() < Math.exp(-delta / temp)) pick.set(it, next);
      temp *= 0.9993;
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

    // 5) Still no room for name and number: show just the number chip (tap it for the resort).
    for (const it of items.filter((x) => !x.empty && !pick.get(x))) {
      it.compact = true;
      it.w = it.pin.val.offsetWidth;
      buildCands(it, true);
      if (!labels.includes(it)) labels.push(it);
      const c = it.cands.find((x) => free(it, x));
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
      return { ...item, pin, empty: item.level === 'none' };
    });
    layout();
  }

  map.on('click', () => onSelect(null));

  return {
    update,
    // Light or dark relief to match the theme.
    setTheme() {
      base.setUrl(isDark() ? TILES.dark : TILES.light);
    },
    setSnowDepth(on) {
      if (on) snowDepth.addTo(map);
      else snowDepth.remove();
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
    },
  };
}
