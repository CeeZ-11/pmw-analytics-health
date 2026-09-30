import { $ } from '../lib/dom';
import { fmtDateTime } from '../lib/format';

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
