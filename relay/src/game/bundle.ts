// VerifyBundle for one bot chat (shared/protocol.ts). Everything needed to check the chat offline:
// commitment preimage, opening, attestation summary, every completion's exact bytes and signature,
// the transcript as shown, and the revealed round secret to recompute the handle and tag.
import type { SignaturePayload, VerifyBundle } from '../../../shared/protocol.js';
import type { CompletionRow } from '../db.js';
import type { AttestInfo, CharacterRec, ChatSide, RoundRec } from './types.js';
import type { StoredMsg } from './bot.js';

export interface BundleExtras {
  /** index of the completion submitted on chain as this viewer's proof, if any (extra field) */
  proofCompletionIndex?: number;
  /** the contract's open report for this character (extra field) */
  openReport?: unknown;
  /** relay-side check of each completion (extra field) */
  relayChecks?: { index: number; ok: boolean; validSignature: boolean; signerAttested: boolean }[];
}

export function buildBundle(a: {
  round: RoundRec;
  side: ChatSide;
  character: CharacterRec;
  personaPrompt: string;
  completions: CompletionRow[];
  messages: StoredMsg[];
  attest?: AttestInfo;
  proofCompletionIndex?: number;
}): VerifyBundle & BundleExtras {
  const { round, side, character } = a;
  const att = a.attest;
  return {
    roundId: round.id,
    chatId: side.chatId,
    characterId: character.id,
    model: character.model ?? side.model ?? '',
    commitment: { preimage: character.preimage, hash: character.commitment, commitTx: character.commitTx },
    opening: {
      salt: character.salt,
      promptHash: character.promptHash ?? '',
      signers: character.signers ?? [],
      payout: character.payout,
      openTx: character.openTx,
    },
    personaPrompt: a.personaPrompt,
    skinMessage: side.skinMessage ?? '',
    attestation: {
      nonce: round.secretHash,
      fetchedAt: att?.fetchedAt ?? 0,
      model: character.model ?? '',
      signers: (att?.signers ?? []).map((s) => ({ address: s.address, reportDataOk: s.reportDataOk, nonceOk: s.nonceOk })),
      gatewaySigner: att?.gatewaySigner,
      note: att?.note,
    },
    completions: a.completions.map((c) => ({
      index: c.idx,
      completionId: c.completionId ?? '',
      request: c.request,
      response: c.response,
      signature: c.signature ? (JSON.parse(c.signature) as SignaturePayload) : null,
      displayed: c.displayed ? (JSON.parse(c.displayed) as string[]) : [],
      at: c.at,
    })),
    transcript: a.messages.map((m) => ({
      from: m.from === 'me' ? ('player' as const) : ('bot' as const),
      text: m.text,
      at: m.at,
      completionIndex: m.from === 'them' ? m.ci : undefined,
    })),
    roundSecret: round.secret,
    viewer: side.viewer,
    handle: side.handle,
    chain: {
      revealTx: round.revealTx,
      openTx: character.openTx,
      settleTx: round.settleTx,
      playTx: side.playTx,
      callTx: side.callTx,
    },
    proofCompletionIndex: a.proofCompletionIndex,
    openReport: character.openReport,
    relayChecks: a.completions.map((c) => {
      const v = c.verify ? JSON.parse(c.verify) : null;
      return { index: c.idx, ok: !!v?.ok, validSignature: !!v?.validSignature, signerAttested: !!v?.signerAttested };
    }),
  };
}

/** The proof for a viewer: the last completion of the chat whose signature verified (spec 1.1). */
export function lastSignedCompletion(rows: CompletionRow[]): CompletionRow | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i].verify ? JSON.parse(rows[i].verify!) : null;
    if (rows[i].signature && v?.validSignature) return rows[i];
  }
  return undefined;
}
