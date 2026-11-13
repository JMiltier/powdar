// The map view: one bubble per resort showing the chosen number, Snow Map style.
// Every resort has a dot at its real spot and its own one-line label ("A-Basin 3″") on or next to
// the dot. When there's truly no room a label waits for you to zoom in; the dot stays tappable.
const L = window.L;

// OpenTopoMap: free, no key, and its terrain shading suits mountains. Dark mode dims it in CSS.
const TILES = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
// Shown behind the ⓘ button instead of a permanent banner.
export const CREDITS = 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · '
  + 'map style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · '
  + 'snow cover: <a href="https://www.nohrsc.noaa.gov/nsa/">NOAA NOHRSC</a> · <a href="https://leafletjs.com">Leaflet</a>';
// NOAA's daily national snow analysis (NOHRSC): modelled snow depth on the ground, cloud-free.
const SNOW_DEPTH_WMS = 'https://mapservices.weather.noaa.gov/raster/services/snow/NOHRSC_Snow_Analysis/MapServer/WMSServer';
const GAP = 2;
const DOT_R = 4;
// Room around the resorts when fitting them on screen, on top of what the app's panels cover.
const EDGE = 58;

const SHORT = {
  'arapahoe-basin': 'A-Basin', 'copper-mountain': 'Copper', breckenridge: 'Breck', 'beaver-creek': 'Beaver Creek',
  'echo-mountain': 'Echo', 'granby-ranch': 'Granby', 'howelsen-hill': 'Howelsen', 'aspen-mountain': 'Aspen Mtn',
  'aspen-highlands': 'Highlands', 'crested-butte': 'Crested Butte', cooper: 'Cooper',
};

// Where a label may sit, as its centre relative to the dot: on it, touching it on each side,
// then one row further up or down (still clearly next to its dot, so no connector line needed).
const spotsFor = (w, h) => {
  const x = w / 2 + DOT_R + 2;
  const y = h / 2 + DOT_R + 1;
  const y2 = y + h + 2;
  return [[0, 0], [x, 0], [-x, 0], [0, -y], [0, y], [x, -y], [x, y], [-x, -y], [-x, y], [0, -y2], [0, y2], [x, -y2], [x, y2], [-x, -y2], [-x, y2]];
};

// getPadding() → { top, right, bottom, left }: pixels covered by the app's buttons and sheet.
export function createSnowMap(el, { resorts, onSelect, getPadding, home }) {
  const bounds = L.latLngBounds(resorts.map((r) => r.at));
  const map = L.map(el, {
    zoomControl: false, attributionControl: false, maxZoom: 12, zoomSnap: 0.25, zoomDelta: 0.5,
    maxBounds: bounds.pad(0.4), maxBoundsViscosity: 0.8,
  });
  // Pinch zoom covers phones; mouse users get +/- buttons.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer(TILES, { subdomains: 'abc', maxZoom: 12 }).addTo(map);

  // Its own pane so the colour-muting filter on the base map doesn't wash it out.
  map.createPane('snow').style.zIndex = 250;
  map.createPane('dots').style.zIndex = 590; // just under the labels (markerPane is 600)
  const snowDepth = L.tileLayer.wms(SNOW_DEPTH_WMS, {
    pane: 'snow', layers: '0', format: 'image/png', transparent: true, version: '1.3.0', opacity: 0.75,
  });

  const fitOptions = () => {
    const p = getPadding();
    return { paddingTopLeft: [p.left + EDGE, p.top + EDGE / 2], paddingBottomRight: [p.right + EDGE, p.bottom + EDGE / 2] };
  };
  // You can't zoom out past "every resort fits": no more drifting out to New Mexico.
  function lockZoom() {
    const o = fitOptions();
    const pad = L.point(o.paddingTopLeft).add(o.paddingBottomRight);
    map.setMinZoom(Math.max(5, map.getBoundsZoom(bounds, false, pad) - 0.25));
  }
  const fitAll = () => map.fitBounds(bounds, fitOptions());
  const showHome = (view) => (view ? map.setView([view.lat, view.lng], Math.max(view.zoom, map.getMinZoom())) : fitAll());

  const pins = new Map();
  let order = [];
  lockZoom();
  showHome(home);

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
    for (const el of [root, dot]) {
      el.addEventListener('click', (e) => {
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

  // Greedy, in priority order: each label takes the first free spot near its dot. A first pass
  // keeps other resorts' dots uncovered; a second pass allows it rather than hiding the label.
  function layout() {
    for (const { pin } of order) pin.root.classList.remove('hidden');
    const items = order.map((o) => ({ ...o, p: map.latLngToContainerPoint(o.r.at), w: o.pin.bubble.offsetWidth, h: o.pin.bubble.offsetHeight }));
    // Labels must land in the part of the map you can see, not under the panels.
    const size = map.getSize();
    const pad = getPadding();
    const placed = [];
    const overlaps = (box) => placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
    const hidesDot = (box, self) => items.some((o) => o !== self &&
      o.p.x + DOT_R > box[0] && o.p.x - DOT_R < box[2] && o.p.y + DOT_R > box[1] && o.p.y - DOT_R < box[3]);
    const offScreen = (box) => box[0] < pad.left || box[2] > size.x - pad.right || box[1] < pad.top || box[3] > size.y;

    for (const it of items) {
      const spots = it.empty ? [[0, 0]] : spotsFor(it.w, it.h);
      const boxAt = ([dx, dy]) => [it.p.x + dx - it.w / 2 - GAP, it.p.y + dy - it.h / 2 - GAP, it.p.x + dx + it.w / 2 + GAP, it.p.y + dy + it.h / 2 + GAP];
      const dotOnScreen = !offScreen([it.p.x - 1, it.p.y - 1, it.p.x + 1, it.p.y + 1]);
      const ok = (spot, strict) => {
        const box = boxAt(spot);
        if (overlaps(box) || (dotOnScreen && offScreen(box))) return false;
        return !(strict && hidesDot(box, it));
      };
      // The selected resort always shows, even over a neighbour.
      const spot = spots.find((sp) => ok(sp, true)) ?? spots.find((sp) => ok(sp, false)) ?? (it.selected ? [0, 0] : null);
      if (!spot) {
        it.pin.root.classList.add('hidden');
        continue;
      }
      placed.push(boxAt(spot));
      it.pin.bubble.style.transform = `translate(${spot[0] - it.w / 2}px, ${spot[1] - it.h / 2}px)`;
    }
  }

  const relayout = () => layout();

  // items: [{ r, text, label, level, open, selected }] in priority order (most important first).
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
    relayout();
  }

  map.on('zoomend', relayout);
  map.on('click', () => onSelect(null));

  return {
    update,
    getView: () => ({ lat: map.getCenter().lat, lng: map.getCenter().lng, zoom: map.getZoom() }),
    showHome,
    // Centre a resort in the part of the map you can see, zooming in if we're far out.
    focus(r) {
      const p = getPadding(true);
      const z = Math.max(map.getZoom(), 8);
      const pt = map.project(r.at, z).subtract([(p.left - p.right) / 2, (p.top - p.bottom) / 2]);
      map.setView(map.unproject(pt, z), z, { animate: true });
    },
    setSnowDepth(on) {
      if (on) snowDepth.addTo(map);
      else snowDepth.remove();
    },
    resize() {
      map.invalidateSize();
      lockZoom();
      relayout();
    },
  };
}
