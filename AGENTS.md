# AGENTS.md — VisionPharma

Instructions for AI coding agents (Qoder, and any AGENTS.md-compatible harness). Human docs live in `docs/`. Keep this file short; link, don't copy.

## Mission right now

Build **VisionPharma Officine** (`apps/officine/`): a real, production-grade, offline-first pharmacy management system that runs on a local server inside one pharmacy. Workstations on the LAN use a **Tauri 2 desktop app** that shows the UI served by the paired server (browser as fallback). No cloud, no external integrations yet.

- **Spec (source of truth):** `docs/05-mvp-officine-spec.md`. Every requirement has an ID (`S-02`, `V-07`…). Build only what is there.
- **Security design:** `docs/06-architecture-securite.md`. Hash-chained ledger, keys, backups.
- **Acceptance:** `docs/08-tests-et-recette.md`.
- **Plan:** `docs/07-plan-14-jours.md`. Work in that order.
- **Hard rules:** `GUARDRAILS.md`. Read it once per session. Non-negotiable.

**Phase B (only after every officine item in `docs/PROGRESS.md` is done or waiting-human):** central server and back-office (`apps/cloud/`, `apps/backoffice/`, `deploy/cloud/`), per ADR-012 and `docs/10-cloud-spec.md` (written by the agent at the start of phase B). Patient channels, payments, Connect, Observatoire, AI: still out of scope.

## Stack (fixed; changing it needs an ADR in `annexes/H-adr.md`)

TypeScript 5 strict · Node.js 24 LTS · Fastify 5 + TypeBox schemas · SQLite via better-sqlite3 (WAL, `synchronous=FULL`, `BEGIN IMMEDIATE` for writes) · React 19 + Vite + Tailwind CSS v4 + shadcn/ui · Tauri 2 desktop shell (Rust) · `node:crypto` only · Vitest + Playwright · ESLint + Prettier · cargo clippy + cargo audit for the desktop app.

Server production dependencies allowed: `fastify`, `@fastify/static`, `@fastify/cookie`, `@sinclair/typebox`, `better-sqlite3`.
Web UI dependencies allowed (bundled, never loaded from the internet): `react`, `react-dom`, `tailwindcss`, shadcn/ui components and `@radix-ui/*`, `cmdk`, `react-resizable-panels`, `motion`, `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `react-hook-form`, `zod`, `lucide-react`, `sonner`, `recharts`, local Inter or Geist font files.
Desktop (Rust) dependencies allowed: `tauri` 2, `tauri-plugin-updater`, `tauri-plugin-single-instance`, `tauri-plugin-window-state`, `rustls`, one ESC/POS crate. Tauri `shell`, `fs` and `http` plugins are forbidden.
Anything else: ask first.

## Layout

```
apps/officine/server/src/{config,app,main}.ts
apps/officine/server/src/db/            # open, pragmas, migrations/NNN_*.sql
apps/officine/server/src/domain/        # ALL business rules; no HTTP here
apps/officine/server/src/security/      # passwords, totp, sessions, rbac, crypto
apps/officine/server/src/http/          # routes: schema + permission + domain call only
apps/officine/server/src/jobs/          # backup, checkpoints, retention
apps/officine/server/test/
apps/officine/web/src/                  # React UI; components/ui = shadcn/ui; styles/tokens.css = design tokens
apps/officine/desktop/src-tauri/        # Tauri 2: pairing, cert pinning, ESC/POS printing, signed updates
apps/officine/scripts/                  # init, import-catalog, backup, restore, verify-ledger
annexes/B-modele-donnees.md             # reference schema
annexes/C-evenements.md                 # event types + ledger test vectors
annexes/D-api-officine.md               # routes
```

## Commands (from `apps/officine/`)

```
npm ci
npm run typecheck      # tsc --noEmit
npm run lint
npm test               # vitest
npm run test:e2e       # playwright
npm run build
npm run desktop:dev    # tauri dev, pointing at a local server
npm run desktop:build  # signed installers (CI only; signing keys live in CI secrets)
npm run init -- --data ./data-local
npm start
npm run verify-ledger
```

Before you say a task is done: `typecheck`, `lint` and `test` all pass, and the requirement's test exists.

## How to work

1. Pick the next requirement IDs from the plan. Read their rows in the spec.
2. **Domain first:** write the test named after the ID, then the domain function, then the route, then the UI.
3. Every business write = one `BEGIN IMMEDIATE` transaction that changes tables **and** appends the ledger event. Never one without the other.
4. Small, focused commits: `feat(stock): S-02 FEFO allocation`. One requirement group per PR.
5. If the spec is ambiguous, pick the safer reading, note it in the PR under "Assumptions", and continue. Stop and ask only for the cases listed in `GUARDRAILS.md`.
6. Update `apps/officine/README.md` or `annexes/D-api-officine.md` when behaviour or routes change.

## Conventions

- Money: integer XAF. Never floats.
- Time: ISO 8601 UTC in storage; display in Africa/Douala. Inject the clock (`now()`) into the domain for tests.
- IDs: UUID v4 for entities and events; human numbers (`V-2026-000123`) from a transactional counter.
- Errors: RFC 9457 problem+json with a stable `code` (`recalled_lot`, `rx_required`, `insufficient_stock`, `reauth_required`…).
- Every route declares a permission from the matrix in spec §6. A route without one must fail at startup.
- UI text in French, externalized. Cashier screen fully keyboard-driven. Follow the design system in spec §8.1 (dark default, one accent colour, Ctrl/⌘K palette, thin icon sidebar, resizable panels).
- Desktop app: it loads only the paired server origin and exposes exactly three native commands (spec §8 bis, W-05). Never add a capability or plugin beyond that list.
- No `any` in domain code. No function over 60 lines in `domain/`.

## Definition of done (per requirement)

Merged via reviewed PR · test with the requirement ID passes in CI · typecheck/lint/audit green · keyboard-usable UI · docs updated.
