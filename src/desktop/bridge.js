import { isTauri, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** @typedef {import('./contracts').DesktopStatus} DesktopStatus */

/** @returns {boolean} */
export function isDesktopShell() {
  return isTauri();
}

/** @returns {Promise<DesktopStatus>} */
export function getDesktopStatus() {
  return invoke('desktop_status');
}

/** @param {(status: DesktopStatus) => void} onStatus */
export function listenForDesktopStatus(onStatus) {
  return listen('desktop-status', event => onStatus(event.payload));
}
