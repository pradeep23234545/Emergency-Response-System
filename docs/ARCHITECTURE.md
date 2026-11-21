# Architecture

This document explains how the system is put together and how the corridor engine makes its decisions. For setup instructions see the [README](../README.md); for endpoints see [API.md](API.md).

## Overview

```text
┌──────────────────────────── Browser (React 19 + Vite) ────────────────────────────┐
│  Overview · Dispatch · Live Corridor · Traffic · Hospitals · Fleet · AI Engine ·   │
│  Analytics · Audit · Settings        TanStack Query (REST)   EventSource (SSE)     │
└───────────────────────────────▲───────────────────────────────▲────────────────────┘
                    JSON commands │               live snapshots │ alerts │ audit
┌─────────────────────────────────┴───────────────────────────────┴───────────────────┐
│ Express 5 API  (apps/api)                                                            │
│  http/      routes, zod validation, auth & RBAC middleware, error mapping            │
│  services/  CorridorService (clock, checkpoints, fan-out) · AuthService · RealtimeHub│
│  engine/    Engine ── network · traffic forecaster · time-dependent Dijkstra ·       │
│             signal controller · dispatch · hospitals · benchmark   (pure, no I/O)    │
│  db/        node:sqlite + migrations · repositories                                  │
└──────────────────────────────────────────┬──────────────────────────────────────────┘
                                           │
                    SQLite (data/corridor.db): users, sessions, incidents,
                    outcomes, audit_log, kv (engine checkpoint, benchmark)

packages/core   shared domain types, zod request schemas, priority formula, formatters
```

## Design decisions

- **The server is authoritative.** One engine instance owns the city state, so every operator sees the same picture. Clients send commands over REST and receive a snapshot every simulated tick over **Server-Sent Events**, a one-way push that reconnects by itself and carries the session cookie.
- **The engine is pure.** `engine/` does no I/O. It emits domain events (`audit`, `incident`, `outcome`, `alert`) that the service layer persists and broadcasts. This keeps it unit-testable and lets the benchmark run two headless copies side by side.
- **Deterministic.** Seeded PRNG streams (traffic, calls, misc) make every run reproducible. The A/B benchmark relies on this: both runs see identical traffic and identical 112 calls.
- **Zero-ops persistence.** Node's built-in `node:sqlite` needs no native build and no database server. State is checkpointed every 15 s and on shutdown, then restored on start.
- **One shared contract.** The API and the web client import the same TypeScript types and zod schemas from `@corridor/core`, so each validation rule exists in exactly one place.

## Feature map (proposal → code)

| Proposal (Team Vision deck)                                                      | Implementation                                                                                                                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data inputs:** CCTV/ANPR, GPS & IoT, 112 ERSS calls                            | `engine.ts` detection stream (camera reads at junctions), GPS-authenticated dispatch, 112 call generator and manual intake. UI: **AI Engine**, **Dispatch** |
| **Detect** (vision)                                                              | Camera detections with confidence and latency, collision detection from CCTV, misreads cross-checked against GPS                                            |
| **Predict** (traffic forecasting)                                                | `traffic.ts`: Holt smoothing + time-of-day prior, 30-minute horizon with an uncertainty band. UI: **Traffic & Signals**                                     |
| **Prioritise**: `P = 0.5·S + 0.3·(1/ETA) + 0.2·W`                                | `packages/core/src/priority.ts`, shared by server and UI; arbitrates junctions that several vehicles want at once                                           |
| **Lifecycle:** Detect → Verify → Predict ETA → Pre-clear → Green Wave → Restore  | Tracked per incident (`incident.stage`) and drawn as a progress tracker                                                                                     |
| **Green-wave signals**                                                           | Signal controller: pre-clear at ≤ 90 s ETA, corridor green at ≤ 25 s, 20 s restore phase, then the normal cycle                                             |
| **Driver & public alerts**                                                       | V2X / VMS / navigation-app yield alerts with an estimated number of drivers reached                                                                         |
| **Hospital ETA alerts**                                                          | Hospital chosen by ETA, specialty and free beds; pre-arrival notice, automatic bed reservation, live ETA, acknowledgement and handover                      |
| **Multi-vehicle coordination**                                                   | Multi-agency dispatch per incident type, priority queue when units run short, re-tasking of returning units, junction conflict arbitration                  |
| **Accident blockage → automatic rerouting**                                      | Any road can be marked blocked; affected routes are re-planned at once, and all routes are re-optimised every 15 s as the forecast changes                  |
| **Vehicle authentication** (Verify)                                              | Fleet registry plus signed-GPS check before a vehicle may pre-empt signals; spoofed beacons are rejected and logged                                         |
| **Impact:** faster response, < 200 ms detection, 90%+ accuracy, ~20% less idling | **Impact Analytics** measures each one live, and a reproducible **A/B benchmark** runs the same city with the corridor on and off                           |

