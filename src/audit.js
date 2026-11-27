// The data check run on every update (scripts/build.mjs): what the app will show, tested against rules
// that should always hold and signs that a source has gone wrong, so a problem is caught when it
// happens rather than when someone notices it on the map. → [{ level, area, resort, check, msg }]:
//   error: a rule broken (−1d ≤ −3d ≤ −7d; a forecast outside every source it blends);
//   warn: very likely wrong data (a resort's days not adding up to its own totals; far out of line
//         with its neighbors; a big change between updates with nothing new to explain it);
//   info: worth knowing (a report gone stale).
// The app's numbers come from public/views.js, the same code the app runs.
import { pastViews, reportCurrent, pastSnow } from '../public/views.js';

const km = ([a1, o1], [a2, o2]) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((a2 - a1) * rad) / 2) ** 2 + Math.cos(a1 * rad) * Math.cos(a2 * rad) * Math.sin(((o2 - o1) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const far = (a, b) => Math.abs(a - b) > Math.max(4, 0.5 * Math.max(a, b));

export function auditArea(data, prev = null, now = Date.now()) {
  const out = [];
  const add = (level, r, check, msg) => out.push({ level, area: data.state, resort: r?.id ?? null, check, msg });
  const ctx = { today: data.today, tz: data.tz ?? 'America/Denver', now };
  const views = new Map(data.resorts.map((r) => [r.id, pastViews(r, ctx)]));
  const before = new Map((prev?.resorts ?? []).map((r) => [r.id, r]));
  const prevCtx = prev && { today: prev.today, tz: prev.tz ?? ctx.tz, now };

  for (const r of data.resorts) {
    const v = views.get(r.id);
    const rep = r.report;
    const current = reportCurrent(r, ctx);
    // The views nest.
    if (v.d1.v != null && v.d3.v != null && v.d1.v > v.d3.v + 0.05) add('error', r, 'nest', `−1d ${v.d1.v}″ is more than −3d ${v.d3.v}″`);
    if (v.d3.v != null && v.d7.v != null && v.d3.v > v.d7.v + 0.05) add('error', r, 'nest', `−3d ${v.d3.v}″ is more than −7d ${v.d7.v}″`);
    // The resort's days add up to its own totals.
    if (current) {
      const days = pastSnow(r, 7, ctx);
      const logged = days.filter((d) => !d.est && d.snow != null);
      const sum7 = logged.reduce((a, d) => a + d.snow, 0);
      // (Days it didn't report may hold the difference: allowed up to a generous multiple of the
      // estimate for them, as the app allows, public/views.js ownFits.)
      const rest = days.filter((d) => d.est || d.snow == null).reduce((a, d) => a + (d.snow ?? 0), 0);
      const tol = Math.max(2, 0.25 * rep.new7d);
      if (rep.new7d != null && logged.length >= 5 && (sum7 > rep.new7d + tol || rep.new7d - sum7 > (logged.length === 7 ? tol : 2.5 * rest + 3))) {
        add('warn', r, 'own-totals', `its days add up to ${r1(sum7)}″ over the week; its own 7-day total says ${rep.new7d}″`);
      }
      const two = days.slice(-2);
      if (rep.new48 != null && two.every((d) => !d.est && d.snow != null)) {
        const sum2 = two[0].snow + two[1].snow;
        if (Math.abs(sum2 - rep.new48) > Math.max(1.5, 0.25 * rep.new48)) add('warn', r, 'own-totals', `its last two days add up to ${r1(sum2)}″; its own 48 hours say ${rep.new48}″`);
      }
    }
    // A report gone stale at a resort that's open.
    if (r.status?.state === 'open' && rep && !current && (rep.updated || rep.staleSince)) add('info', r, 'stale', `open, but its latest report is from ${String(rep.staleSince ?? rep.updated).slice(0, 16)}`);
    // The forecast stays within the sources it blends.
    const by = Object.values(r.forecast?.next72By ?? {});
    const n72 = r.forecast?.next72;
    if (by.length >= 2 && n72 != null) {
      const hi = Math.max(...by);
      const lo = Math.min(...by);
      if (n72 > hi + 0.15) add('error', r, 'forecast', `next 72 hours ${n72}″, above every source (highest ${hi}″)`);
      if (n72 < lo - 0.15) add('error', r, 'forecast', `next 72 hours ${n72}″, below every source (lowest ${lo}″)`);
    }
    if ((r.forecast?.correction?.factor ?? 1) >= 1.6 || (r.forecast?.correction?.factor ?? 1) <= 0.7) add('info', r, 'correction', `its models are scaled ×${r.forecast.correction.factor}`);
    // Far out of line with nearby resorts' own reports (within 30 km, all current).
    if (current && rep.new24 != null) {
      const near = data.resorts.filter((o) => o !== r && o.report?.new24 != null && reportCurrent(o, ctx) && km(r.at, o.at) <= 30).map((o) => o.report.new24);
      if (near.length >= 2) {
        const sorted = [...near].sort((a, b) => a - b);
        const mid = sorted[Math.floor(sorted.length / 2)];
        if (rep.new24 > 2 * sorted.at(-1) + 4) add('warn', r, 'neighbors', `reports ${rep.new24}″ in 24 hours; nearby resorts ${sorted.join(', ')}″`);
        else if (rep.new24 === 0 && mid >= 6) add('info', r, 'neighbors', `reports 0″ in 24 hours; nearby resorts ${sorted.join(', ')}″`);
      }
    }
    // A big change since the last update, with no new report and no new forecast run to explain it.
    const p = before.get(r.id);
    if (p && prevCtx) {
      const pv = pastViews(p, prevCtx);
      const sameReport = (p.report?.updated ?? null) === (rep?.updated ?? null);
      const sameDay = prev.today === data.today;
      const sameModels = prev.sources?.modelsAt === data.sources?.modelsAt;
      for (const k of ['d1', 'd3', 'd7']) {
        if (sameReport && sameDay && sameModels && pv[k].v != null && v[k].v != null && far(pv[k].v, v[k].v)) {
          add('warn', r, 'jump', `${{ d1: '−1d', d3: '−3d', d7: '−7d' }[k]} went from ${pv[k].v}″ to ${v[k].v}″ with no new report or forecast`);
        }
      }
      const a = p.forecast?.next72;
      if (sameModels && a != null && n72 != null && far(a, n72)) add('warn', r, 'jump', `next 72 hours went from ${a}″ to ${n72}″ on the same forecast run`);
    }
  }
  return out;
}

// Markdown for the update's summary and the alert issue.
export function auditMarkdown(findings, at) {
  const lines = [`Data check, ${at}: ${findings.filter((f) => f.level === 'error').length} errors, ${findings.filter((f) => f.level === 'warn').length} warnings, ${findings.filter((f) => f.level === 'info').length} notes.`, ''];
  for (const level of ['error', 'warn', 'info']) {
    const list = findings.filter((f) => f.level === level);
    if (!list.length) continue;
    lines.push(`**${{ error: 'Errors', warn: 'Warnings', info: 'Notes' }[level]}**`);
    for (const f of list) lines.push(`- ${f.area} · ${f.resort ?? ''} · ${f.check}: ${f.msg}`);
    lines.push('');
  }
  return lines.join('\n');
}
