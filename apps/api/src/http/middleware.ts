import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { can, type Permission, type PublicUser } from '@corridor/core';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { DomainError } from '../engine/errors';
import type { AuthService } from '../services/auth';

export const SESSION_COOKIE = 'ecs_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
      sessionToken?: string;
    }
  }
}

/** Resolve the session cookie (or `Authorization: Bearer`) into `req.user`. */
export function sessionMiddleware(auth: AuthService): RequestHandler {
  return (req, _res, next) => {
    const header = req.get('authorization');
    const token =
      (req.cookies?.[SESSION_COOKIE] as string | undefined) ??
      (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    const user = auth.authenticate(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized', message: 'Sign in required' });
    return;
  }
  next();
};

export function requirePermission(permission: Permission): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized', message: 'Sign in required' });
      return;
    }
    if (!can(req.user.role, permission)) {
      res.status(403).json({ error: 'forbidden', message: `Your role (${req.user.role}) cannot perform this action` });
      return;
    }
    next();
  };
}

/** Parse and validate `req.body` with a zod schema. */
export function body<S extends ZodTypeAny>(schema: S, req: Request): z.output<S> {
  return schema.parse(req.body ?? {});
}

/** Wrap an async/sync handler so thrown errors reach the error middleware. */
export const handle =
  (fn: (req: Request, res: Response) => unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };

export const actor = (req: Request) => req.user?.username ?? 'anonymous';

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
export const requireJson: RequestHandler = (req, res, next) => {
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && hasBody && !req.is('application/json')) {
    res.status(415).json({ error: 'unsupported_media_type', message: 'Use application/json' });
    return;
  }
  next();
};

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'validation_error',
      message: err.issues[0]?.message ?? 'Invalid request',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof DomainError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json', message: 'Malformed JSON body' });
    return;
  }
  req.log?.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong' });
}
