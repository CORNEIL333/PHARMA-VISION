<!-- VisionPharma · documentation projet · v3.2 · 2026-10-26 -->

# Prompt Qoder — finir le gestionnaire, puis construire le serveur central

Un seul prompt, deux phases enchaînées sans intervention :

- **Phase A** : finir le gestionnaire d'officine (serveur local, interface, tous les écrans, application de bureau Tauri). Le socle et les jours J1–J2 sont déjà construits et testés (166 tests verts) : Qoder reprend à **J3** d'après `docs/PROGRESS.md`.
- **Phase B** : dès que la phase A est terminée, construire le côté serveur (le cloud L1) : enrôlement des officines, synchronisation, référentiel, rappels prioritaires, disponibilité consolidée, journal de transparence, back-office, sauvegarde et bascule. Les choix sont fixés par l'ADR-012.

## Avant de lancer

1. Ouvrir le dossier `visionpharma` dans Qoder en **espace de travail de confiance**.
2. Dans les réglages de Qoder, autoriser l'exécution automatique des commandes du terminal pour ce dossier.
3. Installer : Node.js 24 LTS, Git, Rust stable et les prérequis Tauri 2 (WebView2 sous Windows), **Docker Desktop** (indispensable en phase B pour PostgreSQL, Keycloak et les tests de bascule).
4. Lancer une **Quest** et coller le prompt ci-dessous.

Si la session s'arrête (limite de contexte ou de crédits), coller la phrase de relance en bas de page dans une nouvelle session.

---

## Prompt

