-- Referência gerada; as migrações são executadas pela aplicação.
CREATE TABLE audit(id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL, details TEXT);

CREATE TABLE budget(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), value_cents INTEGER NOT NULL CHECK(value_cents>=0), version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE companies(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), expense_id TEXT REFERENCES expenses(id), resource_id TEXT REFERENCES resources(id), kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL, CHECK((expense_id IS NULL)!=(resource_id IS NULL)), UNIQUE(expense_id,kind), UNIQUE(resource_id,kind));

CREATE TABLE expenses(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), value_cents INTEGER NOT NULL CHECK(value_cents>0), version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE links(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE login_attempts(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);

CREATE TABLE migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE projects(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE remaps(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), value_cents INTEGER NOT NULL CHECK(value_cents>0), version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE requests(user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,key));

CREATE TABLE resources(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), value_cents INTEGER NOT NULL CHECK(value_cents>0), installment INTEGER, version INTEGER NOT NULL DEFAULT 1, UNIQUE(project_id,installment));

CREATE TABLE rubrics(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE schedule(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), value_cents INTEGER NOT NULL CHECK(value_cents>=0), version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);

CREATE TABLE team(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')), active INTEGER NOT NULL DEFAULT 1);

CREATE INDEX budget_project ON budget(project_id);

CREATE INDEX documents_project ON documents(project_id);

CREATE INDEX expenses_project ON expenses(project_id);

CREATE INDEX links_project ON links(project_id);

CREATE INDEX projects_company ON projects(company_id);

CREATE INDEX remaps_project ON remaps(project_id);

CREATE INDEX resources_project ON resources(project_id);

CREATE UNIQUE INDEX rubrics_name ON rubrics(project_id, lower(json_extract(data, '$.name')));

CREATE INDEX rubrics_project ON rubrics(project_id);

CREATE INDEX schedule_project ON schedule(project_id);

CREATE INDEX sessions_expiry ON sessions(expires);

CREATE INDEX team_project ON team(project_id);
