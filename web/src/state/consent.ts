// One-time "I'm 18 or older and accept the terms" on first entry, remembered in localStorage.
// Deliberately light: no geo checks, no account binding, no re-asking unless the terms version changes.

const KEY = 'realsies:terms:v1';

function ls(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function termsAccepted(): boolean {
  try {
    return !!ls()?.getItem(KEY);
  } catch {
    return false;
  }
}

export function acceptTerms(): void {
  try {
    ls()?.setItem(KEY, JSON.stringify({ at: Date.now(), age: '18+' }));
  } catch {
    /* private mode: ask again next time */
  }
}

/** For testing and the QA screenshots of the first-entry screen. */
export function forgetTerms(): void {
  try {
    ls()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
