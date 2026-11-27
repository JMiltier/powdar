// The past views' numbers (−1d, −3d, −7d), one copy for both the app (public/app.js) and the build's
// audit (src/audit.js), so what's checked is exactly what's shown. Every function takes the resort and
// a context: { today: 'YYYY-MM-DD' (the data's), tz: the area's time zone, now: ms }.

const HOUR = 3_600_000;
export const REPORT_HOUR = 7;
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
// ("…06:54:18.757032-07:00": six digits of seconds, which not every browser reads; a bare date is 7 AM.)
export const isoMs = (iso) => {
  const s = String(iso ?? '');
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T14:00:00Z` : s.replace(/(\.\d{3})\d+/, '$1'));
};

// This morning's report time: the latest 7 AM in the area. Resorts' morning reports give the 24 hours
// to about then, and the models' estimates are reckoned to it too (src/report.js reportAnchor), so
// every number on the map covers the same hours.
export function reportAnchor({ tz, now }) {
  const hourIn = (t) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)));
  let t = Math.floor(now / HOUR) * HOUR;
  for (let i = 0; i < 26 && hourIn(t) !== REPORT_HOUR; i++) t -= HOUR;
  return t;
}

// The models' estimates to this morning's report time: { h24, h72, h168 } (the build gives today's and
// tomorrow's; the one that matches now), adjusted to the neighbors' reports where the build could
// (src/report.js calibrateNearby). Or null.
export function modelPast(r, ctx) {
  const list = r.forecast?.nearby?.past?.length ? r.forecast.nearby.past : r.forecast?.past;
  if (!list?.length) return r.forecast?.past24 != null ? { h24: r.forecast.past24, h72: null, h168: null } : null;
  const a = reportAnchor(ctx);
  return list.find((p) => Math.abs(p.asOf - a) < HOUR) ?? list[0];
}

// A resort's report while it's this morning's (or later): posted since 3 AM on the day of this
// morning's report time. An older one is the day before's, not the last 24 hours.
export function reportCurrent(r, ctx) {
  const rep = r.report;
  if (!rep || rep.staleSince) return false;
  if (!rep.updated) return true; // (Ski Utah's list carries no time: it only shows today's)
  const t = isoMs(rep.updated);
  return !Number.isFinite(t) || t >= reportAnchor(ctx) - 4 * HOUR;
}

// The last 24 hours: the resort's current report, otherwise the models' estimate of the same hours (est.).
export function last24(r, ctx) {
  if (reportCurrent(r, ctx) && r.report.new24 != null) return { v: r.report.new24, est: false };
  const m = modelPast(r, ctx)?.h24;
  return { v: m ?? null, est: m != null };
}

// The last n report days (7 AM to 7 AM), oldest first: what the resort reported where it did (its
// snow log, src/report.js snowLog), otherwise the models' estimate (est: true).
export function pastSnow(r, n, ctx) {
  const logged = new Map((r.snowLog ?? []).map((e) => [e.date, e.snow]));
  const near = r.forecast?.nearby?.days ?? {};
  const model = new Map((r.forecast?.pastDays ?? []).map((d) => [d.date, near[d.date] ?? d.snow]));
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(ctx.today, i - n);
    if (logged.has(date)) return { date, snow: logged.get(date), est: false };
    const m = model.get(date);
    return { date, snow: m ?? null, est: m != null };
  });
}

// A resort's own 72-hour or 7-day total, unless it's more than its day-by-day reports can account for:
// with every day reported, much over their sum; otherwise wildly over the reported days plus the
// estimate of the rest (Northstar, Nov 26, 2026: "7 days 39.8″" over six reported days of 0″ and one
// estimated at ~11″; its page said 18″ later the same morning). Under the days' sum it stands: then the
// log has counted something twice (Beaver Creek, Nov 23: 20.5″ logged, its own 13.8″).
export function ownFits(r, n, own, ctx) {
  const days = pastSnow(r, n, ctx);
  const logged = days.filter((d) => !d.est && d.snow != null);
  const sum = logged.reduce((a, d) => a + d.snow, 0);
  const rest = days.filter((d) => d.est || d.snow == null).reduce((a, d) => a + (d.snow ?? 0), 0);
  if (!logged.length || own <= sum) return true;
  if (logged.length === n) return own - sum <= Math.max(2, 0.25 * sum);
  return own - sum <= 2.5 * rest + 3;
}

// The resort's own figure for the span while its report is current (and its days account for it); with
// nothing it reported in the span, the models' total for the same hours; otherwise its reported days
// added up, the models' estimate of each report day filling any it didn't report (est.).
export function pastSpan(r, n, own, ctx) {
  if (own != null && reportCurrent(r, ctx) && ownFits(r, n, own, ctx)) return { v: own, est: false };
  const rolling = n === 3 ? modelPast(r, ctx)?.h72 : modelPast(r, ctx)?.h168;
  if (rolling != null && !(r.snowLog ?? []).some((e) => e.date >= addDays(ctx.today, -n))) return { v: rolling, est: true };
  // (A day logged for today, from an older build's afternoon rule, counts as the last of the n.)
  const todays = (r.snowLog ?? []).find((e) => e.date === ctx.today);
  const days = todays ? [...pastSnow(r, n - 1, ctx), { date: ctx.today, snow: todays.snow, est: false }] : pastSnow(r, n, ctx);
  if (days.every((d) => d.snow == null)) return { v: null, est: false };
  return { v: Math.round(days.reduce((a, d) => a + (d.snow ?? 0), 0) * 10) / 10, est: days.some((d) => d.est || d.snow == null) };
}

// The last 3 and 7 days. Each holds the span before it (the last 3 days include the last 24 hours, the
// week the last 3 days), so they never read less than it: −1d ≤ −3d ≤ −7d. The 3 days also stay
// within the resort's own current figures: at least its 48 hours, at most its 7 days.
export function pastTotal(r, n, ctx) {
  const own = n === 3 ? r.report?.new72 : r.report?.new7d;
  const inner = n === 3 ? last24(r, ctx) : pastTotal(r, 3, ctx);
  let span = pastSpan(r, n, own, ctx);
  if (n === 3 && span.v != null && reportCurrent(r, ctx)) {
    const { new48, new7d } = r.report;
    if (new7d != null && span.v > new7d) span = { v: new7d, est: false };
    if (new48 != null && span.v < new48) span = { v: new48, est: span.est };
  }
  return inner.v != null && (span.v == null || inner.v > span.v) ? { v: inner.v, est: inner.est || span.est } : span;
}

// All three at once: { d1, d3, d7 }, each { v, est }.
export const pastViews = (r, ctx) => ({ d1: last24(r, ctx), d3: pastTotal(r, 3, ctx), d7: pastTotal(r, 7, ctx) });
