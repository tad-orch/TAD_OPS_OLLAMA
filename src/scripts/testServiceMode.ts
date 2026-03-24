import { executeServiceOperation } from '../service/operations.js';
import { closeMysqlPool } from '../shared/db/mysql.js';

async function main() {
  try {
    const projects = await executeServiceOperation('get_projects');
    const sync = await executeServiceOperation('sync_domain', {
      domain: 'projects'
    });
    const canonical = await executeServiceOperation('query_canonical', {
      domain: 'projects',
      filters: {
        status: 'active'
      },
      limit: 5
    });

    console.log(
      JSON.stringify(
        {
          projects,
          sync,
          canonical
        },
        null,
        2
      )
    );

    if (!projects.ok || projects.meta.source !== 'acc_api_fresh') {
      throw new Error('get_projects no devolvio un envelope rigido valido.');
    }

    if (!sync.ok) {
      throw new Error('sync_domain projects fallo.');
    }

    if (!canonical.ok || canonical.meta.source !== 'canonical_mysql') {
      throw new Error('query_canonical no devolvio source canonical_mysql.');
    }
  } finally {
    await closeMysqlPool();
  }
}

main().catch((error) => {
  console.error('Error en testServiceMode');
  console.error(error);
  process.exit(1);
});
