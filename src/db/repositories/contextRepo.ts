import { db } from '../sqlite.js';
import type { SessionContextRecord, SessionMemory } from '../../types/agent.js';
import { nowIso } from '../../utils/ids.js';

type SessionContextRow = {
  session_id: string;
  current_account_id: string | null;
  current_project_id: string | null;
  current_project_name: string | null;
  memory_json: string | null;
  updated_at: string;
};

function rowToContext(row: SessionContextRow): SessionContextRecord {
  return {
    session_id: row.session_id,
    current_account_id: row.current_account_id ?? undefined,
    current_project_id: row.current_project_id ?? undefined,
    current_project_name: row.current_project_name ?? undefined,
    memory_json: row.memory_json ? (JSON.parse(row.memory_json) as SessionMemory) : {},
    updated_at: row.updated_at
  };
}

export function getSessionContext(sessionId: string): SessionContextRecord | undefined {
  const row = db
    .prepare('SELECT * FROM session_context WHERE session_id = ?')
    .get(sessionId) as SessionContextRow | undefined;

  return row ? rowToContext(row) : undefined;
}

export function upsertSessionContext(
  sessionId: string,
  patch: {
    current_account_id?: string | null;
    current_project_id?: string | null;
    current_project_name?: string | null;
    memory_json?: SessionMemory;
  }
): SessionContextRecord {
  const current = getSessionContext(sessionId);
  const nextContext: SessionContextRecord = {
    session_id: sessionId,
    current_account_id:
      patch.current_account_id === undefined
        ? current?.current_account_id
        : (patch.current_account_id ?? undefined),
    current_project_id:
      patch.current_project_id === undefined
        ? current?.current_project_id
        : (patch.current_project_id ?? undefined),
    current_project_name:
      patch.current_project_name === undefined
        ? current?.current_project_name
        : (patch.current_project_name ?? undefined),
    memory_json: patch.memory_json ?? current?.memory_json ?? {},
    updated_at: nowIso()
  };

  db.prepare(
    `
    INSERT INTO session_context (
      session_id, current_account_id, current_project_id, current_project_name, memory_json, updated_at
    )
    VALUES (@session_id, @current_account_id, @current_project_id, @current_project_name, @memory_json, @updated_at)
    ON CONFLICT(session_id) DO UPDATE SET
      current_account_id = excluded.current_account_id,
      current_project_id = excluded.current_project_id,
      current_project_name = excluded.current_project_name,
      memory_json = excluded.memory_json,
      updated_at = excluded.updated_at
    `
  ).run({
    session_id: nextContext.session_id,
    current_account_id: nextContext.current_account_id ?? null,
    current_project_id: nextContext.current_project_id ?? null,
    current_project_name: nextContext.current_project_name ?? null,
    memory_json: JSON.stringify(nextContext.memory_json),
    updated_at: nextContext.updated_at
  });

  return nextContext;
}
