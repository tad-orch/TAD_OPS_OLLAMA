import { getConstructionAuthStatus, getValidAccessToken } from '../services/apsUserAuth.js';

async function main() {
  const status = await getConstructionAuthStatus();
  console.log(JSON.stringify(status, null, 2));

  if (!status.readyForConstructionEndpoints) {
    console.log('No hay sesión 3-legged lista; no se intentará resolver access token.');
    return;
  }

  const token = await getValidAccessToken();
  console.log(`Access token resuelto correctamente (${token.length} chars).`);
}

main().catch((error) => {
  console.error('Error al validar auth 3-legged');
  console.error(error);
  process.exit(1);
});
