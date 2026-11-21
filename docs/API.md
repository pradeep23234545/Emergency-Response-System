# API reference

Base path: `/api`. In development the web client reaches it through the Vite proxy; in production the API serves the web client itself, so both share one origin.

## Conventions

- **Auth.** Every route except auth and health needs the session cookie (`ecs_session`) set by `POST /api/auth/login`.
- **Bodies.** Request bodies are JSON and validated with zod schemas from `@corridor/core`. A state-changing request without `Content-Type: application/json` gets `415`.
- **Errors.** Errors have the shape `{ "error": string, "message": string, "issues"?: [...] }`, with the usual status codes: `400` validation, `401` not signed in, `403` missing permission, `404` unknown resource, `409` conflicting state, `429` too many login attempts.

## Roles

| Role         | Can do                                                   |
| ------------ | -------------------------------------------------------- |
| `admin`      | Everything, including user management                    |
| `supervisor` | Operations plus simulation control and signal overrides  |
| `dispatcher` | Log 112 calls, dispatch and recall units, acknowledge    |
| `hospital`   | Update bed counts and diversion status, acknowledge ETAs |

The first account ever created becomes `admin`; later self-registered accounts are `dispatcher`.

## Endpoints

### Session and users

| Method & path             | Permission | Description                                  |
| ------------------------- | ---------- | -------------------------------------------- |
| `GET /api/healthz`        | —          | Liveness probe                               |
| `POST /api/auth/login`    | —          | Sign in, sets the session cookie             |
| `POST /api/auth/logout`   | —          | Sign out                                     |
| `GET /api/auth/me`        | —          | Current user, or `401`                       |
| `POST /api/auth/register` | —          | Self sign-up (when `ALLOW_SIGNUP=true`)      |
| `POST /api/auth/password` | signed in  | Change password (other sessions are revoked) |
| `GET /api/users`          | `users`    | List the team                                |
| `PATCH /api/users/:id`    | `users`    | Change a user's name, role or zone           |

### Live state

| Method & path      | Permission | Description                                          |
| ------------------ | ---------- | ---------------------------------------------------- |
| `GET /api/stream`  | signed in  | **Server-Sent Events**: `snapshot`, `alert`, `audit` |
| `GET /api/state`   | signed in  | Current snapshot                                     |
| `GET /api/network` | signed in  | Static road network (nodes, edges, facilities)       |

### Incidents and units

| Method & path                                     | Permission       | Description                                             |
| ------------------------------------------------- | ---------------- | ------------------------------------------------------- |
| `GET /api/incidents?status&type&q&limit&offset`   | signed in        | Incident history from the database                      |
| `POST /api/incidents`                             | `incident:write` | Log a 112 call (`autoDispatch` optional)                |
| `GET /api/incidents/:id`                          | signed in        | Incident details                                        |
| `GET /api/incidents/:id/recommendations`          | signed in        | AI unit and hospital recommendations                    |
| `POST /api/incidents/:id/dispatch` `{ unitIds? }` | `dispatch`       | Dispatch chosen units, or the AI plan if none are given |
| `POST /api/incidents/:id/cancel`                  | `dispatch`       | Cancel and release units and beds                       |
| `POST /api/incidents/:id/resolve`                 | `dispatch`       | Close a finished incident                               |
| `POST /api/units/:id/recall`                      | `dispatch`       | Send a unit back to base                                |

### Traffic, signals and roads

| Method & path                           | Permission        | Description                                            |
| --------------------------------------- | ----------------- | ------------------------------------------------------ |
| `POST /api/signals/:id/override`        | `signal:override` | `{ mode }`: `force_ns`, `force_ew`, `flash`, `release` |
| `GET /api/network/blockages`            | signed in         | Current road closures                                  |
| `POST /api/network/blockages`           | `network:write`   | Close a road; affected routes are re-planned           |
| `DELETE /api/network/blockages/:edgeId` | `network:write`   | Reopen a road                                          |
| `GET /api/traffic/hotspots`             | signed in         | Most congested roads, now and forecast                 |
| `GET /api/traffic/forecast/:edgeId`     | signed in         | 30-minute forecast with confidence band                |

### Hospitals and alerts

| Method & path              | Permission       | Description                                    |
| -------------------------- | ---------------- | ---------------------------------------------- |
| `PATCH /api/hospitals/:id` | `hospital:write` | Bed counts and diversion status                |
| `POST /api/alerts/:id/ack` | signed in        | Acknowledge an alert (e.g. hospital readiness) |

### Simulation, analytics and audit

| Method & path                          | Permission   | Description                           |
| -------------------------------------- | ------------ | ------------------------------------- |
| `PATCH /api/simulation`                | `simulation` | Run/pause, speed and feature toggles  |
| `POST /api/simulation/reset`           | `simulation` | Restart the city from the seed        |
| `POST /api/simulation/step`            | `simulation` | Advance one tick while paused         |
| `GET /api/analytics`                   | signed in    | KPIs and recent outcomes              |
| `POST /api/analytics/benchmark`        | `simulation` | Run the corridor on/off A/B benchmark |
| `GET /api/audit?limit&before&category` | signed in    | Audit trail, paginated                |

## Example

```bash
# sign in and keep the cookie
curl -c jar.txt -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your password>"}' \
  http://localhost:8080/api/auth/login

# log a cardiac call and let the AI dispatch it
curl -b jar.txt -H "Content-Type: application/json" \
  -d '{"type":"cardiac","severity":5,"nodeId":"J14","autoDispatch":true}' \
  http://localhost:8080/api/incidents
```
