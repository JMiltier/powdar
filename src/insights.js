// "Today in Colorado": what the National Weather Service's forecasters are saying, and its active
// alerts that matter for skiing and getting there. Both straight from api.weather.gov, quoted as written.
//  - Forecast Discussions: each Colorado office's "KEY MESSAGES" (a few bullets a meteorologist writes
//    with each discussion, several times a day).
//  - Active alerts in Colorado: winter storms, blizzards, high wind, avalanches, extreme cold.

const NWS = 'https://api.weather.gov';
export const OFFICES = [
  { id: 'BOU', name: 'Boulder', covers: 'Front Range, Summit County and the northern mountains' },
  { id: 'GJT', name: 'Grand Junction', covers: 'the western and central mountains, Aspen to the San Juans' },
  { id: 'PUB', name: 'Pueblo', covers: 'the southern mountains: Sangre de Cristos, eastern San Juans, Monarch' },
];
const ALERT_EVENTS = /winter|snow|blizzard|ice storm|avalanche|high wind|wind chill|extreme cold|cold weather/i;

// "- First line\n  continued\n\n- Second" → ["First line continued", "Second"].
export function keyMessages(text) {
  const m = /\.KEY MESSAGES\.\.\.([\s\S]*?)(?=\n&&|\n\.[A-Z][A-Z /]+\.\.\.)/.exec(text ?? '');
  if (!m) return [];
  return m[1].split(/\n\s*-\s+/).map((s) => s.replace(/^\s*-\s+/, '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6);
}

export async function fetchInsights(getJson, fetchFn, { backoff = 2000, log = () => {} } = {}) {
  const discussions = (await Promise.all(OFFICES.map(async (o) => {
    try {
      const list = await getJson(fetchFn, `${NWS}/products/types/AFD/locations/${o.id}`, { backoff });
      const latest = list['@graph']?.[0];
      if (!latest) return null;
      const product = await getJson(fetchFn, `${NWS}/products/${latest.id}`, { backoff });
      const messages = keyMessages(product.productText);
      if (!messages.length) return null;
      return {
        office: o.id, name: o.name, covers: o.covers, issued: latest.issuanceTime, messages,
        url: `https://forecast.weather.gov/product.php?site=${o.id}&issuedby=${o.id}&product=AFD`,
      };
    } catch (err) {
      log(`Forecast discussion failed for ${o.id}: ${err.message}`);
      return null;
    }
  }))).filter(Boolean);

  let alerts = [];
  try {
    const res = await getJson(fetchFn, `${NWS}/alerts/active?area=CO`, { backoff });
    const seen = new Set();
    alerts = (res.features ?? []).map((f) => f.properties).filter((p) => ALERT_EVENTS.test(p.event ?? ''))
      // The same alert is often issued for several zones: one entry per event and wording.
      .filter((p) => { const k = `${p.event}|${p.headline}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((p) => ({
        event: p.event, severity: p.severity, headline: p.headline, areas: p.areaDesc,
        onset: p.onset ?? p.effective, ends: p.ends ?? p.expires, office: p.senderName,
      }))
      .sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || String(a.onset).localeCompare(String(b.onset)))
      .slice(0, 8);
  } catch (err) {
    log(`Weather alerts failed: ${err.message}`);
    alerts = null; // (unknown, not "none")
  }
  return { discussions, alerts, checked: new Date().toISOString() };
}
const sevRank = (s) => ({ Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 }[s] ?? 0);
