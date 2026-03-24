import { runAgent } from '../app/agent.js';
import { env } from '../config/env.js';
import { upsertSessionContext } from '../db/repositories/contextRepo.js';
import { createSession } from '../db/repositories/sessionsRepo.js';
import { closeMysqlPool, ensureMysqlSchema, getMysqlPool, isMysqlConfigured, toMysqlDateTime } from '../shared/db/mysql.js';

const projectId = 'raw-evidence-project';
const projectName = 'Proyecto Raw Evidence';
const documentId = 'doc-raw-evidence-1';

async function seedRawEvidence(): Promise<void> {
  if (!isMysqlConfigured()) {
    throw new Error('MySQL no está configurado; no se puede sembrar api_documents para esta prueba.');
  }

  await ensureMysqlSchema();
  const pool = await getMysqlPool();
  await pool.execute('DELETE FROM canonical_issues WHERE project_id = ?', [projectId]);
  await pool.execute('DELETE FROM api_documents WHERE id = ?', [documentId]);
  await pool.execute(
    `
    INSERT INTO api_documents (
      id, domain, entity_type, endpoint, http_method, request_context_json,
      scope_ids_json, response_hash, response_json, fetched_at
    )
    VALUES (?, 'issues', 'issue', 'seed://issues', 'GET', ?, ?, ?, ?, ?)
    `,
    [
      documentId,
      JSON.stringify({ source: 'test:runtime-raw-evidence' }),
      JSON.stringify({ projectId }),
      'seed-hash',
      JSON.stringify({
        results: [
          { id: 'issue-1', title: 'Safety issue 1', status: 'open', type: 'safety' },
          { id: 'issue-2', title: 'Quality issue', status: 'open', type: 'quality' },
          { id: 'issue-3', title: 'Safety issue 2', status: 'closed', type: 'safety' }
        ]
      }),
      toMysqlDateTime(new Date())
    ]
  );
}

async function main() {
  try {
    await seedRawEvidence();
    const session = createSession('Runtime Raw Evidence');

    upsertSessionContext(session.id, {
      current_account_id: env.apsAccountId,
      current_project_id: projectId,
      current_project_name: projectName,
      memory_json: {
        lastResolvedProjectId: projectId,
        lastResolvedProjectName: projectName,
        currentProjectAliases: [projectId, projectName, 'raw', 'evidence'],
        currentProjectConfidence: 1,
        currentProjectUpdatedAt: new Date().toISOString()
      }
    });

    const toolCalls: string[] = [];
    const result = await runAgent(session.id, '¿Cuántos issues son de tipo safety?', {
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
      throw new Error('La ruta raw evidence volvió a usar tools y debía resolverse localmente.');
    }
  } finally {
    await closeMysqlPool();
  }
}

main()
  .catch((error) => {
    console.error('Error en testRuntimeRawEvidence');
    console.error(error);
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
