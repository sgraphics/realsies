// Operator notices for AI builders by email: a new access request, or a persona waiting for review.
// The relay holds no mail credentials. It drops each email as a JSON file into an outbox directory, and a root-only
// sender on the server (deploy/realsies-mail.py, run by the realsies-mail.path unit) sends it through Amazon SES,
// only from @realsies.lol and only to the operator address. Off unless AGENT_NOTIFY_EMAIL is set. Never throws: a
// failed notice is logged and the request or persona stands.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AccessRequestRec, AgentPersonaRec } from './store.js';
import { errMsg } from '../util.js';
import { logger } from '../log.js';

const log = logger('notify');
export const DEFAULT_FROM = 'Realsies <notify@realsies.lol>';
const ADMIN = 'cd /opt/realsies/relay && sudo -u realsies npx tsx tools/botmaster-admin.ts';

export interface NotifyConfig {
  /** the operator's address; unset = no emails */
  notifyEmail?: string;
  /** sender, on the SES-verified domain realsies.lol */
  notifyFrom?: string;
  /** where the email files go for the root sender */
  outboxDir: string;
}

export interface Email {
  subject: string;
  text: string;
  replyTo?: string;
}

/** One file in the outbox, as deploy/realsies-mail.py reads it. */
export interface OutboxMail {
  v: 1;
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  createdAt: number;
}

export class Notifier {
  constructor(private cfg: NotifyConfig) {}

  get enabled(): boolean {
    return !!this.cfg.notifyEmail;
  }

  /** The outbox file written, or undefined when off or failed. */
  async send(m: Email): Promise<string | undefined> {
    if (!this.enabled) return undefined;
    try {
      const mail: OutboxMail = {
        v: 1, from: this.cfg.notifyFrom || DEFAULT_FROM, to: this.cfg.notifyEmail!, subject: m.subject, text: m.text,
        ...(m.replyTo ? { replyTo: m.replyTo } : {}), createdAt: Date.now(),
      };
      fs.mkdirSync(this.cfg.outboxDir, { recursive: true });
      const name = `${mail.createdAt}-${crypto.randomBytes(4).toString('hex')}.json`;
      const tmp = path.join(this.cfg.outboxDir, `.${name}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(mail));
      fs.renameSync(tmp, path.join(this.cfg.outboxDir, name)); // the sender only picks up complete *.json files
      log.info(`email "${m.subject}" queued for the operator (${name})`);
      return name;
    } catch (e) {
      log.warn(`email "${m.subject}" not queued: ${errMsg(e)}`);
      return undefined;
    }
  }

  accessRequest(rec: AccessRequestRec): Promise<string | undefined> {
    return this.send(accessRequestEmail(rec));
  }

  personaSubmitted(p: AgentPersonaRec): Promise<string | undefined> {
    return this.send(personaEmail(p));
  }
}

export function accessRequestEmail(rec: AccessRequestRec): Email {
  const r = rec.request;
  const who = r.company ? `${r.name} (${r.company})` : r.name;
  const lines = [
    `New AI builder request ${rec.id}, pending.`,
    '',
    `Name:     ${r.name}`,
    `Email:    ${r.email}`,
    ...(r.company ? [`Company:  ${r.company}`] : []),
    ...(r.website ? [`Website:  ${r.website}`] : []),
    `Kind:     ${r.kind}`,
    ...(r.volume ? [`Volume:   ${r.volume}`] : []),
    ...(r.payoutAccount ? [`Payout:   ${r.payoutAccount}`] : []),
    '',
    'Models and stack:',
    r.models,
    '',
    'Goal:',
    r.goal,
    '',
    'Approve on the server (prints the builder token once; send it to them):',
    `  ${ADMIN} approve ${rec.id} --payout ${r.payoutAccount ?? '<their NEAR account>'}`,
    'Or reject:',
    `  ${ADMIN} reject ${rec.id} --reason "..."`,
    '',
    'Reply to this email to answer the builder.',
  ];
  return { subject: `Realsies: AI builder request from ${who}`, text: lines.join('\n'), replyTo: r.email };
}

export function personaEmail(p: AgentPersonaRec): Email {
  const prompt = p.prompt.length > 1500 ? `${p.prompt.slice(0, 1500)}\n[... ${p.prompt.length - 1500} more characters]` : p.prompt;
  const lines = [
    `Persona ${p.id} from botmaster ${p.botmaster} waits for review.`,
    '',
    `Model:   ${p.model}`,
    `Levels:  ${p.levels.join(', ')}`,
    `Brain:   ${p.brain}`,
    `Prompt sha256: ${p.promptSha256}`,
    '',
    'Prompt:',
    prompt,
    '',
    'Review on the server:',
    `  ${ADMIN} persona ${p.id}`,
    `  ${ADMIN} approve-persona ${p.id}`,
    `  ${ADMIN} reject-persona ${p.id} --reason "..."`,
  ];
  return { subject: `Realsies: persona ${p.id} from ${p.botmaster} waits for review`, text: lines.join('\n') };
}
