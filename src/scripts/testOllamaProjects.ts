import { createSession } from '../db/repositories/sessionsRepo.js';
import { runAgent } from '../app/agent.js';

async function main() {
  const session = createSession('Test Ollama Projects');
  console.log(`1) Sesión creada: ${session.id}`);

  const result = await runAgent(session.id, 'Dame los proyectos ACC disponibles para este account.', {
    onToolCall: (name) => {
      console.log(`[tool] ${name}`);
    }
  });

  console.log('\nRespuesta final:\n');
  console.log(result.text);
}

main().catch((error) => {
  console.error('Error en testOllamaProjects');
  console.error(error);
  process.exit(1);
});
