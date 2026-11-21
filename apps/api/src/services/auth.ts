import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PublicUser, UserRole } from '@corridor/core';
import { DomainError } from '../engine/errors';
import { toPublicUser, type Repositories } from '../db/repositories';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: object,
) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

/** Password hashes are stored as `scrypt$N$r$p$salt$hash` (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Simple fixed-window limiter for login attempts, keyed by IP + username. */
class AttemptLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(key: string) {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (entry && entry.resetAt > now && entry.count >= this.max) {
      const wait = Math.ceil((entry.resetAt - now) / 1000);
      throw new DomainError(`Too many attempts. Try again in ${wait} s.`, 429, 'rate_limited');
    }
  }

  fail(key: string) {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    else entry.count++;
  }

  reset(key: string) {
    this.attempts.delete(key);
  }
}

export class AuthService {
  private limiter = new AttemptLimiter(5, 60_000);

  constructor(
    private readonly repos: Repositories,
    private readonly sessionTtlMs: number,
  ) {}

  async ensureSeedAdmin(username: string, password: string | undefined, log: (msg: string) => void) {
    if (this.repos.users.count() > 0) return;
    if (!password) {
      log(
        'No users exist and SEED_ADMIN_PASSWORD is not set; create the first account via sign-up (it becomes admin).',
      );
      return;
    }
    this.repos.users.create({
      username,
      name: 'Control Room Administrator',
      passwordHash: await hashPassword(password),
      role: 'admin',
      zone: 'City Command',
    });
    log(`Seeded administrator account "${username}"`);
  }

  async login(username: string, password: string, meta: { ip: string | null; userAgent: string | null }) {
    const key = `${meta.ip}|${username.toLowerCase()}`;
    this.limiter.check(key);
    const user = this.repos.users.findByUsername(username);
    // always run a hash to keep timing similar for unknown users
    const ok = user ? await verifyPassword(password, user.passwordHash) : (await hashPassword(password), false);
    if (!user || !ok) {
      this.limiter.fail(key);
      throw new DomainError('Invalid username or password', 400, 'invalid_credentials');
    }
    this.limiter.reset(key);
    this.repos.users.touchLogin(user.id);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.sessionTtlMs;
    this.repos.sessions.create(sha256(token), user.id, expiresAt, meta.userAgent, meta.ip);
    return { token, expiresAt, user: toPublicUser(this.repos.users.findById(user.id)!) };
  }

  async register(input: { username: string; name: string; password: string; zone: string }): Promise<PublicUser> {
    if (this.repos.users.findByUsername(input.username))
      throw new DomainError('That username is already taken', 409, 'conflict');
    // The very first account administers the deployment.
    const role: UserRole = this.repos.users.count() === 0 ? 'admin' : 'dispatcher';
    const user = this.repos.users.create({ ...input, passwordHash: await hashPassword(input.password), role });
    return toPublicUser(user);
  }

  authenticate(token: string | undefined): PublicUser | null {
    if (!token) return null;
    const userId = this.repos.sessions.findUserId(sha256(token));
    if (!userId) return null;
    const user = this.repos.users.findById(userId);
    return user ? toPublicUser(user) : null;
  }

  logout(token: string | undefined) {
    if (token) this.repos.sessions.delete(sha256(token));
  }

  async changePassword(userId: number, current: string, next: string, keepToken?: string) {
    const user = this.repos.users.findById(userId);
    if (!user || !(await verifyPassword(current, user.passwordHash)))
      throw new DomainError('Current password is incorrect', 400, 'invalid_credentials');
    this.repos.users.update(userId, { passwordHash: await hashPassword(next) });
    // sign out every other session
    this.repos.sessions.deleteForUser(userId, keepToken ? sha256(keepToken) : undefined);
  }
}
