import { queryCanonical } from '../service/queryCanonical.js';
import { closeMysqlPool } from '../shared/db/mysql.js';

async function main() {
  try {
    const result = await queryCanonical({
      domain: 'projects',
      filters: {
        status: 'active'
      },
      limit: 10
    });

    console.log(JSON.stringify(result, null, 2));

    if (result.count === 0) {
      throw new Error('query_canonical no devolvio proyectos activos.');
    }
  } finally {
    await closeMysqlPool();
  }
}

main().catch((error) => {
  console.error('Error en testServiceQueryCanonical');
  console.error(error);
  process.exit(1);
});
