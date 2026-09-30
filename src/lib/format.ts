const intFmt = new Intl.NumberFormat('en-US');

export function fmtInt(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : intFmt.format(Math.round(n));
}

/** Compact axis labels: 1,240 → 1.2k. */
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

export function fmtPct(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : ''}${r}%`;
}

/** "Oct 1, 2026 3:00 AM" */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

/** "3h ago", "2d ago" — for table cells; full timestamp goes in the title. */
export function fmtRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** "YYYY-MM-DD" → weekday + short date, parsed as a local calendar date. */
export function fmtDay(date: string, style: 'weekday' | 'short' = 'short'): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return style === 'weekday'
    ? dt.toLocaleDateString('en-US', { weekday: 'short' })
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
