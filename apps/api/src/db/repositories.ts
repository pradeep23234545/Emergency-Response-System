import type { AuditEntry, Incident, PublicUser, ResponseOutcome, UserRole } from '@corridor/core';
import type { Database } from './database';

/* ------------------------------ users ------------------------------ */

interface UserRow {
  id: number;
  username: string;
  name: string;
  password_hash: string;
  role: UserRole;
  zone: string;
  created_at: number;
  last_login_at: number | null;
}

export interface UserRecord extends PublicUser {
  passwordHash: string;
}

const toUser = (r: UserRow): UserRecord => ({
  id: r.id,
  username: r.username,
  name: r.name,
  role: r.role,
  zone: r.zone,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
  passwordHash: r.password_hash,
});

export const toPublicUser = ({ passwordHash: _omit, ...user }: UserRecord): PublicUser => user;

export class UserRepository {
  constructor(private readonly db: Database) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  findByUsername(username: string): UserRecord | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    return row && toUser(row);
  }

  findById(id: number): UserRecord | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row && toUser(row);
  }

  list(): PublicUser[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as UserRow[]).map((r) =>
      toPublicUser(toUser(r)),
    );
  }

  create(input: { username: string; name: string; passwordHash: string; role: UserRole; zone: string }): UserRecord {
    const result = this.db
      .prepare('INSERT INTO users (username, name, password_hash, role, zone, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.username, input.name, input.passwordHash, input.role, input.zone, Date.now());
    return this.findById(Number(result.lastInsertRowid))!;
  }

  update(id: number, patch: { role?: UserRole; zone?: string; name?: string; passwordHash?: string }) {
    const columns: [string, unknown][] = [];
    if (patch.role) columns.push(['role', patch.role]);
    if (patch.zone) columns.push(['zone', patch.zone]);
    if (patch.name) columns.push(['name', patch.name]);
    if (patch.passwordHash) columns.push(['password_hash', patch.passwordHash]);
    if (!columns.length) return this.findById(id);
    this.db
      .prepare(`UPDATE users SET ${columns.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...(columns.map(([, v]) => v) as (string | number)[]), id);
    return this.findById(id);
  }

  touchLogin(id: number) {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), id);
  }

  countAdmins(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
  }
}

/* ----------------------------- sessions ---------------------------- */

export class SessionRepository {
  constructor(private readonly db: Database) {}

  create(tokenHash: string, userId: number, expiresAt: number, userAgent: string | null, ip: string | null) {
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(tokenHash, userId, Date.now(), expiresAt, userAgent, ip);
  }

  findUserId(tokenHash: string): number | undefined {
    const row = this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as
      { user_id: number; expires_at: number } | undefined;
    if (!row) return undefined;
    if (row.expires_at < Date.now()) {
      this.delete(tokenHash);
      return undefined;
    }
    return row.user_id;
  }

  delete(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteForUser(userId: number, exceptHash?: string) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, exceptHash ?? '');
  }

  purgeExpired() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  }
}

/* ----------------------------- incidents --------------------------- */

export interface IncidentQuery {
  status?: string;
  type?: string;
  q?: string;
  limit: number;
  offset: number;
}

export class IncidentRepository {
  constructor(private readonly db: Database) {}

  upsert(incident: Incident) {
    this.db
      .prepare(
        `INSERT INTO incidents (id, type, severity, status, location, reported_at, resolved_at, data, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, severity = excluded.severity,
           resolved_at = excluded.resolved_at, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(
        incident.id,
        incident.type,
        incident.severity,
        incident.status,
        incident.location,
        incident.reportedAt,
        incident.resolvedAt,
        JSON.stringify(incident),
        Date.now(),
      );
  }

  find(id: string): Incident | undefined {
    const row = this.db.prepare('SELECT data FROM incidents WHERE id = ?').get(id) as { data: string } | undefined;
    return row && (JSON.parse(row.data) as Incident);
  }

  search(query: IncidentQuery): { items: Incident[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }
    if (query.type) {
      where.push('type = ?');
      params.push(query.type);
    }
    if (query.q) {
      where.push('(id LIKE ? OR location LIKE ?)');
      params.push(`%${query.q}%`, `%${query.q}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM incidents ${clause}`).get(...params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT data FROM incidents ${clause} ORDER BY reported_at DESC LIMIT ? OFFSET ?`)
      .all(...params, query.limit, query.offset) as { data: string }[];
    return { items: rows.map((r) => JSON.parse(r.data) as Incident), total };
  }

  /** Highest numeric incident id, used to continue the sequence after a restart. */
  maxSequence(): number {
    const row = this.db.prepare('SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM incidents').get() as {
      n: number | null;
    };
    return row.n ?? 1000;
  }
}

/* ------------------------------ outcomes --------------------------- */

export class OutcomeRepository {
  constructor(private readonly db: Database) {}

  insert(o: ResponseOutcome) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO outcomes (incident_id, type, severity, resolved_at, response_s, baseline_s, idle_s, baseline_idle_s, corridor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        o.incidentId,
        o.type,
        o.severity,
        o.resolvedAt,
        o.responseSeconds,
        o.baselineSeconds,
        o.idleSeconds,
        o.baselineIdleSeconds,
        o.corridorEnabled ? 1 : 0,
      );
  }

  recent(limit = 400): ResponseOutcome[] {
    const rows = this.db.prepare('SELECT * FROM outcomes ORDER BY resolved_at DESC LIMIT ?').all(limit) as {
      incident_id: string;
      type: ResponseOutcome['type'];
      severity: number;
      resolved_at: number;
      response_s: number;
      baseline_s: number;
      idle_s: number;
      baseline_idle_s: number;
      corridor: number;
    }[];
    return rows.reverse().map((r) => ({
      incidentId: r.incident_id,
      type: r.type,
      severity: r.severity,
      resolvedAt: r.resolved_at,
      responseSeconds: r.response_s,
      baselineSeconds: r.baseline_s,
      idleSeconds: r.idle_s,
      baselineIdleSeconds: r.baseline_idle_s,
      corridorEnabled: r.corridor === 1,
    }));
  }

  clear() {
    this.db.exec('DELETE FROM outcomes');
  }
}

/* ------------------------------ audit ------------------------------ */

export class AuditRepository {
  constructor(private readonly db: Database) {}

  insert(entry: Omit<AuditEntry, 'id'>): AuditEntry {
    const result = this.db
      .prepare('INSERT INTO audit_log (at, actor, action, detail, category) VALUES (?, ?, ?, ?, ?)')
      .run(entry.at, entry.actor, entry.action, entry.detail, entry.category);
    return { id: Number(result.lastInsertRowid), ...entry };
  }

  list(opts: { limit: number; before?: number; category?: string }): AuditEntry[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.before) {
      where.push('id < ?');
      params.push(opts.before);
    }
    if (opts.category) {
      where.push('category = ?');
      params.push(opts.category);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT * FROM audit_log ${clause} ORDER BY id DESC LIMIT ?`)
      .all(...params, opts.limit) as unknown as AuditEntry[];
  }
}

/* -------------------------------- kv ------------------------------- */

export class KeyValueRepository {
  constructor(private readonly db: Database) {}

  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  set(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(key, JSON.stringify(value), Date.now());
  }

  delete(key: string) {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
  }
}

export interface Repositories {
  users: UserRepository;
  sessions: SessionRepository;
  incidents: IncidentRepository;
  outcomes: OutcomeRepository;
  audit: AuditRepository;
  kv: KeyValueRepository;
}

export function createRepositories(db: Database): Repositories {
  return {
    users: new UserRepository(db),
    sessions: new SessionRepository(db),
    incidents: new IncidentRepository(db),
    outcomes: new OutcomeRepository(db),
    audit: new AuditRepository(db),
    kv: new KeyValueRepository(db),
  };
}
