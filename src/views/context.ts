import { $ } from '../lib/dom';
import { fmtDateTime } from '../lib/format';
import { analyticsHealth } from '../services/analyticsHealth';

export interface ViewContext {
  main: HTMLElement;
  /** False once the user has navigated elsewhere — drop late responses. */
  isCurrent: () => boolean;
}

/** Top-bar "Last run …" — when n8n last completed a monitoring run. */
export function setLastRun(iso: string | null): void {
  const el = $('#last-run');
  if (el) el.textContent = iso ? `Last run ${fmtDateTime(iso)}` : '';
}

/** In api mode, relabel the top-bar pill when n8n says it's serving seed data. */
export function setSamplePill(isSample: boolean): void {
  const pill = $('#source-pill .pill');
  if (analyticsHealth.source !== 'api' || !pill || pill.classList.contains('warn') === isSample)
    return;
  pill.className = `pill ${isSample ? 'warn' : 'good'}`;
  pill.textContent = isSample ? 'Sample data · n8n' : 'Live · n8n';
}
