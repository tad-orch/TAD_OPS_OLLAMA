import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { initializeSchema } from './schema.js';

const dbPath = resolve(process.cwd(), 'data', 'agent.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

export const db: BetterSqlite3.Database = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

initializeSchema(db);

export { dbPath };
