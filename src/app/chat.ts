import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getSessionContext } from '../db/repositories/contextRepo.js';
import { createSession } from '../db/repositories/sessionsRepo.js';
import { runAgent } from './agent.js';

async function main() {
  const rl = createInterface({ input, output });
  let currentSession = createSession();

  console.log(`ACC Expert Agent harness/debug listo. Sesion actual: ${currentSession.id}`);
  console.log('Comandos: /exit, /bye, /session, /context, /new');

  try {
    while (true) {
      let userInput = '';
      try {
        userInput = (await rl.question('> ')).trim();
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (code === 'ERR_USE_AFTER_CLOSE') {
          break;
        }

        throw error;
      }

      if (!userInput) {
        if (input.readableEnded) {
          break;
        }

        continue;
      }

      if (userInput === '/exit' || userInput === '/bye' || userInput === 'exit' || userInput === 'quit') {
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
        console.log(`Nueva sesion: ${currentSession.id}`);
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
