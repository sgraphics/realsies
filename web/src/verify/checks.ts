// Verification of a chat's bundle, computed entirely in the browser.
// Every check is recomputed from the raw bytes in the bundle: sha256 of requests and responses,
// EIP-191 recovery of every enclave signature, the commitment preimage, the handle and its tag,
// the turn-by-turn chain, and the player's own copy of the conversation.

import type { VerifyBundle, VerifyCompletion } from '../../../shared/protocol.ts';
import { normAddr, recoverEip191, sha256Hex } from './crypto.ts';
import { isSteeringMessage, STEER_VERSION, STEERING_SHA256 } from '../../../shared/steering.ts';

export type CheckStatus = 'pass' | 'fail' | 'na';
export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}
export interface CheckGroup {
  id: string;
  title: string;
  status: CheckStatus;
  checks: Check[];
}
export interface LocalLine {
  from: 'me' | 'them';
  text: string;
}

interface ReqMsg {
  role: string;
  content: string;
}
interface ParsedRequest {
  model?: string;
  messages: ReqMsg[];
}

// ---------- small helpers (exported for the drawer) ----------

export function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
}

/** The bubbles a reply becomes: think-stripped, trimmed, split on newlines, empty lines dropped. */
export function bubblesOf(content: string): string[] {
  return stripThink(content)
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function lines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function parseRequest(raw: string): ParsedRequest | null {
  try {
    const j = JSON.parse(raw);
    if (!j || !Array.isArray(j.messages)) return null;
    return {
      model: typeof j.model === 'string' ? j.model : undefined,
      messages: j.messages.map((m: { role?: unknown; content?: unknown }) => ({
        role: String(m.role ?? ''),
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      })),
    };
  } catch {
    return null;
  }
}

/** The assistant content of a raw chat.completion response. */
export function responseContent(raw: string): string | null {
  try {
    const j = JSON.parse(raw);
    const c = j?.choices?.[0]?.message?.content;
    return typeof c === 'string' ? c : null;
  } catch {
    return null;
  }
}

/** Split "model:reqhash:resphash" from the right (model ids could contain colons). */
export function parseSignedText(text: string): { model: string; reqHash: string; respHash: string } | null {
  const parts = text.split(':');
  if (parts.length < 3) return null;
  const respHash = parts.pop()!;
  const reqHash = parts.pop()!;
  return { model: parts.join(':'), reqHash: reqHash.toLowerCase(), respHash: respHash.toLowerCase() };
}

export interface CompletionReport {
  index: number;
  completionId: string;
  requestHash: string;
  responseHash: string;
  signedModel: string | null;
  signedRequestHash: string | null;
  signedResponseHash: string | null;
  signingAddress: string | null;
  recovered: string | null;
  requestHashOk: boolean;
  responseHashOk: boolean;
  signatureOk: boolean; // recovers to the claimed signing address
  signerCommitted: boolean; // recovered signer is one of the opening's signers
  modelOk: boolean;
  displayedOk: boolean; // displayed bubbles are what the reply content becomes
  ok: boolean;
}

export function analyzeCompletion(c: VerifyCompletion, bundle: Pick<VerifyBundle, 'model' | 'opening'>): CompletionReport {
  const requestHash = sha256Hex(c.request);
  const responseHash = sha256Hex(c.response);
  const parsed = c.signature ? parseSignedText(c.signature.text) : null;
  const recovered = c.signature ? recoverEip191(c.signature.text, c.signature.signature) : null;
  const signers = new Set(bundle.opening.signers.map(normAddr));
  const content = responseContent(c.response);
  const bubbles = content == null ? [] : bubblesOf(content);
  const displayedOk = c.displayed.length <= bubbles.length && c.displayed.every((d, i) => d.trim() === bubbles[i]);
  const r: CompletionReport = {
    index: c.index,
    completionId: c.completionId,
    requestHash,
    responseHash,
    signedModel: parsed?.model ?? null,
    signedRequestHash: parsed?.reqHash ?? null,
    signedResponseHash: parsed?.respHash ?? null,
    signingAddress: c.signature ? normAddr(c.signature.signing_address) : null,
    recovered,
    requestHashOk: !!parsed && parsed.reqHash === requestHash,
    responseHashOk: !!parsed && parsed.respHash === responseHash,
    signatureOk: !!recovered && !!c.signature && recovered === normAddr(c.signature.signing_address),
    signerCommitted: !!recovered && signers.has(recovered),
    modelOk: !!parsed && parsed.model === bundle.model,
    displayedOk,
    ok: false,
  };
  r.ok = r.requestHashOk && r.responseHashOk && r.signatureOk && r.signerCommitted && r.modelOk && r.displayedOk;
  return r;
}

function group(id: string, title: string, checks: Check[]): CheckGroup {
  const status: CheckStatus = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'pass') ? 'pass' : 'na';
  return { id, title, status, checks };
}

