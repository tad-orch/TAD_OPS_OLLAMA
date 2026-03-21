import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getSessionContext } from '../db/repositories/contextRepo.js';
import { createSession } from '../db/repositories/sessionsRepo.js';
import { runAgent } from './agent.js';

async function main() {
  const rl = createInterface({ input, output });
  let currentSession = createSession();

  console.log(`ACC Expert Agent listo. Sesión actual: ${currentSession.id}`);
  console.log('Comandos: /exit, /session, /context, /new');

  try {
    while (true) {
      const userInput = (await rl.question('> ')).trim();
      if (!userInput) {
        continue;
      }

      if (userInput === '/exit' || userInput === 'exit' || userInput === 'quit') {
        break;
      }

      if (userInput === '/session') {
        console.log(currentSession.id);
        continue;
      }

      if (userInput === '/context') {
        const context = getSessionContext(currentSession.id);
        console.log(JSON.stringify(context ?? {}, null, 2));
        continue;
      }

      if (userInput === '/new') {
        currentSession = createSession();
        console.log(`Nueva sesión: ${currentSession.id}`);
        continue;
      }

      const result = await runAgent(currentSession.id, userInput, {
        onToolCall: (name) => {
          console.log(`[tool] ${name}`);
        }
      });

      console.log(result.text);
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error('Error en chat interactivo');
  console.error(error);
  process.exit(1);
});
