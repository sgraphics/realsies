// Tiny leveled logger. Never pass secrets to it.
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: number = ORDER[(process.env.LOG_LEVEL as Level) || 'info'] ?? 20;

export function setLogLevel(l: Level): void {
  threshold = ORDER[l] ?? 20;
}

function out(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (ORDER[level] < threshold) return;
  const ts = new Date().toISOString().slice(11, 23);
  let line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (extra !== undefined) {
    if (extra instanceof Error) line += ` :: ${extra.message}`;
    else {
      try {
        line += ` ${JSON.stringify(extra, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`;
      } catch {
        line += ` ${String(extra)}`;
      }
    }
  }
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export function logger(scope: string) {
  return {
    debug: (m: string, e?: unknown) => out('debug', scope, m, e),
    info: (m: string, e?: unknown) => out('info', scope, m, e),
    warn: (m: string, e?: unknown) => out('warn', scope, m, e),
    error: (m: string, e?: unknown) => out('error', scope, m, e),
  };
}
