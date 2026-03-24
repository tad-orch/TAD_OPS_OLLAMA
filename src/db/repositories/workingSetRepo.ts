import { db } from '../sqlite.js';
import type { WorkingSet, WorkingSetRegistry } from '../../types/agent.js';
import { createEntityId, nowIso } from '../../utils/ids.js';

type RuntimeContextRow = {
  session_id: string;
  context_kind: string;
  context_json: string;
  updated_at: string;
};

const WORKING_SET_CONTEXT_KIND = 'working_set_registry';
const MAX_RECENT_WORKING_SETS = 12;

function getRuntimeContextRow(sessionId: string, contextKind: string): RuntimeContextRow | undefined {
  return db
    .prepare(
      `
      SELECT session_id, context_kind, context_json, updated_at
      FROM runtime_context
      WHERE session_id = ? AND context_kind = ?
      `
    )
    .get(sessionId, contextKind) as RuntimeContextRow | undefined;
}

function upsertRuntimeContext(sessionId: string, contextKind: string, contextJson: unknown): void {
  db.prepare(
    `
    INSERT INTO runtime_context (session_id, context_kind, context_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      context_kind = excluded.context_kind,
      context_json = excluded.context_json,
      updated_at = excluded.updated_at
    `
  ).run(sessionId, contextKind, JSON.stringify(contextJson), nowIso());
}

function readRegistry(sessionId: string): WorkingSetRegistry {
  const row = getRuntimeContextRow(sessionId, WORKING_SET_CONTEXT_KIND);
  if (!row?.context_json) {
    return {
      recent: [],
      updatedAt: nowIso()
    };
  }

  try {
    const parsed = JSON.parse(row.context_json) as WorkingSetRegistry;
    return {
      ...(parsed.current ? { current: parsed.current } : {}),
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : row.updated_at
    };
  } catch {
    return {
      recent: [],
      updatedAt: row.updated_at
    };
  }
}

function writeRegistry(sessionId: string, registry: WorkingSetRegistry): WorkingSetRegistry {
  const nextRegistry: WorkingSetRegistry = {
    ...(registry.current ? { current: registry.current } : {}),
    recent: registry.recent.slice(0, MAX_RECENT_WORKING_SETS),
    updatedAt: nowIso()
  };
  upsertRuntimeContext(sessionId, WORKING_SET_CONTEXT_KIND, nextRegistry);
  return nextRegistry;
}

export function getWorkingSetRegistry(sessionId: string): WorkingSetRegistry {
  return readRegistry(sessionId);
}

export function getCurrentWorkingSet(sessionId: string): WorkingSet | undefined {
  return readRegistry(sessionId).current;
}

export function listRecentWorkingSets(sessionId: string, limit = MAX_RECENT_WORKING_SETS): WorkingSet[] {
  return readRegistry(sessionId).recent.slice(0, Math.max(1, limit));
}

export function saveWorkingSet(
  sessionId: string,
  input: Omit<WorkingSet, 'id' | 'createdAt' | 'sessionId'>
): WorkingSetRegistry {
  const current = readRegistry(sessionId);
  const workingSet: WorkingSet = {
    id: createEntityId('ws'),
    sessionId,
    createdAt: nowIso(),
    ...input
  };
  const recent = [workingSet, ...current.recent.filter((item) => item.id !== workingSet.id)];
  return writeRegistry(sessionId, {
    current: workingSet,
    recent,
    updatedAt: nowIso()
  });
}
