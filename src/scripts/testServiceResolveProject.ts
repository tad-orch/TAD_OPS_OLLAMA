import { resolveProject } from '../service/projectResolver.js';
import { closeMysqlPool } from '../shared/db/mysql.js';

async function main() {
  try {
    const result = await resolveProject({
      query: 'Pit Houses',
      limit: 3
    });

    console.log(JSON.stringify(result, null, 2));

    if (!result.some((item) => item.name.includes('Pit_Houses') || item.name.includes('Pit Houses'))) {
      throw new Error('resolve_project no encontro TAD_Pit_Houses con un caso real.');
    }
  } finally {
    await closeMysqlPool();
  }
}

main().catch((error) => {
  console.error('Error en testServiceResolveProject');
  console.error(error);
  process.exit(1);
});
