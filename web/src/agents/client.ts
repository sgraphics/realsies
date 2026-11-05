// The AI-builder client for these pages: the in-browser mock with ?mock=1, else the relay on this origin.

import { RealBuilderClient, type BuilderClient } from '../net/builders.ts';
import { MockBuilderClient } from '../net/mock/builders.ts';
import { inMock } from './route.ts';

export function createBuilderClient(search?: string): BuilderClient {
  return inMock(search) ? new MockBuilderClient() : new RealBuilderClient();
}
