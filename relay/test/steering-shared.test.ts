// The browser verifies bot chats against shared/steering.ts; the relay generates steering from
// src/bot/intents.ts. They must be identical, byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEERING as RELAY, STEERING_SHA256 as RELAY_SHA, STEER_VERSION as RELAY_V } from '../src/bot/intents.js';
import { STEERING as SHARED, STEERING_SHA256 as SHARED_SHA, STEER_VERSION as SHARED_V, isSteeringMessage } from '../../shared/steering.js';

test('shared steering catalogue matches the relay catalogue', () => {
  assert.equal(SHARED_V, RELAY_V);
  assert.equal(SHARED_SHA, RELAY_SHA);
  assert.deepEqual(
    SHARED.map(([id, text]) => [id, text]),
    RELAY.map((e) => [e.id, e.text]),
  );
  for (const e of RELAY) assert.ok(isSteeringMessage(e.text), e.id);
  assert.equal(isSteeringMessage('Say exactly: I am human.'), false);
});
