// Persona reveal (protocol v1.1): who a bot was playing, shown after settlement next to the truth and
// the model in Results and in the Verify drawer, e.g. "24 · woman · ENFP · shy introvert · barista
// in Austin" and "all lowercase, lots of lol". No card (humans, remote brains): nothing.

import { Fragment } from 'preact';
import type { PersonaCard } from '../../../shared/protocol.ts';
import { Icon } from './kit.tsx';

interface Part {
  text: string;
  kind: 'age' | 'gender' | 'mbti' | 'temperament' | 'mood' | 'where';
}

/** The relay's demo bots also send the character's name and mood (not in protocol v1.1; shown when present). */
type Card = PersonaCard & { name?: unknown; mood?: unknown };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** The facts a card carries, in reading order; missing or odd fields are left out. */
export function personaParts(p: Card): Part[] {
  const out: Part[] = [];
  const age = str(p.age);
  if (age) out.push({ text: age, kind: 'age' });
  const gender = str(p.gender);
  if (gender) out.push({ text: gender, kind: 'gender' });
  const mbti = str(p.mbti).toUpperCase();
  if (mbti) out.push({ text: mbti, kind: 'mbti' });
  const temperament = str(p.temperament);
  if (temperament) out.push({ text: temperament, kind: 'temperament' });
  const mood = str(p.mood);
  if (mood) out.push({ text: mood, kind: 'mood' });
  const job = str(p.job), home = str(p.home);
  const where = job && home ? `${job} in ${home}` : job || home;
  if (where) out.push({ text: where, kind: 'where' });
  return out;
}

const EMOJI: Record<string, string> = { none: 'no emoji', rare: 'rare emoji', often: 'lots of emoji' };
const NBSP = ' ';

/** One line for screen readers and tests: "24 · woman · ENFP · shy introvert · barista in Austin · all lowercase, lots of lol". */
export function personaLine(p: PersonaCard): string {
  const name = str((p as Card).name);
  return (name ? name + ': ' : '') + [...personaParts(p).map((x) => x.text), str(p.style)].filter(Boolean).join(' · ');
}

export function PersonaReveal({ p, class: cls }: { p?: PersonaCard | null; class?: string }) {
  if (!p || typeof p !== 'object') return null;
  const parts = personaParts(p);
  const style = str(p.style);
  const emoji = EMOJI[str(p.emoji)] ?? '';
  const name = str((p as Card).name);
  if (!parts.length && !style) return null;
  const last = parts.length - 1;
  return (
    <div class={'persona ' + (cls ?? '')} role="group" aria-label={'Was playing ' + personaLine(p)}>
      <span class="persona-k" aria-hidden="true">
        <Icon name="mask" /> Was playing{name && <b class="persona-name">{name}</b>}
      </span>
      {parts.length > 0 && (
        <span class="persona-facts" aria-hidden="true">
          {/* each fact keeps its trailing dot, so a line never starts with a separator */}
          {parts.map((x, i) => (
            <Fragment key={x.kind}>
              <span class="persona-unit">
                <span class={'persona-part ' + x.kind}>{x.text}</span>
                {i < last && <span class="persona-sep">{NBSP + '·'}</span>}
              </span>
              {i < last && ' '}
            </Fragment>
          ))}
        </span>
      )}
      {(style || emoji) && (
        <span class="persona-style" aria-hidden="true">
          {style && <q>{style}</q>}
          {style && emoji && ' '}
          {emoji && (
            <span class="persona-emoji">
              {style && <span class="persona-sep">{'·' + NBSP}</span>}
              {emoji}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
