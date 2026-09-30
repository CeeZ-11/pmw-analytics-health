/* Build-time configuration, read once from Vite's import.meta.env.
 *
 * Only public, non-secret settings belong here: every VITE_* value is inlined
 * into the static bundle GitHub Pages serves. Credentials (GA4 service
 * accounts, n8n auth, Slack tokens) live exclusively inside n8n. */

export type DataSource = 'mock' | 'api';

export interface AppConfig {
  dataSource: DataSource;
  /** n8n base URL without trailing slash; empty in mock mode. */
  apiBaseUrl: string;
  apiTimeoutMs: number;
}

export function readConfig(env: Record<string, string | undefined>): AppConfig {
  const requested = (env.VITE_DATA_SOURCE || 'mock').trim().toLowerCase();
  const apiBaseUrl = (env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const timeout = Number(env.VITE_API_TIMEOUT_MS);
  return {
    // Asking for the API without saying where it is falls back to mock rather
    // than shipping a dashboard that can only ever show a network error.
    dataSource: requested === 'api' && apiBaseUrl ? 'api' : 'mock',
    apiBaseUrl,
    apiTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 15000,
  };
}

export const config: AppConfig = readConfig(import.meta.env as Record<string, string | undefined>);
