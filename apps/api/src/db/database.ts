import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * SQLite persistence via Node's built-in `node:sqlite` driver: zero native
 * dependencies, a single file, and WAL mode for concurrent reads. Migrations
 * are ordered SQL scripts tracked with `PRAGMA user_version`.
 */

const MIGRATIONS: string[] = [
  /* 1: core schema */ `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('admin','supervisor','dispatcher','hospital')),
    zone          TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT,
    ip         TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE incidents (
    id          TEXT    PRIMARY KEY,
    type        TEXT    NOT NULL,
    severity    INTEGER NOT NULL,
    status      TEXT    NOT NULL,
    location    TEXT    NOT NULL,
    reported_at INTEGER NOT NULL,
    resolved_at INTEGER,
    data        TEXT    NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_incidents_reported ON incidents(reported_at DESC);
  CREATE INDEX idx_incidents_status ON incidents(status);

  CREATE TABLE outcomes (
    incident_id   TEXT    PRIMARY KEY,
    type          TEXT    NOT NULL,
    severity      INTEGER NOT NULL,
    resolved_at   INTEGER NOT NULL,
    response_s    REAL    NOT NULL,
    baseline_s    REAL    NOT NULL,
    idle_s        REAL    NOT NULL,
    baseline_idle_s REAL  NOT NULL,
    corridor      INTEGER NOT NULL
  );

  CREATE TABLE audit_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       INTEGER NOT NULL,
    actor    TEXT    NOT NULL,
    action   TEXT    NOT NULL,
    detail   TEXT    NOT NULL,
    category TEXT    NOT NULL
  );
  CREATE INDEX idx_audit_at ON audit_log(at DESC);

  CREATE TABLE kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
];

export type Database = DatabaseSync;

export function openDatabase(file: string): Database {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(db);
  return db;
}

function migrate(db: Database) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
