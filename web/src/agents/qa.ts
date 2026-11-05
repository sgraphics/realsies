// QA screenshot hooks for the AI-builder pages (only together with ?mock=1):
//   /agents?mock=1&qa=top                    the top of the page
//   /agents?mock=1&qa=form                   scrolled to the request-access form
//   /agents?mock=1&qa=success                the form filled in and sent: the success screen with the request id
//   /agents/dashboard?mock=1&qa=token        the token screen
//   /agents/dashboard?mock=1&qa=dashboard    signed in with the demo token
//   /agents/dashboard?mock=1&qa=chats        signed in, scrolled to the chats with the first transcript open
//   /agents/dashboard?mock=1&qa=setup        signed in, scrolled to the personas and the NEAR AI key

import { inMock } from './route.ts';

export type AgentsQa = 'top' | 'form' | 'success' | null;
export type DashboardQa = 'token' | 'dashboard' | 'chats' | 'setup' | null;

export function agentsQaStep(search: string): AgentsQa {
  if (!inMock(search)) return null;
  const v = new URLSearchParams(search).get('qa');
  return v === 'top' || v === 'form' || v === 'success' ? v : null;
}

export function dashboardQaStep(search: string): DashboardQa {
  if (!inMock(search)) return null;
  const v = new URLSearchParams(search).get('qa');
  return v === 'token' || v === 'dashboard' || v === 'chats' || v === 'setup' ? v : null;
}

/** Scroll an element to the top once fonts and layout have settled (QA and in-page links). */
export function scrollToId(id: string): void {
  const go = () => document.getElementById(id)?.scrollIntoView({ block: 'start' });
  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  const later = () => requestAnimationFrame(() => requestAnimationFrame(go));
  if (fonts?.ready) fonts.ready.then(later, later);
  else later();
}
