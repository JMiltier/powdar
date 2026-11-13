// The map view: one bubble per resort showing the chosen number, Snow Map style.
// Every resort has a dot at its real spot. Its bubble sits on the dot or right beside it;
// when there's no room the bubble hides (the dot stays tappable) until you zoom in.
const L = window.L;

// OpenTopoMap: free, no key, and its terrain shading suits mountains. Dark mode dims it in CSS.
const TILES = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)';
// NOAA's daily national snow analysis (NOHRSC): modelled snow depth on the ground, cloud-free.
const SNOW_DEPTH_WMS = 'https://mapservices.weather.noaa.gov/raster/services/snow/NOHRSC_Snow_Analysis/MapServer/WMSServer';
const GAP = 2;
const DOT_R = 4;
// First visit fits every resort; after that we remember where you left the map.
// Extra top padding keeps resorts out from under the floating buttons.
const FIT_PADDING = { paddingTopLeft: [34, 84], paddingBottomRight: [40, 28] };
// Names always show; crowded bubbles hide instead (see layout). Kept as a knob.
export const NAMES_FROM_ZOOM = 0;

const SHORT = {
  'arapahoe-basin': 'A-Basin', 'copper-mountain': 'Copper', breckenridge: 'Breck', 'beaver-creek': 'Beaver Creek',
  'echo-mountain': 'Echo', 'granby-ranch': 'Granby', 'howelsen-hill': 'Howelsen', 'aspen-mountain': 'Aspen Mtn',
  'aspen-highlands': 'Highlands', 'crested-butte': 'Crested Butte', cooper: 'Cooper',
};

// Where a bubble may sit, as its centre relative to the dot: on it, then touching it on each side.
const spotsFor = (w, h) => {
  const x = w / 2 + DOT_R + 2;
  const y = h / 2 + DOT_R + 2;
  return [[0, 0], [0, -y], [x, 0], [0, y], [-x, 0], [x, -y], [x, y], [-x, y], [-x, -y]];
};

export function createSnowMap(el, { onSelect, saved, onMove, onZoom }) {
  const map = L.map(el, { zoomControl: false, minZoom: 6, maxZoom: 12, zoomSnap: 0.25, zoomDelta: 0.5, maxBounds: [[35.5, -111], [42.5, -100]] });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer(TILES, { attribution: ATTRIBUTION, subdomains: 'abc', maxZoom: 12 }).addTo(map);

  // Its own pane so the colour-muting filter on the base map doesn't wash it out.
  map.createPane('snow').style.zIndex = 250;
  const snowDepth = L.tileLayer.wms(SNOW_DEPTH_WMS, {
    pane: 'snow', layers: '0', format: 'image/png', transparent: true, version: '1.3.0', opacity: 0.75,
    attribution: 'Snow: <a href="https://www.nohrsc.noaa.gov/nsa/">NOAA</a>',
  });

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
      <button type="button" class="pin-dot" tabindex="-1" aria-hidden="true"></button>
      <button type="button" class="pin-bubble"><span class="pin-name"></span><b class="pin-val"></b></button>`;
    root.addEventListener('click', (e) => {
      if (!e.target.closest('button')) return;
      L.DomEvent.stopPropagation(e);
      onSelect(r.id);
    });
    const marker = L.marker(r.at, { icon: L.divIcon({ html: root, className: 'pin-host', iconSize: [0, 0] }), keyboard: false }).addTo(map);
    pin = { marker, root, bubble: root.querySelector('.pin-bubble'), val: root.querySelector('.pin-val'), name: root.querySelector('.pin-name') };
    pins.set(r.id, pin);
    return pin;
  }

  // Greedy, in priority order: each bubble takes the first free spot by its dot, or hides.
  function layout() {
    el.classList.toggle('show-names', map.getZoom() >= NAMES_FROM_ZOOM);
    for (const { pin } of order) pin.root.classList.remove('hidden');
    const items = order.map(({ r, pin, empty, important }) => ({
      r, pin, empty, important, p: map.latLngToContainerPoint(r.at), w: pin.bubble.offsetWidth, h: pin.bubble.offsetHeight,
    }));
    const placed = [];
    const overlaps = (box) => placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
    const hidesDot = (box, self) => items.some((o) => o !== self &&
      o.p.x + DOT_R > box[0] && o.p.x - DOT_R < box[2] && o.p.y + DOT_R > box[1] && o.p.y - DOT_R < box[3]);

    for (const it of items) {
      let spot = null;
      for (const [dx, dy] of it.empty ? [[0, 0]] : spotsFor(it.w, it.h)) {
        const cx = it.p.x + dx;
        const cy = it.p.y + dy;
        const box = [cx - it.w / 2 - GAP, cy - it.h / 2 - GAP, cx + it.w / 2 + GAP, cy + it.h / 2 + GAP];
        // Open, pinned and selected resorts may sit over a neighbour's dot rather than hide.
        if (overlaps(box) || (!it.important && hidesDot(box, it))) continue;
        spot = [dx, dy, box];
        break;
      }
      if (!spot) {
        it.pin.root.classList.add('hidden');
        continue;
      }
      const [dx, dy, box] = spot;
      placed.push(box);
      it.pin.bubble.style.transform = `translate(${dx - it.w / 2}px, ${dy - it.h / 2}px)`;
      it.pin.root.classList.toggle('moved', dx !== 0 || dy !== 0);
    }
    return items.filter((it) => !it.empty && it.pin.root.classList.contains('hidden')).length;
  }

  let hiddenCount = 0;
  const relayout = () => {
    hiddenCount = layout();
  };

  // items: [{ r, text, label, level, open, selected, important }] in priority order (most important first).
  function update(items) {
    order = items.map((item, i) => {
      const pin = pinFor(item.r);
      pin.val.textContent = item.text;
      pin.name.textContent = SHORT[item.r.id] ?? item.r.name;
      pin.bubble.className = `pin-bubble lvl-${item.level}${item.open ? ' is-open' : ''}${item.selected ? ' is-selected' : ''}`;
      pin.bubble.setAttribute('aria-label', `${item.r.name}: ${item.label}`);
      pin.marker.setZIndexOffset(item.selected ? 1000 : -i);
      return { r: item.r, pin, empty: item.level === 'none', important: item.important };
    });
    if (!fitted) {
      map.fitBounds(items.map((i) => i.r.at), FIT_PADDING);
      fitted = true;
    }
    relayout();
  }

  map.on('zoomend', () => {
    relayout();
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
    hiddenCount: () => hiddenCount,
    setSnowDepth(on) {
      if (on) snowDepth.addTo(map);
      else snowDepth.remove();
    },
    resize() {
      map.invalidateSize();
      relayout();
    },
  };
}
