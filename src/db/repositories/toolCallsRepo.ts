import { db } from '../sqlite.js';
import type { ToolCallRecord } from '../../types/agent.js';
import { createEntityId, nowIso } from '../../utils/ids.js';

export function addToolCall(
  sessionId: string,
  toolName: string,
  argumentsJson: string,
  resultSummary: string
): ToolCallRecord {
  const toolCall: ToolCallRecord = {
    id: createEntityId('tool'),
    session_id: sessionId,
    tool_name: toolName,
    arguments_json: argumentsJson,
    result_summary: resultSummary,
    created_at: nowIso()
  };

  db.prepare(
    `
    INSERT INTO tool_calls (id, session_id, tool_name, arguments_json, result_summary, created_at)
    VALUES (@id, @session_id, @tool_name, @arguments_json, @result_summary, @created_at)
    `
  ).run(toolCall);

  return toolCall;
}

export function listRecentToolCalls(sessionId: string, limit = 4): ToolCallRecord[] {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM tool_calls
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
      `
    )
    .all(sessionId, limit) as ToolCallRecord[];

  return rows.reverse();
}
