import { useEffect, useState } from 'react';

// Chrome fires `beforeinstallprompt` once, early; keep it so an "Install app"
// button can show the native prompt later.
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function registerPwa() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; notify(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; notify(); });
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

/** { canInstall, install } — canInstall is true when Chrome offers installation. */
export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(n => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null; notify();
  };
  return { canInstall: !!deferredPrompt && !isStandalone(), install };
}

// Tenants who install from their meter's QR link should reopen that meter.
const LAST_METER = 'rsm-last-meter';
export const rememberMeter = token => { try { localStorage.setItem(LAST_METER, token); } catch { /* optional */ } };
export const forgetMeter = () => { try { localStorage.removeItem(LAST_METER); } catch { /* optional */ } };
export const launchMeter = () => {
  if (!isStandalone()) return null;
  try { return localStorage.getItem(LAST_METER); } catch { return null; }
};
