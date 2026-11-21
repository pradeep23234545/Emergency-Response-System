import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Repository root (works from src/ under tsx and from dist/ after bundling). */
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..', '..', '..');

// Load .env from the repository root when present (Node >= 20.12).
const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_PATH: z.string().default(path.join(ROOT_DIR, 'data', 'corridor.db')),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  ALLOW_SIGNUP: bool.default('true'),
  SEED_ADMIN_USERNAME: z.string().min(3).default('admin'),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  SIM_SEED: z.coerce.number().int().default(20260),
  CORS_ORIGIN: z.string().optional(),
  WEB_DIST: z.string().default(path.join(ROOT_DIR, 'apps', 'web', 'dist')),
  /** Serve the built web client from the API (single-origin deployment). */
  SERVE_WEB: bool.default('true'),
  /** Mark the session cookie `Secure`; enable whenever the app is served over HTTPS. */
  COOKIE_SECURE: bool.optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === 'production';