```text
You are the autonomous build agent for VisionPharma, a real production system for pharmacies in Cameroon. AUTONOMOUS MODE: no human will answer until both phases below are finished. Never ask a question, never wait for confirmation. Keep looping until the exit condition of phase B (section B6) is met.

# 0. Every session starts here
1. Read AGENTS.md, GUARDRAILS.md (sections 1 to 5 bis), docs/PROGRESS.md, docs/QUESTIONS.md, docs/BLOCKERS.md.
2. If the folder is not a Git repository: git init, commit everything as "chore: socle J1-J2 (I, A, U, J)".
3. Run the full check of the current phase. If anything is red, fix it first, never by weakening a test.
4. Decide the phase: if docs/PROGRESS.md has any phase A row (requirement IDs of docs/05, UI-*, DW-*, RC-*) in status todo, doing or blocked-not-yet-retried, you are in PHASE A. Otherwise you are in PHASE B. Phase B never starts before phase A is complete.

# PHASE A — finish the pharmacy manager (apps/officine)

A1. Sources of truth: docs/05-mvp-officine-spec.md (requirements, design system §8.1, desktop app §8 bis), docs/06, docs/08, docs/07 (order of work), annexes B, C, D, H, I, I2. The existing code is the reference for conventions: writeTx() for every write, ledger.append() in the same transaction, payload.movements for every stock event, config.permission on every route, AppError codes added to annexes/D, test helpers in server/test/helpers.ts. Read apps/officine/README.md and docs/reports/J1-J2.md before writing code.

A2. Loop, starting at plan day J3 (I-04, C-01..C-06), until every phase A row is done or waiting-human:
  1. Take the first todo row in plan order; mark it doing.
  2. Failing test first, named with the ID.
  3. Domain function (pure, injected clock, typed errors) → one BEGIN IMMEDIATE transaction writing tables AND the ledger event → route with TypeBox schemas in and out and its permission → screen if user-facing, with a Playwright test.
  4. Full check A (below) green. Commit with Conventional Commits and the IDs. Never push to a remote main branch.
  5. Update PROGRESS.md after EVERY item (it is your memory). Write docs/reports/JX.md at the end of each plan day, then continue.

A3. Screens: build all UI-01..UI-16 in apps/officine/web (React 19, Vite, Tailwind CSS v4, shadcn/ui, design system of spec §8.1: dark default + light, one accent colour, thin icon sidebar, resizable panels, Ctrl/Cmd+K palette filtered by role, sonner toasts, keyboard shortcuts with "?" help, explicit loading/empty/error/offline states). Build DW-01..DW-06 and W-01..W-11 in apps/officine/desktop (Tauri 2): pairing with an 8-digit code and device secret, CA pinning checked in Rust before the window opens, only the paired origin, exactly three native commands (print_receipt, open_cash_drawer, device_info), Ed25519-signed updates served by the local server, no shell/fs/http plugins. A screen is done when it works against the real API, respects the role matrix, has tests, passes axe with no serious violation, and has dark and light screenshots in docs/screenshots/.

A4. Full check A:
  cd apps/officine && npm run typecheck && npm run lint && npm test && npm run test:e2e
  cd apps/officine/desktop/src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
  Once per plan day: npm audit --audit-level=high, cargo audit, CycloneDX SBOM, npm run verify-ledger on the demo database, Tauri capability test.

A5. End of phase A: run the self-review of PROMPT-AUTONOME-QODER.md section 7, fix everything blocking or important, retry every blocked item once, write docs/reports/PHASE-A.md in French (built IDs, what waits for a human and why, assumptions, risks, install and verify commands). Commit "chore: fin de la phase A". Then go straight to phase B without stopping.

# PHASE B — central server and back-office (apps/cloud, apps/backoffice, deploy/cloud)

B1. Write the spec first. Read annexes/H-adr.md ADR-012 (it fixes the stack and scope), docs/02 sections 14, 15, 17 and 22, docs/04 FR-CORE-01..06 and FR-CORE-08 plus NFR and SEC rows, docs/06 section 7, docs/03 section 26 (criticity routing). Then write docs/10-cloud-spec.md in the same format as docs/05 (requirements table: ID, priority M/S/C, requirement, acceptance criteria as automated tests). Use these groups and nothing else:
  - CL: enrolment of a pharmacy node (one-time token issued in the back-office, registration of the node Ed25519 public key and kid, revocation), pharmacy directory (licence, location, hours, duty rota).
  - SY: sync gateway. Batches of events from apps/officine outbox (the existing events table, synced_at IS NULL), each batch carries a signed checkpoint; the cloud verifies chain continuity per node, hashes and signature, deduplicates by event id, acknowledges by id; idempotent replays; never rewrites a node's history; a broken chain is quarantined and alerted, not merged.
  - RF: versioned medicine referential, differential updates pulled by nodes, applied in order.
  - RA: recalls, top priority downstream channel, blocking on the node as soon as received (target under 5 minutes when online), acknowledgement of blocking tracked per pharmacy.
  - DI: consolidated availability per product and pharmacy, derived from events, with freshness thresholds 1 h and 24 h (docs/02 §15.3).
  - TL: transparency log, RFC 9162 Merkle tree of node checkpoints, signed tree heads, inclusion and consistency proofs, and a standalone verifier script.
  - CR: unmet-demand routing by criticity (docs/03 §26), priority S.
  - BO: back-office for the VisionPharma team (React + same design system): network (nodes, versions, last sync, silent nodes), referential publishing, recall broadcast and ack tracking, enrolment tokens, audit log viewer. Login via Keycloak OIDC with mandatory MFA; least privilege roles (admin, referential, support, read-only); every access to nominative data justified and logged.
  - OP: operations. docker compose in deploy/cloud with PostgreSQL 17 primary + streaming replica, Keycloak, cloud API, back-office; pgBackRest daily full + continuous WAL archiving to an AES-256 encrypted repository plus an off-site copy; scripts/restore-test and scripts/failover-test that measure RPO (target 15 min) and RTO (target 4 h) and write the measures to a report; TLS everywhere including between services; health and Prometheus metrics endpoints; structured logs without secrets or health data.
  Also add to docs/10 a section "Côté nœud" with the officine changes: implementations of SyncTransport, RemoteCatalog and RecallFeed; setting cloud_sync_enabled (default false, titulaire only, re-auth), cloud URL and pinned certificate fingerprint; sync status in the Système screen; this is the ONLY outbound network call allowed (GUARDRAILS 18, ADR-012).
  Out of scope, do not build: patient app, WhatsApp, USSD, payments, Connect partner portal, Observatoire, AI features, dispensary.
  Then add every new ID to docs/PROGRESS.md under a "Phase B" heading, plus rows BUI-xx for each back-office screen and RB-01..RB-10 acceptance scenarios that you define in docs/10 (end-to-end: enrol a node, sync 10 000 events with network cuts, replay a batch, tampered batch rejected, recall reaches a node and blocks the sale, availability freshness, inclusion proof verified by the standalone script, primary database killed then replica promoted, restore from backup on an empty host, back-office login refused without MFA). Commit "docs: spécification de la phase B".

B2. Layout: apps/cloud (server: src/domain, src/http, src/db/migrations/NNN_*.sql for PostgreSQL, src/jobs, test), apps/backoffice (web), deploy/cloud (compose files, Keycloak realm export without secrets, pgBackRest config, runbooks in French), shared code only through a small packages/protocol (event envelope, JCS, hash, checkpoint message, batch schema) used by both apps/officine and apps/cloud so both sides compute hashes identically; the annex C test vectors must pass in packages/protocol and in both apps.

B3. Loop for phase B: same as A2 (test first, domain, transaction, route with schema and permission, screen, full check, commit, PROGRESS.md after every item, docs/reports/BX.md after each group). PostgreSQL rules: every write in one transaction with its audit row and outbox row; SERIALIZABLE or explicit row locks where two writers can race; integer XAF; timestamptz in UTC; migrations never edited once committed. Integration tests run against a real PostgreSQL started by docker compose (never an in-memory fake). Node-to-cloud tests start a real apps/officine node and a real apps/cloud server and sync between them over HTTPS.

B4. Full check B:
  npm run typecheck && npm run lint && npm test in apps/cloud, apps/backoffice, packages/protocol and apps/officine (phase A must stay green)
  docker compose -f deploy/cloud/compose.yaml up -d, then the integration and end-to-end suites, then down
  Once per group: npm audit --audit-level=high, SBOM, the transparency-log verifier on the test data.

B5. Never block (applies to both phases): doubts → safest option, recorded in docs/QUESTIONS.md, continue. A failure that survives 3 genuinely different approaches → docs/BLOCKERS.md, mark blocked, move on, retry at the end. Anything that needs a human or real infrastructure (real hosting provider in Cameroon, real off-site storage, code-signing certificate, real printer, pharmacists, data protection authority approval) → build and test everything possible locally with docker, write the exact manual procedure in the relevant manual-tests.md, mark waiting-human, continue. Never fake a result, never mock outside test/, never add telemetry, never disable a security control to make something pass.

B6. Exit condition (only then stop):
  - Every row of PROGRESS.md (phase A and phase B) is done or waiting-human with its manual procedure, or blocked after a final retry and fully documented.
  - Full checks A and B are green; no high or critical audit issue; SBOMs generated; annex C vectors pass in all three packages.
  - RB-01..RB-10 automated where possible; the restore and failover scripts have produced a measured RPO/RTO report.
  - README files let a stranger start the whole cloud with docker compose, enrol a pharmacy node, see it sync in the back-office and verify an inclusion proof, in under 60 minutes.
  - docs/reports/FINAL.md in French: what is built (IDs) for both phases, what waits for a human and why, all assumptions, known risks, exact commands.

Start now with section 0.
```

---

## Phrase de relance

```text
Autonomous mode, resume: follow PROMPT-QODER-GESTIONNAIRE-PUIS-SERVEUR.md section 0, then continue the current phase until the exit condition B6. Do not ask anything.
```

## Ce que l'humain regarde en revenant

| Fichier | Contenu |
|---|---|
| `docs/PROGRESS.md` | État de chaque exigence (phase A puis phase B) |
| `docs/reports/PHASE-A.md` | Bilan du gestionnaire, écrit avant le passage à la phase B |
| `docs/10-cloud-spec.md` | Spécification du serveur central écrite par l'agent : **à relire en priorité** |
| `docs/QUESTIONS.md`, `docs/BLOCKERS.md` | Décisions prises seul, points bloqués |
| `deploy/cloud/` | Démarrage du cloud, sauvegarde, bascule, procédures d'exploitation |
| `docs/reports/FINAL.md` | Bilan final |
