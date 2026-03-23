import { listHubProjects } from '../domains/data-management/projects/service.js';

async function main() {
  const hubId = process.argv[2];
  console.log('1) Listando proyectos de Data Management...');
  const result = await listHubProjects(hubId);
  console.log(`Hub: ${result.hubId}`);
  console.log(`Proyectos encontrados: ${result.projects.length}`);
  for (const project of result.projects.slice(0, 20)) {
    console.log(`- ${project.name} (${project.id})`);
  }
}

main().catch((error) => {
  console.error('Error al obtener proyectos de Data Management');
  const response = (error as { response?: { status?: number; data?: unknown } }).response;
  if (response?.status) {
    console.error('HTTP Status:', response.status);
    console.error('Response data:', response.data);
  } else {
    console.error(error);
  }
  process.exit(1);
});
