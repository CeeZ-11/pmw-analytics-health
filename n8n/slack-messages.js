/* PMW Analytics Health — Slack messages for the n8n daily monitor
 * ("Build Slack messages" Code node). One alert per site with NEW critical
 * issues (compared with the previous run), then one daily summary. */

const DASHBOARD = 'https://ceez-11.github.io/pmw-analytics-health/#/';

function buildSlackMessages(currentRows, previousRows, now) {
  const cur = currentRows.map((row) => ({ row, d: JSON.parse(row.detailJson) }));
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
      `:rotating_light: *Critical: ${s.row.name}* (${s.d.domain})\n` +
        fresh.map((i) => `• *${i.title}* — ${i.detail}`).join('\n') +
        `\n${link(s, 'Open in dashboard')}`,
    );
  }

  const counts = { healthy: 0, warning: 0, critical: 0 };
  cur.forEach((s) => (counts[s.row.status] += 1));
  const date = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
  const attention = cur
    .filter((s) => s.row.status !== 'healthy')
    .sort(
      (a, b) => order[a.row.status] - order[b.row.status] || a.row.name.localeCompare(b.row.name),
    )
    .map((s) => {
      const titles = s.d.issues
        .slice(0, 2)
        .map((i) => i.title)
        .join('; ');
      const more = s.d.issues.length > 2 ? ` (+${s.d.issues.length - 2} more)` : '';
      return `${icon[s.row.status]} ${link(s)} — ${titles}${more}`;
    });
  const healthy = cur.filter((s) => s.row.status === 'healthy').map((s) => s.row.name);
  let text =
    `*PMW Analytics Health — ${date}*\n` +
    `${cur.length} sites · ${icon.healthy} ${counts.healthy} healthy · ${icon.warning} ${counts.warning} warning · ${icon.critical} ${counts.critical} critical`;
  if (attention.length) text += `\n\n*Needs attention*\n${attention.join('\n')}`;
  if (healthy.length) text += `\n\n*Healthy:* ${healthy.join(', ')}`;
  text += `\n\n<${DASHBOARD}|Open dashboard>`;
  messages.push(text);
  return messages;
}

// ---- n8n glue (below this line is replaced in the Code node) ----
if (typeof module !== 'undefined') module.exports = { buildSlackMessages };
