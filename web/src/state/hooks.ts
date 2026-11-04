// Preact binding for the store.

import { useEffect, useState } from 'preact/hooks';
import type { AppState, Store } from './store.ts';

/** Re-render on every store change; pass a selector to narrow what the component reads. */
export function useStore(store: Store): AppState;
export function useStore<T>(store: Store, select: (s: AppState) => T): T;
export function useStore<T>(store: Store, select?: (s: AppState) => T): AppState | T {
  const pick = (s: AppState) => (select ? select(s) : s);
  const [v, setV] = useState(() => pick(store.get()));
  useEffect(() => {
    setV(pick(store.get()));
    return store.subscribe((s) => setV(pick(s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  return v;
}
