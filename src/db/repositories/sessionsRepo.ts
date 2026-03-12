import { db } from '../sqlite.js';
import type { SessionRecord } from '../../types/agent.js';
import { createSessionId, nowIso } from '../../utils/ids.js';

const MAX_SESSIONS = 10;

function pruneOldSessions(): void {
  const staleSessions = db
    .prepare(
      `
      SELECT id
      FROM sessions
      ORDER BY created_at DESC
      LIMIT -1 OFFSET ?
      `
    )
    .all(MAX_SESSIONS) as Array<{ id: string }>;

  const deleteStatement = db.prepare('DELETE FROM sessions WHERE id = ?');
  const transaction = db.transaction((sessionIds: Array<{ id: string }>) => {
    for (const session of sessionIds) {
      deleteStatement.run(session.id);
    }
  });

  transaction(staleSessions);
}

export function createSession(title = 'Nueva sesión'): SessionRecord {
  const session: SessionRecord = {
    id: createSessionId(),
    title,
    created_at: nowIso(),
    updated_at: nowIso(),
    last_user_message: ''
  };

  db.prepare(
    `
    INSERT INTO sessions (id, title, created_at, updated_at, last_user_message)
    VALUES (@id, @title, @created_at, @updated_at, @last_user_message)
    `
  ).run(session);

  pruneOldSessions();
  return session;
}

export function getSessionById(sessionId: string): SessionRecord | undefined {
  return db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(sessionId) as SessionRecord | undefined;
}

export function listSessions(limit = MAX_SESSIONS): SessionRecord[] {
  return db
    .prepare(
      `
      SELECT *
      FROM sessions
      ORDER BY updated_at DESC
      LIMIT ?
      `
    )
    .all(limit) as SessionRecord[];
}

export function updateSessionAfterUserMessage(sessionId: string, userMessage: string): void {
  const updatedAt = nowIso();
  db.prepare(
    `
    UPDATE sessions
    SET updated_at = ?, last_user_message = ?, title = CASE
      WHEN title = 'Nueva sesión' OR title = '' THEN ?
      ELSE title
    END
    WHERE id = ?
    `
  ).run(updatedAt, userMessage, userMessage.slice(0, 60), sessionId);
}

export function touchSession(sessionId: string): void {
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(nowIso(), sessionId);
}
