import { DataError } from '../services/analyticsHealth';
import { esc, ICONS } from '../lib/dom';
import { href } from '../lib/router';
import { getAccessKey } from '../services/accessKey';

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
export function sampleNotice(source: 'mock' | 'api', isSample = false): string {
  if (source !== 'mock' && !isSample) return '';
  return `<div class="sample-note" role="note">${ICONS.info}<span><b>Sample data.</b> Sites, IDs and numbers are fictional — ${source === 'mock' ? 'the dashboard isn\u2019t connected to n8n yet.' : 'n8n is serving seed data until the monitoring workflow runs.'}</span><a href="${href.integration()}">How to connect →</a></div>`;
}

export function loading(blocks: number[] = [88, 320]): string {
  return (
    blocks
      .map((h) => `<div class="skeleton" style="height:${h}px" aria-hidden="true"></div>`)
      .join('') + '<span class="c-muted small" role="status">Loading…</span>'
  );
}

/** Asks for the team access key. Shown when n8n rejects the request, or
 *  when it can't be reached and no key is saved yet (a rejected request may
 *  not carry CORS headers, so the browser reports it as a network error). */
export function accessForm(rejected: boolean, retryId = 'retry'): string {
  return `<section class="card error-card" role="alert" style="max-width:520px"><h2>${ICONS.info}Team access key needed</h2>
    <p>${rejected ? 'That key wasn\u2019t accepted. Check it and try again.' : 'Client data on this dashboard is protected. Enter the team access key \u2014 ask the dashboard owner if you don\u2019t have it.'}</p>
    <form id="access-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <input id="access-key" class="input" type="password" autocomplete="off" spellcheck="false" placeholder="Access key" aria-label="Team access key" required style="flex:1 1 220px" />
      <button class="btn btn-primary" type="submit">Unlock</button>
    </form>
    <p class="small c-muted" style="margin:0">Saved only in this browser. <button class="btn btn-ghost btn-sm" id="${esc(retryId)}" type="button" style="height:24px;padding:0 8px">${ICONS.refresh}Try again</button></p></section>`;
}

export function errorState(err: unknown, retryId = 'retry'): string {
  const e = err instanceof DataError ? err : null;
  if (e?.kind === 'auth') return accessForm(e.status !== undefined && !!getAccessKey(), retryId);
  if (e?.kind === 'network' && !getAccessKey()) return accessForm(false, retryId);
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
