import { useEffect, useState } from 'react';

// Same storage key and light/dark/system semantics as RentSlate's
// useTheme, so both apps on the same origin share the preference.
const STORAGE_KEY = 'rrm-theme';
const ORDER = ['system', 'light', 'dark'];

function readPreference() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (ORDER.includes(v)) return v;
  } catch {
    // storage unavailable — follow the OS
  }
  return 'system';
}

export function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function useTheme() {
  const [theme, setTheme] = useState(readPreference);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);
  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* not persisted */ }
  };
  return { theme, cycle };
}
