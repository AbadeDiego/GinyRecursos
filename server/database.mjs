import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(path = process.env.DATABASE_PATH || './data/subvencao.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`);
  if (!db.prepare('SELECT version FROM migrations WHERE version=1').get()) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')), active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE INDEX sessions_expiry ON sessions(expires);
      CREATE TABLE login_attempts(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE companies(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE projects(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX projects_company ON projects(company_id);
      CREATE TABLE team(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE schedule(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), value_cents INTEGER NOT NULL CHECK(value_cents>=0), version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE links(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE expenses(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), value_cents INTEGER NOT NULL CHECK(value_cents>0), version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE resources(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), value_cents INTEGER NOT NULL CHECK(value_cents>0), installment INTEGER, version INTEGER NOT NULL DEFAULT 1, UNIQUE(project_id,installment));
      CREATE TABLE budget(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), value_cents INTEGER NOT NULL CHECK(value_cents>=0), version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE remaps(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), value_cents INTEGER NOT NULL CHECK(value_cents>0), version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), expense_id TEXT REFERENCES expenses(id), resource_id TEXT REFERENCES resources(id), kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL, CHECK((expense_id IS NULL)!=(resource_id IS NULL)), UNIQUE(expense_id,kind), UNIQUE(resource_id,kind));
      CREATE TABLE audit(id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE requests(user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,key));
      INSERT INTO migrations VALUES(1,datetime('now'));
      COMMIT;`);
    for (const table of ['team','schedule','links','expenses','resources','budget','remaps','documents']) db.exec(`CREATE INDEX IF NOT EXISTS ${table}_project ON ${table}(project_id)`);
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
