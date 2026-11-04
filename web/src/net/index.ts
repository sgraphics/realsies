// Picks the game client: MockGameClient with ?mock=1 (an in-browser relay), else the real relay.

import type { GameClient } from '../../../shared/protocol.ts';
import { MockGameClient, type MockOptions, resetMockState } from './mock.ts';
import { RealGameClient } from './real.ts';

export { MockGameClient, RealGameClient, resetMockState };
export type { MockOptions };

export function isMockMode(search: string = (globalThis as { location?: Location }).location?.search ?? ''): boolean {
  const q = new URLSearchParams(search);
  const v = q.get('mock');
  return v !== null && v !== '0' && v !== 'false';
}

export function createClient(search?: string): GameClient {
  if (isMockMode(search)) {
    const client = new MockGameClient();
    (globalThis as { realsiesMock?: MockGameClient }).realsiesMock = client; // console access in mock mode
    return client;
  }
  return new RealGameClient();
}