## How the engine works

**City model.** A 6 × 4 arterial grid with two diagonal link roads, about 8 × 5 km. It has 24 junctions (20 signalised, most with cameras), 4 hospitals, 3 fire stations, 4 police posts and an ambulance base. The fleet is 6 ambulances, 4 fire engines and 4 police patrols.

**Traffic.** Each road's congestion (0–1) combines a base load, a two-peak daily demand curve, AR(1) noise and local disturbances from incidents. Blocked roads are fully congested and impassable.

**Forecasting (Predict).** Holt's linear smoothing on one-minute samples, blended with the daily prior as the horizon grows, with a residual-based confidence band. `TrafficModel.forecast()` is model-agnostic on purpose, so a trained LSTM or GNN can replace it without touching the rest of the engine.

**Routing.** Time-dependent Dijkstra. With the corridor, each road is priced at the forecast congestion for the moment the vehicle is expected to reach it, and signals add no delay because they are pre-empted. Without it, current congestion plus the expected signal wait is used. The _baseline_ ETA shown in the UI is the same path priced without the corridor.

**Signal controller (Pre-clear → Green Wave → Restore).** Every tick, each verified emergency vehicle claims the signals within 90 s of travel ahead. A junction with several claims gives green to the claimant with the highest **P**:

- `S` is severity normalised to 0–1.
- `1/ETA` is measured against a 10 s horizon and clamped to 0–1.
- `W` is accumulated waiting time, saturating at 120 s.

A vehicle already committed to a junction keeps it, so priorities do not flap. Signals are in _pre-clear_ between 90 s and 25 s ETA (queues are flushed) and in _green wave_ below 25 s. Once the vehicle has passed, the signal serves the held cross traffic for 20 s and then returns to its normal cycle. Without the corridor, vehicles wait for green and only creep through on red after 18 s.

**Incident flow.** 112 call → verification (a few seconds; camera-detected incidents are verified instantly) → AI dispatch of the unit mix the incident type needs, ranked by predicted ETA, serving the most severe incident first when units are short → hospital pre-alert and bed reservation → on scene → transport with a corridor → handover → units return to base.

**Benchmark.** `POST /api/analytics/benchmark` runs 3 simulated hours twice with the same seed, once with the corridor and once without, and reports average response time, stop time and a breakdown by incident type. Only incident types completed in both runs are compared.

## Security

- Passwords are hashed with scrypt (random salt, timing-safe compare).
- Sessions are random 256-bit tokens, stored server-side only as SHA-256 hashes and sent in an `HttpOnly; SameSite=Lax` cookie with an expiry. The cookie is `Secure` in production.
- Login attempts are rate-limited per IP and username. Unknown usernames pay the same hashing cost, so response timing does not reveal which accounts exist.
- Role-based access control is enforced on the server, not only hidden in the UI.
- State-changing requests must be JSON (`415` otherwise), which blocks simple cross-site form posts. Bodies are size-limited, and security headers (`nosniff`, `DENY` framing, referrer policy) are set on every response.
- Every command and every automated decision is written to the audit log.

## Scaling beyond the prototype

The engine runs in a single process. A city-wide deployment would partition the network by zone, run one engine per zone, and replace in-process events with a message bus such as NATS or Kafka. Real feeds plug in through adapters: SUMO/TraCI for calibration, NTCIP/UTMC signal controllers, the 112 ERSS CAD API, hospital HMIS and V2X roadside units.
