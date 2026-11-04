// The real signed enclave completion from 2026-11-04 (experiments/near-ai/evidence/), turned into a
// Verify bundle for one seeded past round in mock mode.

import type { VerifyBundle } from '../../../../shared/protocol.ts';
import { normAddr, sha256Hex } from '../../verify/crypto.ts';
import { bubblesOf, commitmentPreimage } from '../../verify/checks.ts';

export interface EvidenceFiles {
  request: string;
  response: string;
  signature: string;
  attestation: string;
}

export type EvidenceLoader = () => Promise<EvidenceFiles>;

/** Browser default: Vite raw imports, split into their own chunk (mock mode only). */
export const viteEvidenceLoader: EvidenceLoader = async () => {
  const [request, response, signature, attestation] = await Promise.all([
    import('../../../../experiments/near-ai/evidence/2026-11-04/request.json?raw'),
    import('../../../../experiments/near-ai/evidence/2026-11-04/response.json?raw'),
    import('../../../../experiments/near-ai/evidence/2026-11-04/signature.json?raw'),
    import('../../../../experiments/near-ai/evidence/2026-11-04/attestation.json?raw'),
  ]);
  return { request: request.default, response: response.default, signature: signature.default, attestation: attestation.default };
};

export const EVIDENCE_CHAT_ID = 'evidence-c6bba1f4dd0243f89c77ed4045e3d056';
export const EVIDENCE_MODEL = 'z-ai/glm-5.3-flash';

interface ModelAtt {
  model_name?: string;
  signing_address: string;
  signing_algo?: string;
  request_nonce?: string;
  report_data?: string;
  intel_quote?: string;
}

/** report_data from the report, or from the TDX v4 quote body (48-byte header, offset 520, 64 bytes). */
function reportDataOf(rep: ModelAtt): string {
  if (rep.report_data) return rep.report_data.toLowerCase();
  const q = (rep.intel_quote ?? '').toLowerCase();
  const off = (48 + 520) * 2;
  return q.slice(off, off + 128);
}

export function evidenceBundle(files: EvidenceFiles, roundId: number, viewer: string, txs: { commitTx?: string } = {}): VerifyBundle {
  const req = JSON.parse(files.request) as { model: string; messages: { role: string; content: string }[] };
  const resp = JSON.parse(files.response) as { id: string; created: number; choices: { message: { content: string } }[] };
  const sig = JSON.parse(files.signature);
  const att = JSON.parse(files.attestation) as { gateway_attestation?: ModelAtt; model_attestations?: ModelAtt[] };
  const model = req.model;
  const persona = req.messages[0]?.content ?? '';
  const nonce = (att.model_attestations?.[0]?.request_nonce ?? att.gateway_attestation?.request_nonce ?? '').toLowerCase();
  const models = (att.model_attestations ?? []).filter((m) => m.model_name === model && (m.signing_algo ?? 'ecdsa') === 'ecdsa');
  const signers = models.map((m) => {
    const addr = normAddr(m.signing_address);
    return { address: addr, reportDataOk: reportDataOf(m) === addr.slice(2) + '0'.repeat(24) + nonce, nonceOk: (m.request_nonce ?? '').toLowerCase() === nonce };
  });
  const characterId = sha256Hex('realsies evidence character 2026-11-04').slice(0, 32);
  const salt = sha256Hex('realsies evidence salt 2026-11-04');
  const opening = { salt, promptHash: sha256Hex(persona), signers: signers.map((s) => s.address).sort(), payout: 'bots.realsies.testnet' };
  const preimage = commitmentPreimage({ roundId, characterId, model, opening });
  const content = resp.choices[0]?.message?.content ?? '';
  const at = resp.created * 1000;
  const shown = bubblesOf(content);
  return {
    roundId,
    chatId: EVIDENCE_CHAT_ID,
    characterId,
    model,
    commitment: { preimage, hash: sha256Hex(preimage), commitTx: txs.commitTx },
    opening,
    personaPrompt: persona,
    skinMessage: '',
    attestation: {
      nonce,
      fetchedAt: at - 4000,
      model,
      signers,
      gatewaySigner: att.gateway_attestation ? normAddr(att.gateway_attestation.signing_address) : undefined,
      note:
        'Reference evidence from 2026-11-04 (experiments/near-ai/evidence): a real completion signed inside the NEAR AI enclave, with the attestation report fetched just before. ' +
        'Its nonce was the script’s own random nonce, not a round secret hash, and the request predates game-record tags, so the round and tag checks do not apply.',
    },
    completions: [{ index: 0, completionId: resp.id, request: files.request, response: files.response, signature: sig, displayed: shown, at }],
    transcript: [
      { from: 'player', text: req.messages.find((m) => m.role === 'user')?.content ?? '', at: at - 2500 },
      ...shown.map((t) => ({ from: 'bot' as const, text: t, at, completionIndex: 0 })),
    ],
    roundSecret: '',
    viewer,
    handle: '',
    chain: {},
  };
}
