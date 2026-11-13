// The map view: one bubble per resort showing the chosen number, Snow Map style.
// Every resort has a dot at its real spot. Its bubble sits on the dot or right beside it;
// resorts too close together share one card that lists them all.
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
// Widest a shared card's neighbourhood may be, in screen pixels.
const MAX_SPAN = 85;
// Room around the resorts when fitting them on screen, on top of what the app's panels cover.
const EDGE = 58;

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

  // Resorts close enough that their bubbles would collide share one card listing each name and
  // number, so every resort stays readable at any zoom. Zoom in and the cards split apart.
  const groupLayer = L.layerGroup().addTo(map);

  function groupCard(members, centre) {
    const el = document.createElement('div');
    el.className = 'group';
    el.innerHTML = members.map((m) => `
      <button type="button" class="group-row${m.selected ? ' is-selected' : ''}" data-id="${m.r.id}" aria-label="${m.r.name}: ${m.label}">
        <span class="group-name">${m.open ? '<i class="open-dot"></i>' : ''}${SHORT[m.r.id] ?? m.r.name}</span>
        <b class="group-val lvl-${m.level}">${m.text}</b>
      </button>`).join('');
    el.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      L.DomEvent.stopPropagation(e);
      onSelect(row.dataset.id);
    });
    const marker = L.marker(map.containerPointToLatLng(centre), {
      icon: L.divIcon({ html: el, className: 'pin-host', iconSize: [0, 0] }), keyboard: false, zIndexOffset: 500,
    }).addTo(groupLayer);
    return { el, marker };
  }

  function layout() {
    groupLayer.clearLayers();
    for (const { pin } of order) pin.root.classList.remove('hidden', 'grouped');
    const items = order.map((o) => ({ ...o, p: map.latLngToContainerPoint(o.r.at), w: o.pin.bubble.offsetWidth, h: o.pin.bubble.offsetHeight }));
    const named = items.filter((it) => !it.empty);

    // Group resorts whose bubbles would collide, nearest pairs first, but keep every group tight:
    // no two members further apart than MAX_SPAN, so groups stay local (Summit County, Aspen…).
    const group = new Map(named.map((it) => [it, [it]]));
    const dist = (a, b) => Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);
    const merge = (a, b) => {
      const ga = group.get(a);
      const gb = group.get(b);
      if (ga === gb) return;
      const both = ga.concat(gb);
      for (const m of both) group.set(m, both);
    };
    const pairs = [];
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length; j++) {
        const a = named[i];
        const b = named[j];
        if (Math.abs(a.p.x - b.p.x) < (a.w + b.w) / 2 + GAP && Math.abs(a.p.y - b.p.y) < (a.h + b.h) / 2 + GAP) pairs.push([dist(a, b), a, b]);
      }
    }
    pairs.sort((x, y) => x[0] - y[0]);
    for (const [, a, b] of pairs) {
      const ga = group.get(a);
      const gb = group.get(b);
      if (ga !== gb && ga.every((x) => gb.every((y) => dist(x, y) <= MAX_SPAN))) merge(a, b);
    }

    // Place cards and single bubbles; anything that can't fit joins its nearest neighbour's group, then retry.
    for (let attempt = 0; attempt < 6; attempt++) {
      groupLayer.clearLayers();
      const groups = new Set(named.map((it) => group.get(it)));
      const placed = [];
      const overlaps = (box) => placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      const tryPlace = (cx, cy, w, h, spots) => {
        for (const [dx, dy] of spots) {
          const box = [cx + dx - w / 2 - GAP, cy + dy - h / 2 - GAP, cx + dx + w / 2 + GAP, cy + dy + h / 2 + GAP];
          if (!overlaps(box)) {
            placed.push(box);
            return [dx, dy];
          }
        }
        return null;
      };
      const failed = [];
      // Bigger groups first: they need the most room.
      const list = [...groups].sort((a, b) => b.length - a.length);
      for (const members of list) {
        if (members.length > 1) {
          const cx = members.reduce((s, m) => s + m.p.x, 0) / members.length;
          const cy = members.reduce((s, m) => s + m.p.y, 0) / members.length;
          const card = groupCard(members, [cx, cy]);
          const w = card.el.offsetWidth;
          const h = card.el.offsetHeight;
          const spot = tryPlace(cx, cy, w, h, [...spotsFor(w, h), ...spotsFor(w * 2, h * 2)]) ?? [0, 0];
          card.el.style.transform = `translate(${spot[0] - w / 2}px, ${spot[1] - h / 2}px)`;
          for (const m of members) m.pin.root.classList.add('grouped');
        } else {
          const [it] = members;
          const spot = tryPlace(it.p.x, it.p.y, it.w, it.h, spotsFor(it.w, it.h));
          if (!spot) {
            failed.push(it);
            continue;
          }
          it.pin.bubble.style.transform = `translate(${spot[0] - it.w / 2}px, ${spot[1] - it.h / 2}px)`;
        }
      }
      if (!failed.length) break;
      for (const it of failed) {
        const nearest = named.filter((o) => o !== it).sort((a, b) => dist(a, it) - dist(b, it))[0];
        if (nearest) merge(it, nearest);
      }
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
