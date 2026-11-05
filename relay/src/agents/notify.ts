// Operator notices for AI builders by email: a new access request, or a persona waiting for review. Sent through
// Resend's HTTPS API, because the server cannot send mail itself (no MTA, and outbound port 25 is blocked).
// Off unless RESEND_API_KEY and AGENT_NOTIFY_EMAIL are both set. Never throws: a failed notice is logged and the
// request or persona stands. The default sender, onboarding@resend.dev, reaches only the Resend account's own
// address; set AGENT_NOTIFY_FROM to an address on a domain verified in Resend to mail anyone else.
import type { AccessRequestRec, AgentPersonaRec } from './store.js';
import { errMsg } from '../util.js';
import { logger } from '../log.js';

const log = logger('notify');
export const RESEND_URL = 'https://api.resend.com/emails';
export const DEFAULT_FROM = 'Realsies <onboarding@resend.dev>';
const ADMIN = 'cd /opt/realsies/relay && sudo -u realsies npx tsx tools/botmaster-admin.ts';

export interface NotifyConfig {
  resendApiKey?: string;
  notifyEmail?: string;
  notifyFrom?: string;
}

export interface Email {
  subject: string;
  text: string;
  replyTo?: string;
}

export class Notifier {
  constructor(
    private cfg: NotifyConfig,
    private fetchFn: typeof fetch = fetch,
  ) {}

  get enabled(): boolean {
    return !!(this.cfg.resendApiKey && this.cfg.notifyEmail);
  }

  /** Resend's message id, or undefined when off or failed. */
  async send(m: Email): Promise<string | undefined> {
    if (!this.enabled) return undefined;
    try {
      const res = await this.fetchFn(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.cfg.notifyFrom || DEFAULT_FROM,
          to: [this.cfg.notifyEmail],
          subject: m.subject,
          text: m.text,
          ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.text();
      if (!res.ok) {
        log.warn(`email "${m.subject}" not sent: HTTP ${res.status} ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
        return undefined;
      }
      const id = (JSON.parse(body) as { id?: string }).id;
      log.info(`email "${m.subject}" sent to the operator${id ? ` (${id})` : ''}`);
      return id;
    } catch (e) {
      log.warn(`email "${m.subject}" not sent: ${errMsg(e)}`);
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
