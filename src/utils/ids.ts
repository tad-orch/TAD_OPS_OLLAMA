import { randomUUID } from 'node:crypto';

export function nowIso(): string {
  return new Date().toISOString();
}

export function createShortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 6);
}

export function createEntityId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function isLikelyActingUserId(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return /^[A-Za-z0-9-]{8,}$/.test(value.trim());
}

export function createSessionId(): string {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return `session-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${createShortId()}`;
}
