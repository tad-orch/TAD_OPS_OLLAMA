import { runAgent } from '../app/agent.js';
import { getSessionContext } from '../db/repositories/contextRepo.js';
import { createSession } from '../db/repositories/sessionsRepo.js';
import { closeMysqlPool } from '../shared/db/mysql.js';

async function main() {
  try {
    const session = createSession('Runtime Project Promotion');
    const toolCalls: string[] = [];
    const result = await runAgent(session.id, 'Dame los usuarios del proyecto GM Ramos Arizpe.', {
      onToolCall: (name) => toolCalls.push(name)
    });
    const context = getSessionContext(session.id);

    console.log(
      JSON.stringify(
        {
          sessionId: session.id,
          toolCalls,
          text: result.text,
          currentProjectId: context?.current_project_id,
          currentProjectName: context?.current_project_name,
          aliases: context?.memory_json.currentProjectAliases,
          confidence: context?.memory_json.currentProjectConfidence
        },
        null,
        2
      )
    );

    if (!context?.current_project_id) {
      throw new Error('No se promovió current_project_id después de la consulta exitosa.');
    }

    if (!context.current_project_name) {
      throw new Error('No se promovió current_project_name después de la consulta exitosa.');
    }
  } finally {
    await closeMysqlPool();
  }
}

main().catch((error) => {
  console.error('Error en testRuntimeProjectPromotion');
  console.error(error);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
