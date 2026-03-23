type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function formatContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }

  return ` ${JSON.stringify(context)}`;
}

function log(level: LogLevel, scope: string, message: string, context?: Record<string, unknown>): void {
  const line = `[${scope}] ${message}${formatContext(context)}`;

  if (level === 'debug' || level === 'info') {
    console.log(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.error(line);
}

export function redactPathForLog(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments.length > 2 ? `.../${segments.slice(-2).join('/')}` : normalized;
}

export function debugLog(scope: string, message: string, context?: Record<string, unknown>): void {
  log('debug', scope, message, context);
}

export function infoLog(scope: string, message: string, context?: Record<string, unknown>): void {
  log('info', scope, message, context);
}

export function warnLog(scope: string, message: string, context?: Record<string, unknown>): void {
  log('warn', scope, message, context);
}

export function errorLog(scope: string, message: string, context?: Record<string, unknown>): void {
  log('error', scope, message, context);
}
