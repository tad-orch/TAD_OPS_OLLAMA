import { env } from '../config/env.js';
import { getProjectUsers, getProjects } from '../services/apsAdmin.js';
import { get2LeggedToken } from '../services/apsAuth.js';

async function main() {
  const token = await get2LeggedToken();
  const providedProjectId = process.argv[2]?.trim();

  let projectId = providedProjectId;
  if (!projectId) {
    const projects = await getProjects(token, env.apsUserId);
    if (projects.length === 0) {
      throw new Error('No hay proyectos disponibles para elegir uno en testProjectUsers');
    }

    projectId = projects[0]?.id;
    if (!projectId) {
      throw new Error('No se pudo resolver un projectId para testProjectUsers');
    }
    console.log(`1) No se recibió projectId. Usando el primer proyecto: ${projectId}`);
  } else {
    console.log(`1) Usando projectId recibido: ${projectId}`);
  }

  console.log(`2) Listando usuarios del proyecto con APS_USER_ID ${env.apsUserId}...`);
  const users = await getProjectUsers(token, projectId, {
    actingUserId: env.apsUserId
  });

  console.log(`Usuarios encontrados: ${users.length}`);
  for (const user of users) {
    console.log(`- ${user.name || user.email || user.id} | ${user.email || 'sin email'} | ${user.status || 'sin status'}`);
  }
}

main().catch((error) => {
  console.error('Error en testProjectUsers');
  const response = (error as { response?: { status?: number; data?: unknown } }).response;
  if (response?.status) {
    console.error('HTTP Status:', response.status);
    console.error('Response data:', response.data);
  } else {
    console.error(error);
  }
  process.exit(1);
});
