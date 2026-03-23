import { runAgent } from '../app/agent.js';
import { createSession } from '../db/repositories/sessionsRepo.js';
import { closeMysqlPool } from '../shared/db/mysql.js';

async function main() {
  try {
    const session = createSession('Runtime Local Projects');
    const firstToolCalls: string[] = [];
    const secondToolCalls: string[] = [];
    const thirdToolCalls: string[] = [];

    const first = await runAgent(session.id, 'Dame los proyectos ACC disponibles para este account.', {
      onToolCall: (name) => firstToolCalls.push(name)
    });
    const second = await runAgent(session.id, '¿Cuántos están activos?', {
      onToolCall: (name) => secondToolCalls.push(name)
    });
    const third = await runAgent(session.id, '¿Cuántos proyectos empiezan con TAD?', {
      onToolCall: (name) => thirdToolCalls.push(name)
    });

    console.log(
      JSON.stringify(
        {
          sessionId: session.id,
          firstToolCalls,
          secondToolCalls,
          thirdToolCalls,
          firstText: first.text,
          secondText: second.text,
          thirdText: third.text
        },
        null,
        2
      )
    );

    if (!firstToolCalls.includes('get_projects_by_account')) {
      throw new Error('La consulta inicial de proyectos no ejecutó get_projects_by_account.');
    }

    if (secondToolCalls.length > 0) {
      throw new Error('El follow-up analítico de proyectos por estado volvió a usar tools y debía resolverse localmente.');
    }

    if (thirdToolCalls.length > 0) {
      throw new Error('El follow-up analítico de proyectos por prefijo volvió a usar tools y debía resolverse localmente.');
    }
  } finally {
    await closeMysqlPool();
  }
}

main()
  .catch((error) => {
    console.error('Error en testRuntimeLocalProjects');
    console.error(error);
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
