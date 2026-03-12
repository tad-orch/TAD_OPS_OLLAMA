import { env } from '../config/env.js';
import { getProjects } from '../services/apsAdmin.js';
import { get2LeggedToken } from '../services/apsAuth.js';

async function main() {
  console.log('1) Obteniendo token 2-legged...');
  const token = await get2LeggedToken();
  console.log('Token OK');

  console.log(`2) Usando APS_USER_ID para impersonación: ${env.apsUserId}`);

  console.log(`3) Listando proyectos del account ${env.apsAccountId}...`);
  const projects = await getProjects(token, env.apsUserId);

  console.log(`Proyectos encontrados: ${projects.length}`);
  for (const project of projects) {
    console.log(`- ${project.name} (${project.id})`);
  }
}

main().catch((error) => {
  console.error('Error al obtener proyectos');
  const response = (error as { response?: { status?: number; data?: unknown } }).response;
  if (response?.status) {
    console.error('HTTP Status:', response.status);
    console.error('Response data:', response.data);
  } else {
    console.error(error);
  }
  process.exit(1);
});
