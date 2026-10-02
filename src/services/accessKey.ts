/* The team access key for the n8n Dashboard API.
 *
 * It is typed in by each person once per device and kept only in that
 * browser's localStorage — it is never part of the build, the repo or the
 * public page. n8n checks it on every request (Header Auth on the webhooks),
 * so the static page alone exposes no client data. Rotate it in the n8n
 * credential "PMW Dashboard Access"; everyone then re-enters the new key. */

const STORAGE_KEY = 'pmw-health-access-key';
export const ACCESS_HEADER = 'X-PMW-Access-Key';

let memory: string | null = null;

export function getAccessKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function setAccessKey(value: string): void {
  memory = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private mode / storage blocked: keep it for this tab only */
  }
}

export function clearAccessKey(): void {
  memory = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing stored */
  }
}
