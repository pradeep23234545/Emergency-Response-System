import { Router, type CookieOptions } from 'express';
import {
  bedUpdateSchema,
  blockageSchema,
  changePasswordSchema,
  createIncidentSchema,
  dispatchSchema,
  loginSchema,
  registerSchema,
  signalOverrideSchema,
  simulationSettingsSchema,
  updateUserSchema,
} from '@corridor/core';
import { z } from 'zod';
import { DomainError } from '../engine/errors';
import type { Repositories } from '../db/repositories';
import type { AuthService } from '../services/auth';
import type { CorridorService } from '../services/corridor';
import type { RealtimeHub } from '../services/realtime';
import { SESSION_COOKIE, actor, body, handle, requireAuth, requirePermission } from './middleware';

export interface RouteDeps {
  repos: Repositories;
  auth: AuthService;
  corridor: CorridorService;
  hub: RealtimeHub;
  allowSignup: boolean;
  secureCookies: boolean;
}

export function createRouter(deps: RouteDeps): Router {
  const { repos, auth, corridor, hub } = deps;
  const router = Router();
  const engine = () => corridor.engine;

  const cookieOptions = (expires?: Date): CookieOptions => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.secureCookies,
    path: '/',
    expires,
  });

  /* ------------------------------ health ------------------------------ */

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', simTime: engine().simTime, clients: hub.size });
  });

  /* ------------------------------- auth ------------------------------- */

  router.post(
    '/auth/login',
    handle(async (req, res) => {
      const input = body(loginSchema, req);
      const session = await auth.login(input.username, input.password, {
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      res.cookie(SESSION_COOKIE, session.token, cookieOptions(new Date(session.expiresAt)));
      corridor.record({
        at: engine().simTime,
        actor: session.user.username,
        action: 'Signed in',
        detail: `${session.user.name} (${session.user.role}) · ${session.user.zone}`,
        category: 'auth',
      });
      res.json({ user: session.user, expiresAt: session.expiresAt });
    }),
  );

  router.post(
    '/auth/register',
    handle(async (req, res) => {
      if (!deps.allowSignup && repos.users.count() > 0)
        throw new DomainError('Self sign-up is disabled; ask an administrator', 403, 'forbidden');
      const input = body(registerSchema, req);
      const user = await auth.register(input);
      corridor.record({
        at: engine().simTime,
        actor: user.username,
        action: 'Account created',
        detail: `${user.name} registered as ${user.role}`,
        category: 'auth',
      });
      res.status(201).json({ user });
    }),
  );

  router.post('/auth/logout', (req, res) => {
    auth.logout(req.sessionToken);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.status(204).end();
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  router.post(
    '/auth/password',
    requireAuth,
    handle(async (req, res) => {
      const input = body(changePasswordSchema, req);
      await auth.changePassword(req.user!.id, input.currentPassword, input.newPassword, req.sessionToken);
      corridor.record({
        at: engine().simTime,
        actor: actor(req),
        action: 'Password changed',
        detail: 'Other sessions were signed out',
        category: 'auth',
      });
      res.status(204).end();
    }),
  );

  /* ------------------------------- users ------------------------------ */

  router.get('/users', requirePermission('users'), (_req, res) => {
    res.json({ users: repos.users.list() });
  });

  router.patch(
    '/users/:id',
    requirePermission('users'),
    handle((req, res) => {
      const id = Number(req.params.id);
      const patch = body(updateUserSchema, req);
      const target = repos.users.findById(id);
      if (!target) throw new DomainError('User not found', 404, 'not_found');
      if (target.role === 'admin' && patch.role && patch.role !== 'admin' && repos.users.countAdmins() <= 1) {
        throw new DomainError('At least one administrator is required', 409, 'conflict');
      }
      const updated = repos.users.update(id, patch)!;
      corridor.record({
        at: engine().simTime,
        actor: actor(req),
        action: 'User updated',
        detail: `${updated.username}: ${JSON.stringify(patch)}`,
        category: 'auth',
      });
      const { passwordHash: _omit, ...publicUser } = updated;
      res.json({ user: publicUser });
    }),
  );

  /* ---------------------------- everything else needs a session ---------------------------- */

  router.use(requireAuth);

  router.get('/network', (_req, res) => {
    res.set('Cache-Control', 'private, max-age=3600');
    res.json(engine().network);
  });

  router.get('/state', (_req, res) => {
    res.json(engine().snapshot());
  });

  router.get('/stream', (_req, res) => {
    hub.attach(res, { event: 'snapshot', data: engine().snapshot() });
  });

  /* ----------------------------- incidents ---------------------------- */

  const incidentQuery = z.object({
    status: z.string().optional(),
    type: z.string().optional(),
    q: z.string().max(60).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  });

  router.get(
    '/incidents',
    handle((req, res) => {
      res.json(repos.incidents.search(incidentQuery.parse(req.query)));
    }),
  );

  router.get(
    '/incidents/:id',
    handle((req, res) => {
      const id = String(req.params.id);
      const live = engine()
        .snapshot()
        .incidents.find((i) => i.id === id);
      const incident = live ?? repos.incidents.find(id);
      if (!incident) throw new DomainError('Incident not found', 404, 'not_found');
      res.json({ incident });
    }),
  );

  router.post(
    '/incidents',
    requirePermission('incident:write'),
    handle((req, res) => {
      const input = body(createIncidentSchema, req);
      const incident = corridor.command((e) => e.createIncident(input, actor(req)));
      res.status(201).json({ incident });
    }),
  );

  router.get(
    '/incidents/:id/recommendations',
    handle((req, res) => {
      res.json(engine().recommend(String(req.params.id)));
    }),
  );

  router.post(
    '/incidents/:id/dispatch',
    requirePermission('dispatch'),
    handle((req, res) => {
      const input = body(dispatchSchema, req);
      const incident = corridor.command((e) => e.dispatch(String(req.params.id), input.unitIds, actor(req)));
      res.json({ incident });
    }),
  );

  router.post(
    '/incidents/:id/cancel',
    requirePermission('dispatch'),
    handle((req, res) => {
      const { reason } = body(z.object({ reason: z.string().trim().max(200).default('Cancelled by operator') }), req);
      res.json({ incident: corridor.command((e) => e.cancelIncident(String(req.params.id), actor(req), reason)) });
    }),
  );

  router.post(
    '/incidents/:id/resolve',
    requirePermission('dispatch'),
    handle((req, res) => {
      res.json({ incident: corridor.command((e) => e.resolveIncident(String(req.params.id), actor(req))) });
    }),
  );

  /* -------------------------------- units ----------------------------- */

  router.post(
    '/units/:id/recall',
    requirePermission('dispatch'),
    handle((req, res) => {
      res.json({ unit: corridor.command((e) => e.recallUnit(String(req.params.id), actor(req))) });
    }),
  );

  /* ------------------------------ signals ----------------------------- */

  router.post(
    '/signals/:id/override',
    requirePermission('signal:override'),
    handle((req, res) => {
      const { mode } = body(signalOverrideSchema, req);
      res.json({ signal: corridor.command((e) => e.overrideSignal(String(req.params.id), mode, actor(req))) });
    }),
  );

  /* ------------------------------ network ----------------------------- */

  router.get('/network/blockages', (_req, res) => {
    res.json({ blockages: engine().blockages() });
  });

  router.post(
    '/network/blockages',
    requirePermission('network:write'),
    handle((req, res) => {
      const input = body(blockageSchema, req);
      corridor.command((e) => e.blockEdge(input.edgeId, input.reason, actor(req)));
      res.status(201).json({ blockages: engine().blockages() });
    }),
  );

  router.delete(
    '/network/blockages/:edgeId',
    requirePermission('network:write'),
    handle((req, res) => {
      corridor.command((e) => e.clearBlockage(String(req.params.edgeId), actor(req)));
      res.json({ blockages: engine().blockages() });
    }),
  );

  /* ------------------------------ traffic ----------------------------- */

  router.get('/traffic/hotspots', (_req, res) => {
    res.json({ hotspots: engine().hotspots(10) });
  });

  router.get(
    '/traffic/forecast/:edgeId',
    handle((req, res) => {
      res.json(engine().forecastFor(String(req.params.edgeId)));
    }),
  );

  /* ----------------------------- hospitals ---------------------------- */

  router.patch(
    '/hospitals/:id',
    requirePermission('hospital:write'),
    handle((req, res) => {
      const input = body(bedUpdateSchema, req);
      res.json({ hospital: corridor.command((e) => e.updateBeds(String(req.params.id), input, actor(req))) });
    }),
  );

  router.post(
    '/alerts/:id/ack',
    handle((req, res) => {
      res.json({ alert: corridor.command((e) => e.acknowledgeAlert(String(req.params.id), actor(req))) });
    }),
  );

  /* ---------------------------- simulation ---------------------------- */

  router.patch(
    '/simulation',
    requirePermission('simulation'),
    handle((req, res) => {
      const patch = body(simulationSettingsSchema, req);
      res.json({ settings: corridor.command((e) => e.updateSettings(patch, actor(req))) });
    }),
  );

  router.post(
    '/simulation/reset',
    requirePermission('simulation'),
    handle((req, res) => {
      corridor.reset(actor(req));
      res.json({ ok: true });
    }),
  );

  router.post(
    '/simulation/step',
    requirePermission('simulation'),
    handle((req, res) => {
      const { seconds } = body(z.object({ seconds: z.number().int().min(1).max(600).default(30) }), req);
      corridor.command((e) => {
        for (let i = 0; i < seconds; i++) e.stepOnce();
      });
      res.json({ simTime: engine().simTime });
    }),
  );

  /* ---------------------------- analytics ----------------------------- */

  router.get('/analytics', (_req, res) => {
    const e = engine();
    res.json({ metrics: e.metrics(), outcomes: e.outcomes.slice(-120), benchmark: corridor.lastBenchmark() });
  });

  router.post(
    '/analytics/benchmark',
    requirePermission('simulation'),
    handle((req, res) => {
      const result = corridor.benchmark();
      corridor.record({
        at: engine().simTime,
        actor: actor(req),
        action: 'Benchmark run',
        detail: `${result.incidents} incidents over ${result.simulatedSeconds / 3600} h · ${result.improvementPct}% faster with corridor`,
        category: 'system',
      });
      res.json({ benchmark: result });
    }),
  );

  /* ------------------------------- audit ------------------------------ */

  const auditQuery = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.coerce.number().int().positive().optional(),
    category: z.string().optional(),
  });

  router.get(
    '/audit',
    handle((req, res) => {
      res.json({ entries: repos.audit.list(auditQuery.parse(req.query)) });
    }),
  );

  return router;
}
