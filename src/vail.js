// Vail Resorts' Colorado mountains (Vail, Beaver Creek, Breckenridge, Keystone, Crested Butte) aren't in
// Colorado Ski Country's feed. Each publishes its snow report and lift/run status on its own site, as
// data embedded in the page (FR.snowReportData, FR.TerrainStatusFeed). Their robots.txt allows these
// pages; we read them with a plainly named User-Agent, a few times an hour at most.

export const VAIL_SITES = {
  vail: 'https://www.vail.com',
  'beaver-creek': 'https://www.beavercreek.com',
  breckenridge: 'https://www.breckenridge.com',
  keystone: 'https://www.keystoneresort.com',
  'crested-butte': 'https://www.skicb.com',
};
// Crested Butte names its pages differently.
const PAGES = {
  default: ['snow-and-weather-report.aspx', 'terrain-and-lift-status.aspx'],
  'https://www.skicb.com': ['weather-report.aspx', 'lift-and-terrain-status.aspx'],
};
const pages = (site) => PAGES[site] ?? PAGES.default;
export const snowPage = (site) => `${site}/the-mountain/mountain-conditions/${pages(site)[0]}`;
export const liftPage = (site) => `${site}/the-mountain/mountain-conditions/${pages(site)[1]}`;

// The JSON object assigned to `FR.<name> =` in the page (braces inside strings are skipped).
// from: where to start looking (a page can assign the same name more than once).
export function embedded(html, name, from = 0) {
  const at = html.indexOf(`FR.${name} =`, from);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

const inches = (v) => {
  const n = Number(v?.Inches);
  return Number.isFinite(n) ? n : null;
};

// Snow report → the same shape as a Colorado Ski Country report.
export function parseVailSnow(html) {
  const d = embedded(html, 'snowReportData');
  if (!d) return null;
  // "Updated November 13, 2026 at 6:02 AM MST" → ISO time.
  const m = /Updated (\w+ \d+, \d{4}) at (\d+:\d+ [AP]M) (M[SD]T)/.exec(d.LastUpdatedText ?? '');
  const updated = m ? new Date(`${m[1]} ${m[2]} GMT${m[3] === 'MDT' ? '-0600' : '-0700'}`) : null;
  return {
    depth: inches(d.BaseDepth),
    new24: inches(d.TwentyFourHourSnowfall),
    new48: inches(d.FortyEightHourSnowfall),
    new7d: inches(d.SevenDaySnowfall),
    seasonTotal: inches(d.CurrentSeason),
    surface: d.OverallSnowConditions || null,
    updated: updated && !Number.isNaN(updated.getTime()) ? updated.toISOString() : null,
    message: null,
  };
}

// Lift and run status. Status codes, as the page itself labels them.
const LIFT_STATUS = ['closed', 'open', 'hold', 'scheduled'];
const hhmm = (t) => {
  const [h, m] = String(t ?? '').split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
};
export function parseVailTerrain(html) {
  // The first copy with lifts in it (Crested Butte's page carries an empty one first).
  let d = null;
  for (let at = html.indexOf('FR.TerrainStatusFeed ='); at >= 0; at = html.indexOf('FR.TerrainStatusFeed =', at + 1)) {
    const x = embedded(html, 'TerrainStatusFeed', at);
    if (x?.Lifts?.length) { d = x; break; }
  }
  if (!d) return null;
  const lifts = d.Lifts.map((l) => ({
    name: l.Name,
    status: LIFT_STATUS[l.Status] ?? 'closed',
    hours: l.OpenTime && l.CloseTime ? `${hhmm(l.OpenTime)}–${hhmm(l.CloseTime)}` : null,
  }));
  const trails = (d.GroomingAreas ?? []).flatMap((a) => a.Trails ?? []);
  return { lifts, trails: { open: trails.filter((t) => t.IsOpen).length, total: trails.length } };
}

// Webcams: the mountain-cams page embeds Brownrice players (player.brownrice.com/embed/<id>, whose
// current frame is …/snapshot/<id>) and sometimes still images (cache.snow.com/Mtncams/*.jpg, e.g. the
// snow stake). → [{ name, image, live }], snow stake first.
export const camsPage = (site) => `${site}/the-mountain/mountain-conditions/mountain-cams.aspx`;
const WORDS = ['north', 'south', 'east', 'west', 'peak', 'summit', 'base', 'village', 'river', 'run', 'lake', 'side', 'top',
  'bowl', 'express', 'lodge', 'mountain', 'mid', 'upper', 'lower', 'snow', 'stake', 'park', 'gondola', 'plaza', 'blue', 'sky', 'basin',
  'back', 'bowls', 'eagles', 'nest', 'beaver', 'creek', 'spruce', 'saddle', 'outpost', 'dercum', 'bergman', 'peak'];
// "keystonenorthpeak" → "North Peak" (the resort's own name dropped; known words split out).
export function camName(id, prefixes = []) {
  let rest = id.toLowerCase();
  for (const p of prefixes) if (rest.startsWith(p) && rest.length > p.length) { rest = rest.slice(p.length); break; }
  const parts = [];
  while (rest) {
    const w = WORDS.filter((x) => rest.startsWith(x)).sort((a, b) => b.length - a.length)[0];
    if (w) { parts.push(w); rest = rest.slice(w.length); continue; }
    const next = WORDS.map((x) => rest.indexOf(x)).filter((i) => i > 0).sort((a, b) => a - b)[0] ?? rest.length;
    parts.push(rest.slice(0, next));
    rest = rest.slice(next);
  }
  return parts.map((x) => x[0].toUpperCase() + x.slice(1)).join(' ');
}
export function parseVailCams(html, prefixes = []) {
  const cams = [];
  for (const m of html.matchAll(/cache\.snow\.com\/Mtncams\/([A-Za-z0-9_]+)\.jpg/g)) {
    if (cams.some((c) => c.image.includes(m[1]))) continue;
    cams.push({ name: /stake/i.test(m[1]) ? 'Snow Stake' : camName(m[1].replace(/^[A-Z][a-z]+/, ''), []), image: `https://cache.snow.com/Mtncams/${m[1]}.jpg` });
  }
  for (const m of html.matchAll(/player\.brownrice\.com\/embed\/([a-z0-9]+)/g)) {
    if (cams.some((c) => c.live?.endsWith(`/${m[1]}`))) continue;
    cams.push({ name: camName(m[1], prefixes), image: `https://player.brownrice.com/snapshot/${m[1]}`, live: `https://player.brownrice.com/embed/${m[1]}` });
  }
  return cams.sort((a, b) => (b.name === 'Snow Stake') - (a.name === 'Snow Stake')).slice(0, 6);
}
