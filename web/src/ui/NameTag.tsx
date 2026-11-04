// A gamertag on a small dark tag centred beneath a pedestal. The font is sized so the longest tag
// (11 characters, Wanderer123) fits the slot at every scale; on narrow slots the word and the
// digits go on two lines. An optional status icon sits inside the tag at the left.

import type { ComponentChildren, CSSProperties } from 'preact';
import type { Rect } from '../../../art/src/scene/types.ts';
import { Icon, type IconName } from './kit.tsx';

/** "Pickle435" -> ["Pickle", "435"]; names without digits stay whole. */
export function splitTag(name: string): [string, string] {
  const m = /^(.*?)(\d+)$/.exec(name);
  return m && m[1] ? [m[1], m[2]] : [name, ''];
}

/** Font size in CSS px for a tag of `chars` characters per line in a box of w x h CSS px. */
export function tagFont(w: number, h: number, chars: number, lines: number, icon: boolean, cssPx = 2): number {
  const perChar = 0.6; // Pixelify Sans 600, digits and capitals included, rounded up
  const byW = (w - 12) / (Math.max(5, chars + (icon ? 1.6 : 0)) * perChar);
  const byH = ((h - 4) / lines) * 0.66;
  const cap = Math.max(20, Math.min(36, cssPx * 5)); // big rooms get bigger tags
  return Math.max(9, Math.min(cap, byW, byH));
}

export interface NameTagProps {
  rect: Rect;
  cssPx: number;
  name: string;
  lines: 1 | 2;
  icon?: IconName | null;
  /** A second line under the name (hall: coins and rating); replaces the digits line. */
  sub?: ComponentChildren;
  tone?: 'normal' | 'dim' | 'live' | 'you';
  title?: string;
}

export function NameTag(p: NameTagProps) {
  const k = p.cssPx;
  const box: CSSProperties = { position: 'absolute', left: p.rect.x * k + 'px', top: p.rect.y * k + 'px', width: p.rect.w * k + 'px', height: p.rect.h * k + 'px' };
  const [word, digits] = splitTag(p.name);
  const two = p.lines === 2 && !p.sub && !!digits;
  const chars = two ? Math.max(word.length, digits.length) : p.name.length;
  const fs = tagFont(p.rect.w * k, p.rect.h * k, chars, p.sub ? 1.9 : two ? 2 : 1, !!p.icon, k);
  return (
    <div class="tag-slot" style={box} aria-hidden="true">
      <span class={'name-tag ' + (p.tone ?? 'normal')} style={{ fontSize: Math.floor(fs) + 'px' }} title={p.title}>
        <span class="name-tag-row">
          {p.icon && <Icon name={p.icon} class="tag-icon" />}
          <span class="name-tag-text">{two ? <>{word}<br />{digits}</> : p.name}</span>
        </span>
        {p.sub && <span class="name-tag-sub">{p.sub}</span>}
      </span>
    </div>
  );
}
