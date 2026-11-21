<div align="center">

# Corridor

### AI-Powered Predictive Emergency Corridor & Multi-Vehicle Coordination System

**Smart India Hackathon 2026 · Problem Statement SIH26205 · Team Vision**

![Node](https://img.shields.io/badge/node-%E2%89%A522.13-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

Corridor clears the road **before** an emergency vehicle gets there. It detects and verifies emergencies, predicts congestion and ETA, pre-clears signal queues, runs a green wave along the route, restores normal signal cycles afterwards, and coordinates ambulances, fire engines, police and hospitals from one live command screen.

> **About the data.** The road network, traffic, cameras and vehicles come from a deterministic city simulation. Everything that makes decisions (routing, forecasting, priority arbitration, signal pre-emption, dispatch, hospital alerts) is real code running against it, behind interfaces that live feeds can replace.

## Highlights

- **Predictive routing.** Time-dependent Dijkstra prices every road at its _forecast_ congestion for the moment the vehicle will reach it.
- **Green wave.** Signals ahead of an emergency vehicle flush their queues (pre-clear), turn green in sequence, then return to their normal cycle (restore).
- **Priority arbitration.** When several vehicles want the same junction, `P = 0.5·S + 0.3·(1/ETA) + 0.2·W` decides who gets the green.
- **Multi-agency dispatch.** Each incident type gets its unit mix; when units run short, the most severe incident is served first.
- **Hospital readiness.** The best hospital is chosen by ETA, specialty and free beds; it receives a pre-arrival alert, a bed reservation and a live ETA.
- **Automatic rerouting** around blocked roads, and **vehicle authentication** that rejects spoofed beacons.
- **Measured impact.** A reproducible A/B benchmark runs the same city with the corridor on and off.

## Screens

| Screen                | What it shows                                                                 |
| --------------------- | ----------------------------------------------------------------------------- |
| **Overview**          | Live KPIs, active incidents, city map and recent alerts                       |
| **Dispatch · 112**    | Call intake, AI unit and hospital recommendations, one-click dispatch         |
| **Live Corridor**     | Animated city map with routes, signal states, units and an incident inspector |
| **Traffic & Signals** | Congestion hotspots, 30-minute forecasts, signal overrides and road closures  |
| **Hospitals**         | Bed capacity, diversion status and incoming patients with live ETAs           |
| **Fleet**             | Every unit's status, position and assignment                                  |
| **AI Engine**         | Camera/ANPR detections, verification and priority scoring in action           |
| **Impact Analytics**  | Response-time KPIs and the corridor on/off benchmark                          |
| **Audit Trail**       | Every operator command and automated decision                                 |
| **Settings**          | Account, team roles and simulation controls                                   |

## Tech stack

| Layer    | Technology                                                                     |
| -------- | ------------------------------------------------------------------------------ |
| Frontend | React 19, Vite 7, TanStack Query, wouter, Tailwind CSS 4, Recharts, Lucide     |
| Backend  | Node.js, Express 5, zod, pino, Server-Sent Events                              |
| Storage  | SQLite through Node's built-in `node:sqlite` (no native build, no DB server)   |
| Tooling  | pnpm workspaces, TypeScript 5.9 (strict), Vitest, Supertest, esbuild, Prettier |

## Getting started

**Requirements:** Node.js 22.13 or newer (Node 24 recommended) and pnpm, which ships with Node through Corepack.

```bash
corepack enable           # puts pnpm on your PATH
pnpm install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
pnpm dev
```

Then open **http://localhost:5173**. The API runs on http://localhost:8080 and Vite proxies `/api` to it.

**First sign-in.** On first start, if the database has no users, the server creates an administrator from `SEED_ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD` in `.env`. Those values are for local development only; change them before sharing the app. If no seed password is set, the first account created on the sign-up screen becomes the administrator.

### Production

```bash
pnpm build
NODE_ENV=production pnpm start
```

`pnpm start` runs the bundled API, which also serves the built web client, so the whole app runs on one origin and port (`PORT`, default 8080). Serve it over HTTPS: the session cookie is marked `Secure` in production.

## Scripts

| Command                         | What it does                                              |
| ------------------------------- | --------------------------------------------------------- |
| `pnpm dev`                      | Start the API (tsx watch) and the web app (Vite) together |
| `pnpm dev:api` / `pnpm dev:web` | Start one side only                                       |
| `pnpm build`                    | Bundle the web app (Vite) and the API (esbuild)           |
| `pnpm start`                    | Run the production build                                  |
| `pnpm test`                     | Run the Vitest suites for the engine and the HTTP API     |
| `pnpm typecheck`                | Type-check every package                                  |
| `pnpm format`                   | Format the codebase with Prettier                         |
| `pnpm check`                    | Formatting check, type-check and tests: what CI runs      |

## Configuration

All variables are optional; see [`.env.example`](.env.example). One `.env` at the repository root configures both apps.

| Variable                                      | Default                          | Purpose                                                       |
| --------------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `PORT`                                        | `8080`                           | API port                                                      |
| `DATABASE_PATH`                               | `./data/corridor.db`             | SQLite file, created automatically                            |
| `SESSION_TTL_HOURS`                           | `12`                             | Session lifetime                                              |
| `ALLOW_SIGNUP`                                | `true`                           | Allow self-registration (new users get the `dispatcher` role) |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | `admin` / none                   | Administrator created on first run                            |
| `SIM_SEED`                                    | `20260`                          | Simulation seed; the same seed gives the same city            |
| `CORS_ORIGIN`                                 | none                             | Comma-separated origins, only if the client is hosted apart   |
| `SERVE_WEB`                                   | `true`                           | Serve the built client from the API                           |
| `COOKIE_SECURE`                               | `true` in production             | `Secure` flag on the session cookie                           |
| `WEB_PORT` / `API_PROXY_TARGET`               | `5173` / `http://localhost:8080` | Vite dev server port and API proxy target                     |

## Project structure

```text
.
├── apps/
│   ├── api/                 Express API and simulation engine
│   │   ├── src/
│   │   │   ├── engine/      city network, traffic forecaster, routing, signal control, benchmark (pure logic)
│   │   │   ├── services/    corridor clock and persistence, auth, realtime (SSE)
│   │   │   ├── http/        routes and middleware
│   │   │   └── db/          node:sqlite migrations and repositories
│   │   └── test/            Vitest suites
│   └── web/                 React command-centre client
│       └── src/
│           ├── pages/       one file per screen
│           ├── components/  live city map, layout, alerts, shared UI
│           ├── lib/         API client, auth context, live SSE store
│           └── styles/
├── packages/
│   └── core/                shared types, zod schemas, priority formula, formatters
└── docs/                    architecture, API reference, original problem brief
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md): design decisions, the proposal-to-code feature map, how the engine decides, and security.
- [API reference](docs/API.md): every endpoint, roles and permissions, error format and examples.
- [Problem brief](docs/SIH26205-problem-brief.pdf): the original SIH 2026 proposal.
- [Contributing](CONTRIBUTING.md): workflow, code style and commit conventions.

## Testing

```bash
pnpm test
```

The suites cover the priority formula, routing (blocked roads, corridor vs baseline ETA), the engine end to end (full incident lifecycle to hospital handover, multi-agency dispatch, green-wave pre-emption and restore, arbitration by priority, rerouting, deterministic checkpoint and restore) and the HTTP API on an in-memory database (auth, roles, cookie flags, validation, dispatch, permissions, audit).

## Results and limitations

- **Measured impact.** The built-in benchmark (3 simulated hours, same seed, corridor on vs off) shows about **28% faster** emergency response. That is below the 35–45% target in the proposal, and the Analytics screen reports both figures side by side.
- **Simulation, not field data.** Traffic, detections and vehicle movement are synthetic, so the KPIs validate the control logic rather than real-world performance.
- **Swappable models.** A trained LSTM/GNN forecaster can replace `TrafficModel.forecast()`, and real YOLO/ANPR events can feed the detection stream.
- **Single process.** A city-wide deployment would partition the engine by zone behind a message bus; see [Architecture](docs/ARCHITECTURE.md#scaling-beyond-the-prototype).

## License

[MIT](LICENSE) © Team Vision
