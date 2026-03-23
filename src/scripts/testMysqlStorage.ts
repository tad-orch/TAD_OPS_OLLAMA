import { env } from '../config/env.js';
import { listAccountProjects } from '../domains/acc/account-admin/projects/service.js';
import { persistProjectsHybridSnapshot } from '../shared/storage/hybridPersistence.js';
import { closeMysqlPool, getMysqlPool, testMysqlConnection } from '../shared/db/mysql.js';

async function main() {
  try {
    const connection = await testMysqlConnection();
    console.log(JSON.stringify(connection, null, 2));

    const result = await listAccountProjects();
    await persistProjectsHybridSnapshot({
      accountId: env.apsAccountId,
      endpoint: result.endpoint,
      requestContext: {
        authMode: result.authMode,
        source: 'test:mysql-storage'
      },
      rawPages: result.rawPages,
      projects: result.projects
    });

    const pool = await getMysqlPool();
    const [documents] = await pool.query('SELECT COUNT(*) AS count FROM api_documents');
    const [canonical] = await pool.query('SELECT COUNT(*) AS count FROM canonical_projects');
    const [chunks] = await pool.query('SELECT COUNT(*) AS count FROM document_chunks');

    console.log(JSON.stringify({ documents, canonical, chunks }, null, 2));
  } finally {
    await closeMysqlPool();
  }
}

main().catch((error) => {
  console.error('Error validando persistencia MySQL');
  console.error(error);
  process.exit(1);
});
