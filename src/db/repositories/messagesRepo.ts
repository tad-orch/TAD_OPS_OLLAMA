import { db } from '../sqlite.js';
import type { MessageRecord } from '../../types/agent.js';
import { createEntityId, nowIso } from '../../utils/ids.js';

export function addMessage(sessionId: string, role: string, content: string): MessageRecord {
  const message: MessageRecord = {
    id: createEntityId('msg'),
    session_id: sessionId,
    role,
    content,
    created_at: nowIso()
  };

  db.prepare(
    `
    INSERT INTO messages (id, session_id, role, content, created_at)
    VALUES (@id, @session_id, @role, @content, @created_at)
    `
  ).run(message);

  return message;
}

export function listRecentMessages(sessionId: string, limit = 8): MessageRecord[] {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
      `
    )
    .all(sessionId, limit) as MessageRecord[];

  return rows.reverse();
}
