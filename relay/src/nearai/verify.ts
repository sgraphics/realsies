// Local verification of NEAR AI enclave signatures and attestation reports, mirroring
// experiments/near-ai/verify_tee.py and the contract's checks (spec section 3).
import { sha256Hex, recoverEip191 } from '../crypto.js';
import type { SignaturePayload } from '../../../shared/protocol.js';

/** Remove <think>…</think> blocks; a dangling "</think>" drops everything before it; an unclosed "<think>" drops the rest. */
export function stripThink(content: string): string {
  let s = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  const close = s.lastIndexOf('</think>');
  if (close >= 0) s = s.slice(close + '</think>'.length);
  const open = s.indexOf('<think>');
  if (open >= 0) s = s.slice(0, open);
  return s;
}

/** The text a player sees from one completion: think-stripped, trimmed, split on newlines, empty lines dropped. */
export function cleanContent(content: string | null | undefined): string {
  if (typeof content !== 'string') return '';
  return stripThink(content).trim();
}

export function bubblesOf(content: string | null | undefined): string[] {
  return cleanContent(content)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** choices[0].message.content of exact response bytes, or null. */
export function contentOfResponse(response: string): string | null {
  try {
    const j = JSON.parse(response);
    const c = j?.choices?.[0]?.message?.content;
    return typeof c === 'string' ? c : null;
  } catch {
    return null;
  }
}

export interface SignatureCheck {
  ok: boolean; // all checks below pass, including the attested-signer check
  validSignature: boolean; // hashes, model and recovery match (independent of the attested set)
  modelOk: boolean;
  requestHashOk: boolean;
  responseHashOk: boolean;
  recovered: string | null;
  recoveredMatchesClaim: boolean;
  signerAttested: boolean;
  requestHash: string;
  responseHash: string;
}

/** text == "{model}:{sha256(request)}:{sha256(response)}", EIP-191 recovery, signer in the attested set. */
export function checkSignature(
  model: string,
  request: string,
  response: string,
  sig: SignaturePayload | null,
  attestedSigners: string[],
): SignatureCheck {
  const requestHash = sha256Hex(request);
  const responseHash = sha256Hex(response);
  const base: SignatureCheck = {
    ok: false,
    validSignature: false,
    modelOk: false,
    requestHashOk: false,
    responseHashOk: false,
    recovered: null,
    recoveredMatchesClaim: false,
    signerAttested: false,
    requestHash,
    responseHash,
  };
  if (!sig || typeof sig.text !== 'string' || typeof sig.signature !== 'string') return base;
  const parts = sig.text.split(':');
  // model ids contain no ':'; text is model:h1:h2 for provider_tee signatures
  const h2 = parts.pop();
  const h1 = parts.pop();
  const m = parts.join(':');
  base.modelOk = m === model;
  base.requestHashOk = h1 === requestHash;
  base.responseHashOk = h2 === responseHash;
  base.recovered = recoverEip191(sig.text, sig.signature);
  base.recoveredMatchesClaim = !!base.recovered && base.recovered === String(sig.signing_address || '').toLowerCase();
  const attested = new Set(attestedSigners.map((a) => a.toLowerCase()));
  base.signerAttested = !!base.recovered && attested.has(base.recovered);
  base.validSignature = base.modelOk && base.requestHashOk && base.responseHashOk && base.recoveredMatchesClaim;
  base.ok = base.validSignature && base.signerAttested;
  return base;
}

// ---------- attestation ----------

interface RawReport {
  signing_address?: string;
  signing_algo?: string;
  report_data?: string;
  request_nonce?: string;
  intel_quote?: string;
  model_name?: string;
  nvidia_payload?: string;
}

/** report_data from the field, or from the TDX v4 quote: 48-byte header, report_data at body offset 520, 64 bytes. */
export function reportDataOf(rep: RawReport): string | null {
  if (rep.report_data) return rep.report_data.toLowerCase();
  if (!rep.intel_quote) return null;
  try {
    const q = Buffer.from(rep.intel_quote, 'hex');
    if (q.length < 48 + 520 + 64) return null;
    return q.subarray(48 + 520, 48 + 520 + 64).toString('hex');
  } catch {
    return null;
  }
}

export function expectedReportData(address: string, nonce: string): string {
  return address.toLowerCase().replace(/^0x/, '') + '0'.repeat(24) + nonce.toLowerCase();
}

export interface AttestedSigner {
  address: string;
  reportDataOk: boolean;
  nonceOk: boolean;
  nvidiaNonceOk?: boolean;
}

export interface AttestationCheck {
  model: string;
  nonce: string;
  gatewaySigner?: string;
  gatewayOk: boolean;
  signers: AttestedSigner[];
  /** ECDSA model signers whose report_data binding and nonce echo both pass, lowercase, sorted. */
  attested: string[];
  note: string;
}

export function checkAttestation(report: unknown, model: string, nonce: string): AttestationCheck {
  const r = report as { gateway_attestation?: RawReport; model_attestations?: RawReport[] };
  const gw = r?.gateway_attestation;
  let gatewayOk = false;
  let gatewaySigner: string | undefined;
  if (gw?.signing_address) {
    gatewaySigner = gw.signing_address.toLowerCase();
    gatewayOk = gw.request_nonce === nonce && reportDataOf(gw) === expectedReportData(gw.signing_address, nonce);
  }
  const signers: AttestedSigner[] = [];
  for (const m of r?.model_attestations || []) {
    if (m.model_name !== model || !m.signing_address) continue;
    if ((m.signing_algo || '').toLowerCase() !== 'ecdsa') continue;
    let nvidiaNonceOk: boolean | undefined;
    if (m.nvidia_payload) {
      try {
        nvidiaNonceOk = JSON.parse(m.nvidia_payload)?.nonce === nonce;
      } catch {
        nvidiaNonceOk = false;
      }
    }
    signers.push({
      address: m.signing_address.toLowerCase(),
      nonceOk: m.request_nonce === nonce,
      reportDataOk: reportDataOf(m) === expectedReportData(m.signing_address, nonce),
      nvidiaNonceOk,
    });
  }
  const attested = [...new Set(signers.filter((s) => s.nonceOk && s.reportDataOk).map((s) => s.address))].sort();
  const notes: string[] = [];
  notes.push(`gateway ${gatewayOk ? 'binding ok' : 'binding FAILED'}`);
  notes.push(`${attested.length} of ${signers.length} model signer(s) bound to the nonce`);
  if (signers.some((s) => s.nvidiaNonceOk === false)) notes.push('NVIDIA payload nonce mismatch');
  notes.push('TDX quote collateral (dcap-qvl) is not checked by the relay; see experiments/near-ai/verify_tee.py');
  return { model, nonce, gatewaySigner, gatewayOk, signers, attested, note: notes.join('; ') };
}
