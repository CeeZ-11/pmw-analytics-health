/* PMW Analytics Health — Slack messages for the n8n daily monitor
 * ("Build Slack messages" Code node). One alert per site with NEW critical
 * issues (compared with the previous run), then one daily summary PER GROUP
 * (Elite, PMI, …). Lists are capped so a 300-site group stays readable; the
 * dashboard link opens that group's full list. */

const DASHBOARD = 'https://ceez-11.github.io/pmw-analytics-health/#/';
const GROUP_LABELS = { elite: 'Elite', pmi: 'PMI' };
const GROUP_ORDER = ['elite', 'pmi'];
const MAX_LISTED = 15;

function groupLabel(g) {
  return g ? GROUP_LABELS[g] || g.charAt(0).toUpperCase() + g.slice(1) : 'Ungrouped';
}

function buildSlackMessages(currentRows, previousRows, now) {
  const cur = currentRows.map((row) => {
    const d = JSON.parse(row.detailJson);
    return { row, d, group: d.group || '' };
  });
  const prevIssueIds = {};
  for (const r of previousRows) {
    if (!r || !r.siteId || r.isSample || !r.detailJson) continue;
    try {
      prevIssueIds[r.siteId] = new Set((JSON.parse(r.detailJson).issues || []).map((x) => x.id));
    } catch (e) {
      /* ignore unreadable previous rows */
    }
  }
  const link = (s, text) =>
    `<${DASHBOARD}sites/${encodeURIComponent(s.row.siteId)}|${text || s.row.name}>`;
  const icon = {
    critical: ':red_circle:',
    warning: ':large_yellow_circle:',
    healthy: ':large_green_circle:',
  };
  const order = { critical: 0, warning: 1, healthy: 2 };
  const messages = [];

  for (const s of cur) {
    const seen = prevIssueIds[s.row.siteId] || new Set();
    const fresh = s.d.issues.filter((i) => i.severity === 'critical' && !seen.has(i.id));
    if (!fresh.length) continue;
    messages.push(
      `:rotating_light: *Critical: ${s.row.name}* (${s.d.domain}) · ${groupLabel(s.group)}\n` +
        fresh.map((i) => `• *${i.title}* — ${i.detail}`).join('\n') +
        `\n${link(s, 'Open in dashboard')}`,
    );
  }

  const date = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
  const groups = [...new Set(cur.map((s) => s.group))].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  for (const g of groups) {
    const sites = cur.filter((s) => s.group === g);
    const counts = { healthy: 0, warning: 0, critical: 0 };
    sites.forEach((s) => (counts[s.row.status] += 1));
    const groupLink = `${DASHBOARD}${g ? `?group=${encodeURIComponent(g)}` : ''}`;
    const attention = sites
      .filter((s) => s.row.status !== 'healthy')
      .sort(
        (a, b) => order[a.row.status] - order[b.row.status] || a.row.name.localeCompare(b.row.name),
      );
    const lines = attention.slice(0, MAX_LISTED).map((s) => {
      const titles = s.d.issues
        .slice(0, 2)
        .map((i) => i.title)
        .join('; ');
      const more = s.d.issues.length > 2 ? ` (+${s.d.issues.length - 2} more)` : '';
      return `${icon[s.row.status]} ${link(s)} — ${titles}${more}`;
    });
    if (attention.length > MAX_LISTED) {
      lines.push(
        `…and ${attention.length - MAX_LISTED} more — <${groupLink}|see all in the dashboard>`,
      );
    }
    const healthy = sites.filter((s) => s.row.status === 'healthy').map((s) => s.row.name);
    let text =
      `*PMW Analytics Health · ${groupLabel(g)} — ${date}*\n` +
      `${sites.length} sites · ${icon.healthy} ${counts.healthy} healthy · ${icon.warning} ${counts.warning} warning · ${icon.critical} ${counts.critical} critical`;
    if (lines.length) text += `\n\n*Needs attention*\n${lines.join('\n')}`;
    if (healthy.length && healthy.length <= MAX_LISTED)
      text += `\n\n*Healthy:* ${healthy.join(', ')}`;
    text += `\n\n<${groupLink}|Open ${groupLabel(g)} in the dashboard>`;
    messages.push(text);
  }
  return messages;
}

// ---- n8n glue (below this line is replaced in the Code node) ----
if (typeof module !== 'undefined') module.exports = { buildSlackMessages };
