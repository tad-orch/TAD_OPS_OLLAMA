import type { Tool } from 'ollama';
import { clearAuthProfile, startAccUserLogin } from '../services/apsUserAuth.js';
import type {
  StartAccUserLoginToolArgs,
  StartAccUserLoginToolResult
} from '../types/aps.js';

export const startAccUserLoginToolDefinition: Tool = {
  type: 'function',
  function: {
    name: 'start_acc_user_login',
    description:
      'Inicia autenticación Autodesk ACC 3-legged asistida por navegador con callback local en localhost:3000/auth/three-legged.',
    parameters: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description: 'Si es true, limpia la sesión local previa antes de iniciar un nuevo login.'
        }
      }
    }
  }
};

export async function startAccUserLoginTool(
  args: StartAccUserLoginToolArgs = {}
): Promise<StartAccUserLoginToolResult> {
  if (args.force) {
    await clearAuthProfile();
  }

  return startAccUserLogin();
}
