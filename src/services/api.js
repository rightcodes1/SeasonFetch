import { isTauri } from '@tauri-apps/api/core';

export const SEASONFETCH_API_BASE_URL = 'https://season-fetch.vercel.app';
const WEBSITE_ORIGIN_FOR_VALIDATION = 'https://seasonfetch.invalid';

/**
 * Resolve a same-origin API path for the active runtime. Website callers keep
 * their original relative URL; packaged desktop requests target the existing
 * SeasonFetch backend explicitly.
 *
 * @param {string} path
 * @param {boolean} desktop
 * @returns {string}
 */
export function resolveApiRequest(path, desktop) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    throw new TypeError('API requests must use a relative /api/ path.');
  }

  const websiteUrl = new URL(path, WEBSITE_ORIGIN_FOR_VALIDATION);
  if (websiteUrl.origin !== WEBSITE_ORIGIN_FOR_VALIDATION || !websiteUrl.pathname.startsWith('/api/')) {
    throw new TypeError('API requests must remain within the /api/ path.');
  }

  if (!desktop) return path;
  return new URL(path, SEASONFETCH_API_BASE_URL).toString();
}

/**
 * Send a request through the browser on the website or Tauri's scoped native
 * HTTP client in the desktop shell. Errors and responses are left to callers.
 *
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, init) {
  if (!isTauri()) return globalThis.fetch(resolveApiRequest(path, false), init);

  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  return tauriFetch(resolveApiRequest(path, true), init);
}
