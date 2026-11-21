# Contributing

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev
```

See the [README](README.md) for requirements and configuration.

## Workflow

1. Branch from `main` (`feature/...`, `fix/...`, `docs/...`).
2. Keep changes focused; put shared types and validation in `packages/core` rather than duplicating them.
3. Before pushing, run:

   ```bash
   pnpm format
   pnpm check
   ```

   `pnpm check` runs the Prettier check, the type-check and the tests, the same as CI.

4. Open a pull request describing what changed and how you tested it.

## Where things go

| Change                                  | Location                           |
| --------------------------------------- | ---------------------------------- |
| Domain types, request schemas, formulas | `packages/core/src`                |
| Simulation and decision logic (no I/O)  | `apps/api/src/engine`              |
| Persistence, clock, broadcasting, auth  | `apps/api/src/services`, `db`      |
| HTTP endpoints and middleware           | `apps/api/src/http`                |
| Screens and UI components               | `apps/web/src/pages`, `components` |

Engine code stays pure: it emits events and the service layer persists and broadcasts them. New engine behaviour needs a test in `apps/api/test`.

## Code style

- TypeScript in strict mode; avoid `any`.
- Prettier formats everything (single quotes, 120 columns). Run `pnpm format` rather than formatting by hand.
- Validate every request body with a zod schema from `@corridor/core`.
- Commit messages use the imperative mood, for example `Add hospital diversion alert`.