const ok = (b: boolean): CheckStatus => (b ? 'pass' : 'fail');
const short = (h: string, n = 10): string => (h.length > n + 4 ? h.slice(0, n) + '…' : h);
const sameMsg = (a: ReqMsg, b: ReqMsg): boolean => a.role === b.role && a.content === b.content;

export function handlePreimage(b: Pick<VerifyBundle, 'roundId' | 'characterId' | 'viewer' | 'roundSecret'>): string {
  return `realsies:v1|handle|${b.roundId}|${b.characterId}|${b.viewer}|${b.roundSecret}`;
}

export function commitmentPreimage(b: Pick<VerifyBundle, 'roundId' | 'characterId' | 'model' | 'opening'>): string {
  const signers = [...b.opening.signers].map(normAddr).sort().join(',');
  return `realsies:v1|bot|${b.roundId}|${b.characterId}|${b.model}|${b.opening.promptHash}|${signers}|${b.opening.payout}|${b.opening.salt}`;
}

/** Compare the player's own copy with the last signed request (plus the last reply's bubbles). */
export function compareConversation(bundle: VerifyBundle, local: LocalLine[] | null | undefined): Check {
  const label = 'Your conversation matches the signed request';
  if (!local || local.length === 0) return { id: 'local', label, status: 'na', detail: 'No copy of this chat is stored on this device.' };
  const comps = [...bundle.completions].sort((a, b) => a.index - b.index);
  const last = comps[comps.length - 1];
  if (!last) return { id: 'local', label, status: 'na', detail: 'The bot never replied, so there is no signed request to compare.' };
  const req = parseRequest(last.request);
  if (!req) return { id: 'local', label, status: 'fail', detail: 'The last signed request is not valid JSON.' };
  const signedPlayer: string[] = [];
  const signedBot: string[] = [];
  for (const m of req.messages.slice(2)) {
    if (m.role === 'user') signedPlayer.push(...lines(m.content));
    else if (m.role === 'assistant') signedBot.push(...bubblesOf(m.content));
  }
  // The last reply is not in any request yet: take the bubbles the relay says it showed from it.
  signedBot.push(...last.displayed.map((d) => d.trim()).filter((d) => d.length > 0));
  const localPlayer = local.filter((l) => l.from === 'me').flatMap((l) => lines(l.text));
  const localBot = local.filter((l) => l.from === 'them').flatMap((l) => lines(l.text));
  for (let i = 0; i < Math.max(signedBot.length, localBot.length); i++) {
    if (signedBot[i] !== localBot[i]) {
      const seen = localBot[i] === undefined ? '(nothing)' : `"${localBot[i]}"`;
      const signed = signedBot[i] === undefined ? '(nothing)' : `"${signedBot[i]}"`;
      return { id: 'local', label, status: 'fail', detail: `Bot message ${i + 1}: you saw ${seen}, the signed record has ${signed}.` };
    }
  }
  for (let i = 0; i < signedPlayer.length; i++) {
    if (signedPlayer[i] !== localPlayer[i]) {
      const sent = localPlayer[i] === undefined ? '(nothing)' : `"${localPlayer[i]}"`;
      return { id: 'local', label, status: 'fail', detail: `Your message ${i + 1}: you sent ${sent}, the signed request has "${signedPlayer[i]}".` };
    }
  }
  const extra = localPlayer.length - signedPlayer.length;
  const base = `${signedBot.length} bot message${signedBot.length === 1 ? '' : 's'} and ${signedPlayer.length} of yours match.`;
  return {
    id: 'local',
    label,
    status: 'pass',
    detail: extra > 0 ? `${base} ${extra} later message${extra === 1 ? '' : 's'} of yours came after the last reply, so no signed request carries ${extra === 1 ? 'it' : 'them'}.` : base,
  };
}

