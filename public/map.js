// The map view: one bubble per resort showing the chosen number, Snow Map style.
// Bubbles that would overlap (the I-70 corridor at low zoom) are nudged apart with a
// thin line back to the resort's real spot.
const L = window.L;

// OpenTopoMap: free, no key, and its terrain shading suits mountains. Dark mode dims it in CSS.
const TILES = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = 'Map: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)';
const GAP = 3;
const CROWD_PX = 90;
// First visit opens on the central mountains (I-70, Vail, Aspen, Steamboat, Crested Butte):
// the whole state at phone width is too cramped to read. After that we remember the view.
const START_VIEW = [[38.85, -107.12], [40.5, -105.5]];
// Zoomed out, bubbles show just the number; names appear once there's room.
export const NAMES_FROM_ZOOM = 7.75;
// Candidate bubble offsets: rings around the resort, wider than tall like the bubbles.
const RINGS = [28, 42, 58, 76, 96, 118];
const ANGLES = 16;
const SPOTS = [[0, 0]];
for (const r of RINGS) {
  for (let a = 0; a < ANGLES; a++) {
    const t = (a / ANGLES) * Math.PI * 2;
    SPOTS.push([Math.round(Math.cos(t) * r * 1.3), Math.round(Math.sin(t) * r)]);
  }
}

const SHORT = {
  'arapahoe-basin': 'A-Basin', 'copper-mountain': 'Copper', breckenridge: 'Breck', 'beaver-creek': 'Beaver Creek',
  'echo-mountain': 'Echo', 'granby-ranch': 'Granby', 'howelsen-hill': 'Howelsen', 'aspen-mountain': 'Aspen Mtn',
  'aspen-highlands': 'Highlands', 'crested-butte': 'Crested Butte', cooper: 'Cooper',
};

export function createSnowMap(el, { onSelect, saved, onMove, onZoom }) {
  const map = L.map(el, { zoomControl: false, minZoom: 6, maxZoom: 12, zoomSnap: 0.25, zoomDelta: 0.5, maxBounds: [[35.5, -111], [42.5, -100]] });
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer(TILES, { attribution: ATTRIBUTION, subdomains: 'abc', maxZoom: 12 }).addTo(map);

  const pins = new Map();
  let order = [];
  let fitted = false;
  if (saved) {
    map.setView([saved.lat, saved.lng], saved.zoom);
    fitted = true;
  }

  function pinFor(r) {
    let pin = pins.get(r.id);
    if (pin) return pin;
    const root = document.createElement('div');
    root.className = 'pin';
    root.innerHTML = `
      <svg class="pin-line" width="1" height="1" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="0"/></svg>
      <span class="pin-dot"></span>
      <button type="button" class="pin-bubble"><span class="pin-name"></span><b class="pin-val"></b></button>`;
    root.querySelector('.pin-bubble').addEventListener('click', (e) => {
      L.DomEvent.stopPropagation(e);
      onSelect(r.id);
    });
    const marker = L.marker(r.at, { icon: L.divIcon({ html: root, className: 'pin-host', iconSize: [0, 0] }), keyboard: false }).addTo(map);
    pin = {
      marker,
      root,
      bubble: root.querySelector('.pin-bubble'),
      val: root.querySelector('.pin-val'),
      name: root.querySelector('.pin-name'),
      line: root.querySelector('line'),
      size: [0, 0],
    };
    pins.set(r.id, pin);
    return pin;
  }

  // Greedy placement in screen pixels. Lonely resorts keep their real spot; crowded ones
  // lean outward from their cluster, avoiding other bubbles and, if possible, other dots.
  function layout() {
    el.classList.toggle('show-names', map.getZoom() >= NAMES_FROM_ZOOM);
    const items = order.map(({ r, pin, empty }) => ({
      r, pin, empty, p: map.latLngToContainerPoint(r.at), w: pin.bubble.offsetWidth, h: pin.bubble.offsetHeight,
    }));
    for (const it of items) {
      const near = items.filter((o) => o !== it && Math.hypot(o.p.x - it.p.x, o.p.y - it.p.y) < CROWD_PX);
      it.crowd = near.length;
      it.away = [0, 0];
      if (near.length) {
        const vx = it.p.x - near.reduce((s, o) => s + o.p.x, 0) / near.length;
        const vy = it.p.y - near.reduce((s, o) => s + o.p.y, 0) / near.length;
        const len = Math.hypot(vx, vy) || 1;
        it.away = [vx / len, vy / len];
      }
    }
    const placed = [];
    // Resorts with a number go first; empty dots fit in around them.
    for (const it of [...items].sort((a, b) => a.empty - b.empty || a.crowd - b.crowd)) {
      let best = [0, 0];
      let bestScore = Infinity;
      for (const [dx, dy] of it.empty ? [] : SPOTS) {
        const box = [it.p.x + dx - it.w / 2 - GAP, it.p.y + dy - it.h / 2 - GAP, it.p.x + dx + it.w / 2 + GAP, it.p.y + dy + it.h / 2 + GAP];
        if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        const hidesDot = items.some((o) => o !== it && o.p.x > box[0] && o.p.x < box[2] && o.p.y > box[1] && o.p.y < box[3]);
        // Shorter lines win; pointing away from the cluster earns a small discount.
        const score = Math.hypot(dx, dy) - 0.35 * (dx * it.away[0] + dy * it.away[1]) + (hidesDot ? 30 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = [dx, dy];
        }
      }
      const [dx, dy] = best;
      placed.push([it.p.x + dx - it.w / 2 - GAP, it.p.y + dy - it.h / 2 - GAP, it.p.x + dx + it.w / 2 + GAP, it.p.y + dy + it.h / 2 + GAP]);
      it.pin.bubble.style.transform = `translate(${dx - it.w / 2}px, ${dy - it.h / 2}px)`;
      it.pin.line.setAttribute('x2', dx);
      it.pin.line.setAttribute('y2', dy);
      it.pin.root.classList.toggle('moved', dx !== 0 || dy !== 0);
    }
  }

  // items: [{ r, value, text, level, open, selected }] in priority order.
  function update(items) {
    order = items.map((item, i) => {
      const pin = pinFor(item.r);
      pin.val.textContent = item.text;
      pin.name.textContent = SHORT[item.r.id] ?? item.r.name;
      pin.bubble.className = `pin-bubble lvl-${item.level}${item.open ? ' is-open' : ''}${item.selected ? ' is-selected' : ''}`;
      pin.bubble.setAttribute('aria-label', `${item.r.name}: ${item.label}`);
      pin.marker.setZIndexOffset(item.selected ? 1000 : -i);
      return { r: item.r, pin, empty: item.level === 'none' };
    });
    if (!fitted) {
      map.fitBounds(START_VIEW, { padding: [30, 30] });
      fitted = true;
    }
    layout();
  }

  map.on('zoomend', () => {
    layout();
    onZoom?.();
  });
  map.on('moveend', () => {
    const c = map.getCenter();
    onMove({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  });
  map.on('click', () => onSelect(null));

  return {
    update,
    namesShown: () => map.getZoom() >= NAMES_FROM_ZOOM,
    resize() {
      map.invalidateSize();
      layout();
    },
  };
}
