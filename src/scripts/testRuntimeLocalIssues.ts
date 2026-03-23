import { runAgent } from '../app/agent.js';
import { upsertSessionContext } from '../db/repositories/contextRepo.js';
import { registerProjectScopedReadSnapshot } from '../db/repositories/snapshotRegistryRepo.js';
import { createSession } from '../db/repositories/sessionsRepo.js';
import { env } from '../config/env.js';
import { closeMysqlPool, ensureMysqlSchema, getMysqlPool, isMysqlConfigured } from '../shared/db/mysql.js';

const projectId = 'local-runtime-project';
const projectName = 'Proyecto Local Runtime';
const rawDocumentId = 'local-runtime-doc';

async function seedIssues(): Promise<void> {
  if (!isMysqlConfigured()) {
    throw new Error('MySQL no está configurado; no se puede sembrar canonical_issues para esta prueba.');
  }

  await ensureMysqlSchema();
  const pool = await getMysqlPool();
  await pool.execute('DELETE FROM canonical_issues WHERE project_id = ?', [projectId]);
  await pool.execute(
    `
    INSERT INTO canonical_issues (
      project_id, issue_id, display_id, title, status, issue_type, assigned_to, location_text,
      due_date, created_at_iso, details_json, raw_document_id, fetched_at
    )
    VALUES
      (?, 'issue-open-1', '1', 'Issue Open 1', 'open', 'quality', 'Ana', 'Zona A', NULL, '2026-03-23T00:00:00Z', '{}', ?, NOW()),
      (?, 'issue-open-2', '2', 'Issue Open 2', 'open', 'quality', 'Luis', 'Zona B', NULL, '2026-03-23T00:00:00Z', '{}', ?, NOW()),
      (?, 'issue-closed-1', '3', 'Issue Closed 1', 'closed', 'safety', 'Marta', 'Zona C', NULL, '2026-03-23T00:00:00Z', '{}', ?, NOW())
    `,
    [projectId, rawDocumentId, projectId, rawDocumentId, projectId, rawDocumentId]
  );
}

async function main() {
  const session = createSession('Runtime Local Issues');

  try {
    await seedIssues();

    upsertSessionContext(session.id, {
      current_account_id: env.apsAccountId,
      current_project_id: projectId,
      current_project_name: projectName,
      memory_json: {
        lastResolvedProjectId: projectId,
        lastResolvedProjectName: projectName,
        currentProjectAliases: [projectId, projectName, 'local', 'runtime'],
        currentProjectConfidence: 1,
        currentProjectUpdatedAt: new Date().toISOString()
      }
    });

    registerProjectScopedReadSnapshot(session.id, {
      domain: 'issues',
      entityType: 'issue',
      result: {
        projectId,
        total: 3,
        items: [
          { id: 'issue-open-1', title: 'Issue Open 1', status: 'open' },
          { id: 'issue-open-2', title: 'Issue Open 2', status: 'open' },
          { id: 'issue-closed-1', title: 'Issue Closed 1', status: 'closed' }
        ],
        source: 'seed:test-runtime-local-issues'
      },
      projectName
    });

    const toolCalls: string[] = [];
    const result = await runAgent(session.id, '¿Algún issue está open?', {
      onToolCall: (name) => toolCalls.push(name)
    });

    console.log(
      JSON.stringify(
        {
          sessionId: session.id,
          toolCalls,
          text: result.text
        },
        null,
        2
      )
    );

    if (toolCalls.length > 0) {
      throw new Error('El follow-up analítico de issues volvió a usar tools y debía resolverse localmente.');
    }
  } finally {
    await closeMysqlPool();
  }
}

main().catch((error) => {
  console.error('Error en testRuntimeLocalIssues');
  console.error(error);
  process.exit(1);
});