export function runChecks(bundle: VerifyBundle, opts: { localTranscript?: LocalLine[] | null } = {}): CheckGroup[] {
  const groups: CheckGroup[] = [];
  const comps = [...bundle.completions].sort((a, b) => a.index - b.index);
  const reports = comps.map((c) => analyzeCompletion(c, bundle));
  const reqs = comps.map((c) => parseRequest(c.request));
  const attested = new Set(bundle.attestation.signers.map((s) => normAddr(s.address)));

  // Model
  {
    const checks: Check[] = [];
    checks.push({ id: 'model-att', label: `Attestation is for ${bundle.model}`, status: ok(bundle.attestation.model === bundle.model), detail: bundle.attestation.model === bundle.model ? undefined : `Attested model: ${bundle.attestation.model}` });
    if (!reports.length) checks.push({ id: 'model-signed', label: 'Every signed reply names the committed model', status: 'na', detail: 'No completions.' });
    else {
      const bad = reports.filter((r) => !r.modelOk);
      checks.push({ id: 'model-signed', label: 'Every signed reply names the committed model', status: ok(bad.length === 0), detail: bad.length ? `Reply ${bad.map((r) => r.index + 1).join(', ')} signed for ${bad[0].signedModel ?? 'nothing'}` : `${reports.length} of ${reports.length}` });
      const badReq = reqs.filter((r) => !r || r.model !== bundle.model).length;
      checks.push({ id: 'model-req', label: 'Every request asked for the committed model', status: ok(badReq === 0), detail: badReq ? `${badReq} request(s) name another model` : undefined });
    }
    groups.push(group('model', 'Model', checks));
  }

  // Enclave
  {
    const checks: Check[] = [];
    if (!bundle.roundSecret) checks.push({ id: 'nonce', label: 'Attestation nonce is this round’s secret hash', status: 'na', detail: 'No round secret in this bundle.' });
    else {
      const h = sha256Hex(bundle.roundSecret);
      checks.push({ id: 'nonce', label: 'Attestation nonce is this round’s secret hash', status: ok(h === bundle.attestation.nonce.toLowerCase()), detail: `sha256(secret) = ${short(h, 16)}` });
    }
    if (!bundle.attestation.signers.length) checks.push({ id: 'signers', label: 'Enclave signers attested', status: 'fail', detail: 'The attestation lists no signers.' });
    for (const s of bundle.attestation.signers) {
      checks.push({ id: 'att-' + s.address, label: `Signer ${short(normAddr(s.address), 12)} bound into the TDX report data`, status: ok(s.reportDataOk), detail: 'report_data = signer ‖ 12 zero bytes ‖ nonce (checked by the relay against the quote)' });
      checks.push({ id: 'nonce-' + s.address, label: `Signer ${short(normAddr(s.address), 12)} report echoes the nonce`, status: ok(s.nonceOk) });
    }
    const op = bundle.opening.signers.map(normAddr);
    const missing = op.filter((a) => !attested.has(a));
    checks.push({ id: 'op-signers', label: 'Committed signers are the attested ones', status: ok(op.length > 0 && missing.length === 0), detail: missing.length ? `Not attested: ${missing.join(', ')}` : `${op.length} signer${op.length === 1 ? '' : 's'}` });
    groups.push(group('enclave', 'Enclave', checks));
  }

  // Commitment
  {
    const checks: Check[] = [];
    const pre = commitmentPreimage(bundle);
    checks.push({ id: 'preimage', label: 'Commitment string rebuilt from the opening', status: ok(pre === bundle.commitment.preimage), detail: pre === bundle.commitment.preimage ? undefined : `Expected ${pre}` });
    const h = sha256Hex(bundle.commitment.preimage);
    checks.push({ id: 'commit-hash', label: 'sha256(commitment string) is the committed hash', status: ok(h === bundle.commitment.hash.toLowerCase()), detail: short(h, 20) });
    groups.push(group('commitment', 'Commitment', checks));
  }

  // System prompt
  {
    const checks: Check[] = [];
    const ph = sha256Hex(bundle.personaPrompt);
    checks.push({ id: 'prompt-hash', label: 'sha256(persona prompt) is the committed prompt hash', status: ok(ph === bundle.opening.promptHash.toLowerCase()), detail: short(ph, 20) });
    if (!reqs.length) checks.push({ id: 'prompt-msg0', label: 'Message 0 of every request is the persona prompt', status: 'na' });
    else {
      const bad = reqs.filter((r) => !r || !r.messages[0] || r.messages[0].role !== 'system' || r.messages[0].content !== bundle.personaPrompt).length;
      checks.push({ id: 'prompt-msg0', label: 'Message 0 of every request is the persona prompt', status: ok(bad === 0), detail: bad ? `${bad} request(s) differ` : `${reqs.length} of ${reqs.length}` });
    }
    groups.push(group('prompt', 'System prompt', checks));
  }

  // Handle and tag
  {
    const checks: Check[] = [];
    if (!bundle.roundSecret || !bundle.handle) checks.push({ id: 'handle', label: 'Handle = sha256(realsies:v1|handle|round|character|viewer|secret)', status: 'na', detail: 'No round secret or handle in this bundle.' });
    else {
      const h = sha256Hex(handlePreimage(bundle));
      checks.push({ id: 'handle', label: 'Handle = sha256(realsies:v1|handle|round|character|viewer|secret)', status: ok(h === bundle.handle.toLowerCase()), detail: short(h, 20) });
    }
    const tag = bundle.handle ? bundle.handle.slice(0, 16).toLowerCase() : '';
    if (!bundle.skinMessage || !tag) checks.push({ id: 'tag', label: 'The handle’s tag appears in message 1', status: 'na', detail: bundle.skinMessage ? 'No handle in this bundle.' : 'This bundle has no skin message (message 1).' });
    else {
      const inSkin = bundle.skinMessage.toLowerCase().includes(tag);
      const bad = reqs.filter((r) => !r || !r.messages[1] || r.messages[1].role !== 'system' || r.messages[1].content !== bundle.skinMessage || !r.messages[1].content.toLowerCase().includes(tag)).length;
      checks.push({ id: 'tag', label: `Tag ${tag} appears in message 1 of every request`, status: ok(inSkin && bad === 0 && reqs.length > 0), detail: !inSkin ? 'The skin message does not carry the tag.' : bad ? `${bad} request(s) lack it` : `${reqs.length} of ${reqs.length}` });
    }
    groups.push(group('handle', 'Handle and tag', checks));
  }

  // Every completion
  {
    const checks: Check[] = reports.map((r) => {
      const fails: string[] = [];
      if (!r.requestHashOk) fails.push('request hash');
      if (!r.responseHashOk) fails.push('response hash');
      if (!r.signatureOk) fails.push(r.recovered ? 'recovered signer differs' : 'signature');
      else if (!r.signerCommitted) fails.push('signer not committed');
      if (!r.modelOk) fails.push('model');
      if (!r.displayedOk) fails.push('shown text');
      return {
        id: 'c' + r.index,
        label: `Reply ${r.index + 1}: hashes match, signature recovers to the enclave`,
        status: ok(r.ok),
        detail: r.ok ? `signer ${r.recovered}` : `Failed: ${fails.join(', ')}`,
      };
    });
    if (!checks.length) checks.push({ id: 'none', label: 'Signed replies', status: 'na', detail: 'This chat has no bot replies.' });
    groups.push(group('completions', 'Every reply', checks));
  }

  // Chain
  {
    const checks: Check[] = [];
    if (comps.length < 2) checks.push({ id: 'chain', label: 'Each request extends the previous one', status: comps.length ? 'pass' : 'na', detail: comps.length ? 'Single reply.' : 'No replies.' });
    else {
      let bad = -1;
      let why = '';
      for (let i = 1; i < comps.length && bad < 0; i++) {
        const a = reqs[i - 1], b = reqs[i];
        if (!a || !b) { bad = i; why = 'unparseable request'; break; }
        const ha = a.messages.slice(2), hb = b.messages.slice(2);
        if (!sameMsg(a.messages[0] ?? { role: '', content: '' }, b.messages[0] ?? { role: '', content: '' }) || !sameMsg(a.messages[1] ?? { role: '', content: '' }, b.messages[1] ?? { role: '', content: '' })) { bad = i; why = 'system messages changed'; break; }
        for (let k = 0; k < ha.length; k++) if (!hb[k] || !sameMsg(ha[k], hb[k])) { bad = i; why = `history message ${k + 1} was rewritten`; break; }
        if (bad >= 0) break;
        const prev = responseContent(comps[i - 1].response) ?? '';
        const reply = hb[ha.length];
        const prevVariants = [prev, prev.trim(), stripThink(prev).trim(), bubblesOf(prev).join('\n')];
        if (!reply || reply.role !== 'assistant' || !prevVariants.includes(reply.content)) { bad = i; why = 'previous reply missing or altered'; break; }
        if (hb.slice(ha.length + 1).some((m) => m.role !== 'user' && !(m.role === 'system' && isSteeringMessage(m.content)))) { bad = i; why = 'unexpected non-player turn'; break; }
      }
      checks.push({ id: 'chain', label: 'Each request = previous request + previous reply + your new messages', status: ok(bad < 0), detail: bad < 0 ? `${comps.length} requests chained` : `Request ${bad + 1}: ${why}` });
    }
    // steering: the only text besides the persona prompt, the skin message and the player's lines
    {
      let notes = 0;
      const foreign: string[] = [];
      reqs.forEach((r, i) => {
        if (!r) return;
        r.messages.slice(2).forEach((m) => {
          if (m.role !== 'system') return;
          if (isSteeringMessage(m.content)) notes++;
          else foreign.push(`request ${i + 1}`);
        });
      });
      checks.push({
        id: 'steering',
        label: `Every extra system message is a published steering note (${STEER_VERSION})`,
        status: comps.length ? ok(foreign.length === 0) : 'na',
        detail: foreign.length
          ? `Unknown system text in ${[...new Set(foreign)].join(', ')}`
          : `${notes} note${notes === 1 ? '' : 's'} checked against the catalogue (sha256 ${STEERING_SHA256.slice(0, 16)}…)`,
      });
    }
    // relay transcript vs signed replies
    const botLines = bundle.transcript.filter((m) => m.from === 'bot');
    if (!botLines.length) checks.push({ id: 'relay-transcript', label: 'Every bot message in the transcript comes from a signed reply', status: 'na' });
    else {
      const unsigned = botLines.filter((m) => {
        const c = comps.find((x) => x.index === m.completionIndex);
        return !c || !c.displayed.map((d) => d.trim()).includes(m.text.trim());
      }).length;
      checks.push({ id: 'relay-transcript', label: 'Every bot message in the transcript comes from a signed reply', status: ok(unsigned === 0), detail: unsigned ? `${unsigned} message(s) not found in a signed reply` : `${botLines.length} of ${botLines.length}` });
    }
    groups.push(group('chain', 'Chain', checks));
  }

  // Your conversation
  groups.push(group('local', 'Your conversation', [compareConversation(bundle, opts.localTranscript)]));
  return groups;
}

export function summarize(groups: CheckGroup[]): { pass: number; fail: number; na: number } {
  const s = { pass: 0, fail: 0, na: 0 };
  for (const g of groups) for (const c of g.checks) s[c.status]++;
  return s;
}
