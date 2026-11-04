// Exact string formats from docs/spec.md section 3 (v1.1). Tests check them byte for byte
// against contracts/game/tests/vectors.json.
import { sha256Hex, randomHex } from './crypto.js';

export const newSecret = () => randomHex(32); // 64 hex
export const newCharacterId = () => randomHex(16); // 32 hex
export const newSalt = () => randomHex(32); // 64 hex

export function secretHash(secret: string): string {
  return sha256Hex(secret);
}

export function promptHash(prompt: string): string {
  return sha256Hex(prompt);
}

/** Lowercase 0x addresses, sorted ascending, de-duplicated. */
export function normalizeSigners(signers: string[]): string[] {
  return [...new Set(signers.map((s) => s.toLowerCase()))].sort();
}

export interface BotCommitInput {
  roundId: number;
  characterId: string;
  model: string;
  promptHash: string;
  signers: string[];
  payout: string;
  salt: string;
}

export function botPreimage(c: BotCommitInput): string {
  const signers = normalizeSigners(c.signers).join(',');
  return `realsies:v1|bot|${c.roundId}|${c.characterId}|${c.model}|${c.promptHash}|${signers}|${c.payout}|${c.salt}`;
}

export interface HumanCommitInput {
  roundId: number;
  characterId: string;
  account: string;
  payout: string;
  salt: string;
}

export function humanPreimage(c: HumanCommitInput): string {
  return `realsies:v1|human|${c.roundId}|${c.characterId}|${c.account}|${c.payout}|${c.salt}`;
}

export function commitmentOf(preimage: string): string {
  return sha256Hex(preimage);
}

/** One per viewer per character per round. */
export function handleOf(roundId: number, characterId: string, viewer: string, secret: string): string {
  return sha256Hex(`realsies:v1|handle|${roundId}|${characterId}|${viewer}|${secret}`);
}

/** The chat tag: first 16 hex chars of the viewer's handle (spec 1.1). */
export function chatTag(handle: string): string {
  return handle.slice(0, 16);
}

/** Bot message 1, exactly as spec 1.1 section 4. */
export function skinMessage(name: string, tag: string): string {
  return `Your gamertag in this chat is ${name}; the game generated it, you did not choose it. Game record: ${tag}.`;
}

/** Seat skin seed: sha256_hex(SKIN_SECRET | round_id | viewer | level | seat_index). */
export function seatSeed(skinSecret: string, roundId: number, viewer: string, level: number, seatIndex: number): string {
  return sha256Hex(`${skinSecret}|${roundId}|${viewer}|${level}|${seatIndex}`);
}

/** Avatar seed for the test-user selection screen. */
export function avatarSeed(account: string): string {
  return sha256Hex(`realsies:v1|avatar|${account}`);
}
