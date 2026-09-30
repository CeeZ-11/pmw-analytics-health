import { DataError } from '../services/analyticsHealth';
import { esc, ICONS } from '../lib/dom';
import { href } from '../lib/router';

export function pageHead(title: string, desc: string, actions = ''): string {
  return `<header class="ws-head"><div><h1 class="ws-title">${esc(title)}</h1>${desc ? `<p class="ws-desc">${esc(desc)}</p>` : ''}</div>${actions ? `<div class="ws-actions">${actions}</div>` : ''}</header>`;
}

export function card(
  title: string,
  body: string,
  { sub = '', tools = '', icon = '' } = {},
): string {
  return `<section class="card"><div class="card-h"><h2 class="card-t" style="margin:0">${icon}${esc(title)}</h2>${tools ? `<div class="card-tools">${tools}</div>` : ''}</div>${sub ? `<div class="card-sub">${sub}</div>` : ''}${body}</section>`;
}

export function initials(name: string): string {
  return esc(
    name
      .replace(/^the\s+/i, '')
      .trim()
      .charAt(0)
      .toUpperCase() || '?',
  );
}

/** Shown on every page in mock mode: the numbers are not real. */
export function sampleNotice(source: 'mock' | 'api'): string {
  if (source !== 'mock') return '';
  return `<div class="sample-note" role="note">${ICONS.info}<span><b>Sample data.</b> Sites, IDs and numbers are fictional — the dashboard isn't connected to n8n yet.</span><a href="${href.integration()}">How to connect →</a></div>`;
}

export function loading(blocks: number[] = [88, 320]): string {
  return (
    blocks
      .map((h) => `<div class="skeleton" style="height:${h}px" aria-hidden="true"></div>`)
      .join('') + '<span class="c-muted small" role="status">Loading…</span>'
  );
}

export function errorState(err: unknown, retryId = 'retry'): string {
  const e = err instanceof DataError ? err : null;
  const title =
    e?.kind === 'contract'
      ? 'Unexpected response from n8n'
      : e?.kind === 'timeout'
        ? 'n8n took too long to respond'
        : e
          ? 'Couldn’t load monitoring data'
          : 'Something went wrong';
  const msg = err instanceof Error ? err.message : String(err);
  return `<section class="card error-card" role="alert"><h2>${ICONS.alert}${esc(title)}</h2><p>${esc(msg)}</p><button class="btn btn-ghost" id="${esc(retryId)}">${ICONS.refresh}Try again</button></section>`;
}

export function notFound(what: string): string {
  return `<section class="card"><div class="empty"><p style="margin:0 0 10px;color:var(--text)">${esc(what)}</p><a class="btn btn-ghost" href="${href.dashboard()}">${ICONS.back}Back to all sites</a></div></section>`;
}
