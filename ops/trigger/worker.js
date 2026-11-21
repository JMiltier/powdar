// Powdar's update clock. GitHub's own scheduler runs hours late, and a Mac's timer can stop without a
// word, so this runs on Cloudflare's (free plan: Cron Triggers, a few milliseconds a run): every 5
// minutes it checks how old the published data is and, once an update is due, asks GitHub to run the
// "Update snow data" workflow. Due: 13 minutes in the ski day (6 AM–7 PM Colorado time), an hour
// overnight. A run already under way finishes before it's due again, so nothing doubles up.
// Secret GITHUB_TOKEN (wrangler secret put GITHUB_TOKEN): a fine-grained token for JMiltier/powdar
// with Actions: read and write, nothing else.
const DATA = 'https://jmiltier.github.io/powdar/data/co.json';
const DISPATCH = 'https://api.github.com/repos/JMiltier/powdar/actions/workflows/update.yml/dispatches';
const MIN = 60_000;

export function dueAfter(now) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return hour >= 6 && hour < 19 ? 13 * MIN : 58 * MIN;
}

export default {
  async scheduled(event, env) {
    const now = new Date(event.scheduledTime);
    // (The whole site is published at once, so the data file's Last-Modified is the last update.)
    const res = await fetch(`${DATA}?t=${now.getTime()}`, { method: 'HEAD' });
    const age = now - Date.parse(res.headers.get('last-modified') ?? 0);
    if (res.ok && age < dueAfter(now)) return;
    const gh = await fetch(DISPATCH, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'powdar-trigger', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    console.log(`data ${Math.round(age / MIN)} min old: ${gh.status === 204 ? 'update started' : `GitHub said ${gh.status} ${await gh.text()}`}`);
  },
};
