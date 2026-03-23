import mysql from 'mysql2/promise';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { mysqlSchemaSql } from './mysqlSchema.js';

let pool: Pool | undefined;
let initialized = false;

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function isMysqlConfigured(): boolean {
  return Boolean(env.mysqlHost && env.mysqlDatabase && env.mysqlUser);
}

export function toMysqlDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function createPool(): Promise<Pool> {
  if (!env.mysqlHost || !env.mysqlDatabase || !env.mysqlUser) {
    throw new Error('MySQL no está configurado completamente en variables de entorno');
  }

  const baseConfig = {
    host: env.mysqlHost,
    port: env.mysqlPort,
    user: env.mysqlUser,
    ...(env.mysqlPassword ? { password: env.mysqlPassword } : {}),
    ...(env.mysqlSsl ? { ssl: {} } : {})
  };

  const bootstrap = await mysql.createConnection(baseConfig);
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${env.mysqlDatabase}\``);
  await bootstrap.end();

  return mysql.createPool({
    ...baseConfig,
    database: env.mysqlDatabase,
    waitForConnections: true,
    connectionLimit: env.mysqlPoolMax,
    maxIdle: env.mysqlPoolMax,
    idleTimeout: 60_000,
    queueLimit: 0
  });
}

export async function getMysqlPool(): Promise<Pool> {
  if (!pool) {
    pool = await createPool();
  }

  return pool;
}

export async function closeMysqlPool(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = undefined;
  initialized = false;
}

export async function ensureMysqlSchema(): Promise<void> {
  if (initialized || !isMysqlConfigured()) {
    return;
  }

  const activePool = await getMysqlPool();
  for (const statement of splitSqlStatements(mysqlSchemaSql)) {
    await activePool.query(statement);
  }

  initialized = true;
}

export async function testMysqlConnection(): Promise<{
  connected: boolean;
  database: string;
  version: string;
}> {
  await ensureMysqlSchema();
  const activePool = await getMysqlPool();
  const [rows] = await activePool.query<RowDataPacket[]>('SELECT DATABASE() AS database_name, VERSION() AS version');
  const row = rows[0];

  return {
    connected: true,
    database: String(row?.database_name ?? env.mysqlDatabase ?? ''),
    version: String(row?.version ?? '')
  };
}
