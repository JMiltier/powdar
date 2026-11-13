// One icon set for the whole app (no emoji, no text glyphs): 24×24, drawn to match.
// Weather icons are filled (sun amber, cloud soft grey via --cloud, precipitation blue via --precip);
// interface icons are 2px round strokes in the current text color.

const svg = (body, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

const CLOUD = 'M7.2 18.5h9.9a4.1 4.1 0 0 0 .55-8.16A5.6 5.6 0 0 0 6.85 9.4 4.55 4.55 0 0 0 7.2 18.5z';
const CLOUD_HIGH = 'M7.2 15h9.9a4.1 4.1 0 0 0 .55-8.16A5.6 5.6 0 0 0 6.85 5.9 4.55 4.55 0 0 0 7.2 15z';
const sun = (cx, cy, r, rays = true) => {
  const lines = rays ? [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
    const t = (a * Math.PI) / 180;
    const p = (k) => `${(cx + Math.cos(t) * k).toFixed(2)} ${(cy + Math.sin(t) * k).toFixed(2)}`;
    return `M${p(r + 2)}L${p(r + 3.6)}`;
  }).join('') : '';
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--sun)"/>${rays ? `<path d="${lines}" stroke="var(--sun)" stroke-width="1.7" stroke-linecap="round"/>` : ''}`;
};
const flakes = (pts) => pts.map(([x, y]) => `<path d="M${x} ${y - 1.6}v3.2M${x - 1.4} ${y - 0.8}l2.8 1.6M${x - 1.4} ${y + 0.8}l2.8-1.6" stroke="var(--precip)" stroke-width="1.2" stroke-linecap="round"/>`).join('');
const drops = (pts) => pts.map(([x, y]) => `<path d="M${x + 0.8} ${y - 1.8}l-1.6 3.6" stroke="var(--precip)" stroke-width="1.6" stroke-linecap="round"/>`).join('');

export const WX = {
  sun: svg(sun(12, 12, 4.4)),
  partly: svg(`${sun(8.6, 8.4, 3.4)}<path d="${CLOUD}" fill="var(--cloud)"/>`),
  cloud: svg(`<path d="${CLOUD}" fill="var(--cloud)"/>`),
  snow: svg(`<path d="${CLOUD_HIGH}" fill="var(--cloud)"/>${flakes([[8, 18.6], [12, 20.2], [16, 18.6]])}`),
  rain: svg(`<path d="${CLOUD_HIGH}" fill="var(--cloud)"/>${drops([[8, 18.8], [12, 20.2], [16, 18.8]])}`),
  mix: svg(`<path d="${CLOUD_HIGH}" fill="var(--cloud)"/>${drops([[8.5, 19]])}${flakes([[13.5, 19.6]])}`),
  thunder: svg(`<path d="${CLOUD_HIGH}" fill="var(--cloud)"/><path d="M12.6 14.2l-2.6 4h2.4l-1.2 3.6 3.6-4.8h-2.5l1.4-2.8z" fill="var(--sun)"/>`),
  fog: svg(`<path d="${CLOUD_HIGH}" fill="var(--cloud)" opacity="0.7"/><path d="M5 17.5h14M7 20.5h10" stroke="var(--cloud)" stroke-width="1.8" stroke-linecap="round"/>`),
  wind: svg('<path d="M3.5 9h10.5a2.6 2.6 0 1 0-2.6-2.6M3.5 13h14a2.6 2.6 0 1 1-2.6 2.6M3.5 17h7" fill="none" stroke="var(--cloud)" stroke-width="1.9" stroke-linecap="round"/>'),
};

// Forecast wording ("Chance Snow Showers", "Mostly Sunny"…) → an icon.
export function weatherIcon(text = '') {
  const t = String(text).toLowerCase();
  if (!t) return '';
  if (/thunder/.test(t)) return WX.thunder;
  if (/(snow|flurr|blizzard).*(rain|drizzle)|(rain|drizzle).*(snow|flurr)|sleet|wintry/.test(t)) return WX.mix;
  if (/snow|flurr|blizzard/.test(t)) return WX.snow;
  if (/rain|drizzle|showers/.test(t)) return WX.rain;
  if (/fog|haze|smoke/.test(t)) return WX.fog;
  if (/partly|mostly sunny|mostly clear|few clouds/.test(t)) return WX.partly;
  if (/sunny|clear/.test(t)) return WX.sun;
  if (/cloud|overcast/.test(t)) return WX.cloud;
  if (/wind|breezy/.test(t)) return WX.wind;
  return '';
}

const stroke = (d, extra = '') => svg(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}/>`, 'ic ic-ui');
export const UI = {
  back: stroke('M15 5l-7 7 7 7'),
  chevron: stroke('M9 6l6 6-6 6'),
  star: stroke('M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 16.9l-5.2 2.75 1-5.8-4.2-4.1 5.8-.85z'),
  starFilled: svg('<path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 16.9l-5.2 2.75 1-5.8-4.2-4.1 5.8-.85z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>', 'ic ic-ui'),
  info: svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.35" fill="currentColor"/>', 'ic ic-ui'),
  // (index.html carries copies of info and layers, so they show before the script runs.)
  // Map layers: Powdar's snowflake (the logo's, one branch pair per arm) with two radar arcs off its
  // top right, as in the logo.
  layers: (() => {
    const [cx, cy] = [9.6, 14.4];
    const arc = (r) => {
      const p = (deg) => `${(cx + r * Math.cos((deg * Math.PI) / 180)).toFixed(2)} ${(cy + r * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
      return `M${p(-84)}A${r} ${r} 0 0 1 ${p(-6)}`;
    };
    const arms = [0, 60, 120, 180, 240, 300].map((a) => `<path transform="rotate(${a} ${cx} ${cy})" d="M${cx} ${cy - 1.5}V${cy - 7.2}M${cx - 2.2} ${cy - 5.6}l2.2 1.3 2.2-1.3"/>`).join('');
    return svg(`<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="${arc(10)}" stroke-width="1.8" opacity="0.75"/><path d="${arc(13.4)}" stroke-width="1.8" opacity="0.45"/>
      <g stroke-width="1.9">${arms}</g></g>`, 'ic ic-ui');
  })(),
};
