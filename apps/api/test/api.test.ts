import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app';
import { openDatabase } from '../src/db/database';
import { createRepositories } from '../src/db/repositories';
import { AuthService } from '../src/services/auth';
import { CorridorService } from '../src/services/corridor';
import { RealtimeHub } from '../src/services/realtime';

const logger = pino({ level: 'silent' });
const db = openDatabase(':memory:');
const repos = createRepositories(db);
const hub = new RealtimeHub();
const corridor = new CorridorService(repos, hub, logger, 3);
corridor.engine.updateSettings({ autoIncidents: false, autoDispatch: false });
const app = createApp({
  repos,
  auth: new AuthService(repos, 3600_000),
  corridor,
  hub,
  logger,
  allowSignup: true,
  secureCookies: false,
});

const admin = request.agent(app);
const dispatcher = request.agent(app);

beforeAll(async () => {
  await admin
    .post('/api/auth/register')
    .send({ username: 'chief', name: 'Chief Controller', password: 'Secret123', zone: 'City' })
    .expect(201);
  await admin.post('/api/auth/login').send({ username: 'chief', password: 'Secret123' }).expect(200);
  await dispatcher
    .post('/api/auth/register')
    .send({ username: 'desk1', name: 'Desk One', password: 'Secret123' })
    .expect(201);
  await dispatcher.post('/api/auth/login').send({ username: 'desk1', password: 'Secret123' }).expect(200);
});

afterAll(() => {
  hub.close();
  db.close();
});

describe('auth', () => {
  it('makes the first account an administrator and later ones dispatchers', async () => {
    expect((await admin.get('/api/auth/me').expect(200)).body.user.role).toBe('admin');
    expect((await dispatcher.get('/api/auth/me').expect(200)).body.user.role).toBe('dispatcher');
  });

  it('rejects anonymous access and bad credentials', async () => {
    await request(app).get('/api/state').expect(401);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'chief', password: 'wrong-password' })
      .expect(400);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('sets an httpOnly session cookie and never returns password hashes', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'chief', password: 'Secret123' })
      .expect(200);
    expect(String(res.headers['set-cookie'])).toMatch(/ecs_session=.*HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|passwordHash/);
  });

  it('validates registration input', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'x', name: 'X', password: 'short' })
      .expect(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('logs out by revoking the session', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'desk1', password: 'Secret123' }).expect(200);
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });
});

describe('operations API', () => {
  it('serves the network and a live snapshot', async () => {
    const network = (await admin.get('/api/network').expect(200)).body;
    expect(network.nodes.length).toBeGreaterThan(20);
    const state = (await admin.get('/api/state').expect(200)).body;
    expect(state.units).toHaveLength(14);
    expect(state.traffic).toHaveLength(network.edges.length);
  });

  it('creates an incident, recommends units and dispatches', async () => {
    const created = await dispatcher
      .post('/api/incidents')
      .send({ type: 'road_accident', nodeId: 'J24', notes: 'bus vs bike' })
      .expect(201);
    const id = created.body.incident.id;
    const plan = (await dispatcher.get(`/api/incidents/${id}/recommendations`).expect(200)).body;
    expect(plan.recommendations.ambulance.length).toBeGreaterThan(0);
    expect(plan.hospital).toBeTruthy();
    const dispatched = await dispatcher.post(`/api/incidents/${id}/dispatch`).send({}).expect(200);
    expect(dispatched.body.incident.status).toBe('dispatched');
    const history = (await dispatcher.get('/api/incidents?limit=5').expect(200)).body;
    expect(history.items.some((i: { id: string }) => i.id === id)).toBe(true);
  });

  it('enforces role permissions', async () => {
    await dispatcher.patch('/api/simulation').send({ speed: 2 }).expect(403);
    await admin.patch('/api/simulation').send({ speed: 2 }).expect(200);
    await dispatcher.get('/api/users').expect(403);
    expect((await admin.get('/api/users').expect(200)).body.users).toHaveLength(2);
  });

  it('rejects unknown locations and non-JSON bodies', async () => {
    await dispatcher.post('/api/incidents').send({ type: 'fire', nodeId: 'NOPE' }).expect(400);
    await dispatcher.post('/api/incidents').set('Content-Type', 'text/plain').send('type=fire').expect(415);
  });

  it('records actions in the audit log', async () => {
    const entries = (await admin.get('/api/audit?limit=50').expect(200)).body.entries;
    expect(entries.some((e: { action: string }) => e.action === 'Units dispatched')).toBe(true);
  });

  it('manages blockages and signal overrides', async () => {
    await admin.post('/api/network/blockages').send({ edgeId: 'E-J11-J12', reason: 'Water main burst' }).expect(201);
    await admin.post('/api/network/blockages').send({ edgeId: 'E-J11-J12' }).expect(409);
    await admin.delete('/api/network/blockages/E-J11-J12').expect(200);
    const sig = await admin.post('/api/signals/SIG-J12/override').send({ mode: 'force_ns' }).expect(200);
    expect(sig.body.signal.mode).toBe('manual');
  });
});
