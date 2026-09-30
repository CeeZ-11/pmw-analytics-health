/* The reusable status system. Every health verdict and check result on every
 * page renders through these helpers, so the vocabulary (labels, tones,
 * glyphs) stays identical across the dashboard, detail page and history.
 *
 * Tones reuse the PMW Speed Engine's good / warn / poor palette. Each status
 * always pairs its color with a glyph and a text label, so it never relies on
 * color alone. */

import type { CheckResult, HealthStatus, IssueSeverity } from '../types/health';
import { esc } from './dom';

export type Tone = 'good' | 'warn' | 'poor' | 'muted';

export const STATUS_META: Record<
  HealthStatus,
  { label: string; tone: Tone; rank: number; description: string }
> = {
  healthy: { label: 'Healthy', tone: 'good', rank: 0, description: 'Everything appears normal.' },
  warning: {
    label: 'Warning',
    tone: 'warn',
    rank: 1,
    description: 'Something unusual or potentially problematic was detected.',
  },
  critical: {
    label: 'Critical',
    tone: 'poor',
    rank: 2,
    description: 'A significant issue was detected.',
  },
};

export const CHECK_META: Record<CheckResult, { label: string; tone: Tone; glyph: string }> = {
  pass: { label: 'OK', tone: 'good', glyph: '✓' },
  warn: { label: 'Warning', tone: 'warn', glyph: '!' },
  fail: { label: 'Failed', tone: 'poor', glyph: '✕' },
  unknown: { label: 'Not checked', tone: 'muted', glyph: '?' },
};

export const SEVERITY_TO_STATUS: Record<IssueSeverity, HealthStatus> = {
  warning: 'warning',
  critical: 'critical',
};

/** Pill with a colored dot: ● Healthy */
export function statusBadge(
  status: HealthStatus,
  { size = 'md' }: { size?: 'md' | 'lg' } = {},
): string {
  const m = STATUS_META[status] ?? STATUS_META.warning;
  return `<span class="status status--${m.tone}${size === 'lg' ? ' status--lg' : ''}" title="${esc(m.description)}"><i aria-hidden="true"></i>${esc(m.label)}</span>`;
}

/** Just the dot, for dense places (e.g. mobile table). */
export function statusDot(status: HealthStatus): string {
  const m = STATUS_META[status] ?? STATUS_META.warning;
  return `<span class="sdot sdot--${m.tone}" role="img" aria-label="${esc(m.label)}" title="${esc(m.label)}"></span>`;
}

/** Round ✓ / ! / ✕ / ? glyph for a single check result. */
export function checkIcon(result: CheckResult, label?: string): string {
  const m = CHECK_META[result] ?? CHECK_META.unknown;
  const text = label ? `${label}: ${m.label}` : m.label;
  return `<b class="chk chk--${m.tone}" role="img" aria-label="${esc(text)}" title="${esc(text)}">${m.glyph}</b>`;
}

export function severityPill(sev: IssueSeverity): string {
  const status = SEVERITY_TO_STATUS[sev] ?? 'warning';
  return `<span class="pill ${STATUS_META[status].tone}">${esc(STATUS_META[status].label)}</span>`;
}
