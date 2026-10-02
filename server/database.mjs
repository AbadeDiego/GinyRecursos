import { sourceOf, budgetSource } from '../lib/funding.mjs';
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
  if (!db.prepare('SELECT version FROM migrations WHERE version=2').get()) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE rubrics(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX rubrics_project ON rubrics(project_id);
      CREATE UNIQUE INDEX rubrics_name ON rubrics(project_id, lower(json_extract(data, '$.name')));
      ALTER TABLE audit ADD COLUMN details TEXT;
      INSERT INTO migrations VALUES(2,datetime('now'));
      COMMIT;`);
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version=3').get()) {
    transaction(db,()=>{
      // Keep explicit classifications. Infer legacy records from their rubric budget.
      const budgets=db.prepare('SELECT project_id,data FROM budget').all().map(r=>({...JSON.parse(r.data),projectId:r.project_id}));
      for(const table of ['schedule','expenses'])for(const row of db.prepare(`SELECT id,project_id,data FROM ${table}`).all()) {
        const data=JSON.parse(row.data);
        if(data.source)continue;
        const matches=budgets.filter(b=>b.projectId===row.project_id&&b.elemento===(data.rubric||data.item));
        const sources=new Set(matches.map(budgetSource));
        data.source=sources.size===1?[...sources][0]:sourceOf(data);
        data.sourceInferred=true;
        db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(data),row.id);
      }
      for(const row of db.prepare('SELECT id,data FROM remaps').all()) {
        const data=JSON.parse(row.data);
        const origin=data.sourceScheduleId?db.prepare('SELECT data FROM schedule WHERE id=?').get(data.sourceScheduleId):null;
        if(!data.source)data.source=origin?sourceOf(JSON.parse(origin.data)):sourceOf({rubric:data.from});
        if(data.destinationScheduleId) {
          const target=db.prepare('SELECT data FROM schedule WHERE id=?').get(data.destinationScheduleId);
          if(target){const destination=JSON.parse(target.data);if(destination.sourceInferred){destination.source=data.source;db.prepare('UPDATE schedule SET data=? WHERE id=?').run(JSON.stringify(destination),data.destinationScheduleId);}}
        }
        db.prepare('UPDATE remaps SET data=? WHERE id=?').run(JSON.stringify(data),row.id);
      }
      db.prepare("INSERT INTO migrations VALUES(3,datetime('now'))").run();
    });
  }
  if (!db.prepare('SELECT version FROM migrations WHERE version=4').get()) {
    transaction(db,()=>{
      db.exec(`CREATE TABLE projectDocuments(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), bytes BLOB NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX projectDocuments_project ON projectDocuments(project_id);
        INSERT INTO migrations VALUES(4,datetime('now'));`);
    });
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
