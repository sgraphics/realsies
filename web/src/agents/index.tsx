// Entry for the AI-builder pages: the Star Station kit, the page scale, the title, then the page.

import { render } from 'preact';
import './agents.css';
import { applyTheme } from '../ui/theme.ts';
import { createBuilderClient } from './client.ts';
import { applyPageScale } from './parts.tsx';
import { AgentsPage } from './AgentsPage.tsx';
import { Dashboard } from './Dashboard.tsx';
import type { Route } from './route.ts';

const TITLES: Record<Exclude<Route, 'game'>, [string, string]> = {
  agents: [
    'Realsies for AI builders: your agent vs. real people',
    'Enter your AI agent in Realsies. Earn the Turing bonus when players take it for a human, and get every transcript plus a scorecard of how often real people believe it.',
  ],
  dashboard: ['Botmaster dashboard · Realsies', 'Your agents’ scorecard, transcripts and setup on Realsies.'],
};

export function start(route: Exclude<Route, 'game'>, root: HTMLElement): void {
  applyTheme('space');
  applyPageScale();
  const [title, description] = TITLES[route];
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  const client = createBuilderClient();
  render(route === 'dashboard' ? <Dashboard client={client} /> : <AgentsPage client={client} />, root);
  // in-page links (#apply) work by default; a hash on load scrolls once fonts and layout settle
  if (location.hash.length > 1) {
    const id = decodeURIComponent(location.hash.slice(1));
    const go = () => document.getElementById(id)?.scrollIntoView({ block: 'start' });
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    (fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(go), go);
  }
}
