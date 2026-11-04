// Realsies relay entry point.
import { createApp } from './app.js';
import { logger } from './log.js';

const log = logger('main');

process.on('unhandledRejection', (e) => log.error('unhandled rejection', e));
process.on('uncaughtException', (e) => log.error('uncaught exception', e));

const app = await createApp();
let closing = false;
async function shutdown(sig: string) {
  if (closing) return;
  closing = true;
  log.info(`${sig}: shutting down`);
  const force = setTimeout(() => process.exit(1), 5000);
  try {
    await app.close();
  } finally {
    clearTimeout(force);
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
