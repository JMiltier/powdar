// Lift status only changes while lifts can be running, so feeds are checked during the ski day only,
// plus once after it ends (so the last word overnight is "closed", not a stale "open").
// Colorado lifts run about 8:30–4; elsewhere, night skiing (Midwest, East) runs to about 9–10 pm.

// Each state's main time zone (good enough for a check window).
export const STATE_TZ = {
  AK: 'America/Anchorage', AZ: 'America/Phoenix', CA: 'America/Los_Angeles', CO: 'America/Denver', ID: 'America/Boise',
  MT: 'America/Denver', NM: 'America/Denver', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', UT: 'America/Denver',
  WA: 'America/Los_Angeles', WY: 'America/Denver', SD: 'America/Denver', ND: 'America/Chicago',
  IA: 'America/Chicago', IL: 'America/Chicago', MN: 'America/Chicago', MO: 'America/Chicago', WI: 'America/Chicago', AL: 'America/Chicago',
  TN: 'America/New_York', IN: 'America/Indiana/Indianapolis', MI: 'America/Detroit',
};
const tzOf = (code) => STATE_TZ[code] ?? 'America/New_York';

// Hours (local) when lift status is worth checking.
export const windowFor = (code) => (code === 'CO' ? [7, 17] : [7, 22]);

const localHour = (date, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return Number(p.hour) + Number(p.minute) / 60;
};
const inWindow = (date, code) => {
  const h = localHour(date, tzOf(code));
  const [from, to] = windowFor(code);
  return h >= from && h < to;
};

// Should this update check lift feeds? `lastChecked`: when they were last checked (ISO), if ever.
export function liftsDue(code, now = new Date(), lastChecked = null) {
  if (inWindow(now, code)) return true;
  if (!lastChecked) return true;
  // Outside the window: one last check if the previous one was during the ski day (within 14 hours).
  const last = new Date(lastChecked);
  return now - last < 14 * 3_600_000 && inWindow(last, code);
}
