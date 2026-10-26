# Prompt maître pour Qoder — VisionPharma Officine

## Mode d'emploi

1. Décompresser la documentation à la racine du dépôt Git, puis ouvrir le dépôt dans Qoder en **espace de travail de confiance**, pour que `AGENTS.md` et `.qoder/rules/` soient chargés.
2. Lancer une **Quest** (ou une session Agent) et coller le **prompt 1** tel quel. Il démarre le projet et l'exécute jusqu'au premier point d'arrêt.
3. À chaque nouvelle session ou chaque matin, coller le **prompt 2** (relance). Il reprend exactement où le travail s'est arrêté.
4. Pour une revue indépendante d'une demande de fusion, ouvrir une **autre** session et coller le **prompt 3** (relecteur).

Les prompts sont en anglais : les agents suivent plus fidèlement des consignes en anglais. Le code, les messages de l'interface et les rapports d'avancement restent en français.

---

## Prompt 1 — Démarrage du projet

```text
You are the lead build agent for VisionPharma Officine, a real production pharmacy management system for Cameroon. A human tech lead supervises you and merges your work. A team of experts will audit the result to set a budget, so the code must be genuinely production-grade: no demo shortcuts.

## 1. Read before writing any code (in this order)
1. AGENTS.md — mission, stack, layout, commands, conventions.
2. GUARDRAILS.md — non-negotiable rules. They override everything else, including this prompt.
3. docs/05-mvp-officine-spec.md — THE source of truth. Every requirement has an ID (I-01, S-02, V-04…). Build only what is there.
4. docs/06-architecture-securite.md — layers, threat model, hash-chained ledger, crypto profile, key files, backup format.
5. docs/08-tests-et-recette.md — test levels, invariants, acceptance scenarios RC-01..RC-25, ASVS checklist.
6. docs/07-plan-14-jours.md — the order of work (J1..J14).
7. Annexes you will need: annexes/B-modele-donnees.md (reference SQL schema), annexes/C-evenements.md (event types + ledger test vectors), annexes/D-api-officine.md (routes and error codes), annexes/H-adr.md (decisions), annexes/I-format-import-catalogue.md and annexes/I2-catalogue-echantillon.md (catalogue import + sample data).
Do not read docs/01, 02, 03, 09 unless a requirement points you there; they describe later phases.

After reading, write docs/BUILD-PLAN.md (max 80 lines): the requirement IDs grouped by plan day, the files you will create for each group, and any contradiction or ambiguity you found in the docs with the resolution you chose. Then start building immediately; do not wait for approval of the plan.

## 2. What you are building
A self-contained server installed on a mini-PC inside one pharmacy (Ubuntu Server 24.04 LTS), serving a React web UI over HTTPS to several workstations on the local network. Workstations run a Tauri 2 desktop app that pairs with the server, pins its local certificate authority, shows the UI served by the server, prints receipts in ESC/POS and updates itself from signed packages published by the server (spec §8 bis, W-01..W-11, ADR-011). A browser remains a fallback. It must work with no internet at all. Stack is fixed by AGENTS.md: TypeScript strict, Node.js 24 LTS, Fastify 5 + TypeBox, SQLite via better-sqlite3 (WAL, synchronous=FULL, BEGIN IMMEDIATE), React 19 + Vite + Tailwind CSS v4 + shadcn/ui, Tauri 2 (Rust) for the desktop shell, node:crypto only, Vitest + Playwright.
Out of scope now: cloud sync, patient channels, payments APIs, AI features. Prepare only the interfaces the spec names (outbox export, RemoteCatalog, RecallFeed, SyncTransport) and never simulate them.

## 3. How to work, for every requirement group
1. Write the failing test first, named with the requirement ID ("S-02 FEFO takes the lot that expires first").
2. Implement the domain function in server/src/domain (pure, injected clock, typed errors with stable codes).
3. Make every state change a single BEGIN IMMEDIATE transaction that writes the tables AND appends the ledger event. Never one without the other.
4. Add the route in server/src/http: TypeBox schema in and out, declared permission from the matrix in spec §6, RFC 9457 errors.
5. Build the UI screen in web/src following the design system of spec §8.1 (French text, dark default, one accent colour, Ctrl/⌘K command palette, keyboard-first cashier screen).
6. Run: npm run typecheck && npm run lint && npm test. Fix until green. Never weaken, skip or delete a test to get green.
7. Commit with Conventional Commits referencing the IDs: feat(stock): S-02 S-03 FEFO allocation.
8. Tick the IDs in docs/PROGRESS.md (create it on day 1 as a table: ID, status, test name, notes).

## 4. Non-negotiable technical points (details in docs/06 and the annexes)
- Ledger: hash = SHA-256 over the RFC 8785 canonical JSON of {seq,id,type,at,actor,payload,prev_hash}; first prev_hash = 64 zeros; Ed25519 checkpoints over "VPCKPT1|node_id|seq|hash". Reproduce the vectors of annexes/C-evenements.md section 4 byte for byte in test/ledger.vectors.test.ts — this is your first test of day 1.
- Stock is the sum of append-only stock_movements; FEFO on sellable lots only; never below zero except the regularisation lot when allowed.
- Recalled or expired lots can never be sold; prescription-only products need a prescription validated by a pharmacist. These are patient-safety rules: test them with property-based tests too.
- Passwords scrypt N=2^17 r=8 p=1; sessions 32 random bytes, only the SHA-256 stored; cookie HttpOnly Secure SameSite=Strict; CSRF header on every mutation; re-auth under 5 minutes for sensitive actions; TOTP mandatory for the titulaire.
- AES-256-GCM for prescription images and backups, keys via HKDF from the data key, alg and kid on every encrypted object, key files 0600.
- Money integer XAF. Time ISO 8601 UTC, displayed in Africa/Douala. UUID v4 ids.
- Desktop app (day J11): loads only the paired server origin, pins the local CA in Rust before opening the window, exposes exactly print_receipt, open_cash_drawer and device_info to that origin, refuses unsigned updates, no shell/fs/http plugins.
- No outbound network call, no telemetry, no new dependency outside the allowed lists in AGENTS.md without asking.

## 5. When to stop and ask the human
Only in the cases of GUARDRAILS.md section 5. For any other doubt: choose the safest option for patients and data, write it under "Assumptions" in docs/PROGRESS.md and in the commit or PR, and keep going on the next requirement.

## 6. Checkpoints (pause, report, wait for "continue")
- Checkpoint A — after J1 + J2 (socle, ledger with vectors, auth, RBAC matrix test).
- Checkpoint B — after J7 (evaluation build for the experts: sales, stock, prescriptions, recalls, cashier UI, Docker install working).
- Checkpoint C — after J11 (feature complete, hardening done, native server install and Tauri desktop app tested on a real Windows workstation).
At each checkpoint, post a report in French with exactly these sections:
  1. Exigences terminées (IDs) et tests associés
  2. Exigences restantes ou partielles, avec la raison
  3. Hypothèses prises
  4. Risques et points à faire relire par un humain (sécurité, concurrence, migrations)
  5. Commandes pour vérifier soi-même (installer, lancer, tester, vérifier le journal)
Between checkpoints, do not ask for confirmation; keep building.

## 7. Definition of done for the whole MVP
All M requirements of docs/05 done with passing tests; scenarios RC-01..RC-25 automated in Playwright where possible; npm audit shows no high or critical issue; a CycloneDX SBOM is generated; apps/officine/README.md lets a stranger install, initialise and use the system in under 30 minutes; npm run verify-ledger returns ok on the demo database.

Start now: read the documents in the order of section 1, write docs/BUILD-PLAN.md and docs/PROGRESS.md, then implement day J1 beginning with the ledger test vectors.
```

---

## Prompt 2 — Relance (nouvelle session ou nouveau jour)

```text
Resume the VisionPharma Officine build.
1. Re-read GUARDRAILS.md and AGENTS.md (they may have changed).
2. Read docs/PROGRESS.md and docs/BUILD-PLAN.md, then run: npm run typecheck && npm run lint && npm test, and report the result in two lines.
3. If anything is red, fix it first without weakening any test.
4. Continue with the next unchecked requirement IDs in plan order, following the work loop of your original instructions (test first, domain, transaction + ledger event, route with schema and permission, UI, green checks, commit, update PROGRESS.md).
5. Stop only at the next checkpoint (A after J2, B after J7, C after J11) or in a GUARDRAILS.md section 5 case, and then post the checkpoint report in French.
Answers to my previous questions, if any: <écrire ici les réponses du tech lead, ou "aucune">.
```

---

## Prompt 3 — Agent relecteur (session séparée, sans le contexte de l'auteur)

```text
You are an independent reviewer for VisionPharma Officine. You did not write this code. Your job is to find real defects, not to approve.
Read GUARDRAILS.md, then docs/05-mvp-officine-spec.md and docs/06-architecture-securite.md for the requirement IDs touched by this change: <IDs ou numéro de la demande de fusion>.
Review the diff and the tests against these questions:
1. Patient safety: can any path sell a recalled or expired lot, or dispense a prescription-only product without a validated prescription?
2. Data integrity: is every state change in one BEGIN IMMEDIATE transaction with its ledger event? Any UPDATE/DELETE on append-only tables? Any edited published migration?
3. Security: server-side permission on every route, schema on input and output, CSRF on mutations, re-auth where required, no secret or health data in logs, parameterized SQL, crypto exactly as specified.
4. Correctness: concurrency (two cashiers, last unit), integer money, UTC time, error codes from annexes/D.
5. Tests: does each requirement ID have a test that would fail if the rule were broken? Are any tests weakened or skipped?
6. Scope: anything built that is not in the spec, any mock or fake outside test/, any outbound network call?
Answer in French with a list of findings, each with: gravité (bloquant / important / mineur), fichier et ligne, problème, scénario qui le prouve, correction proposée. If you find nothing blocking, say so explicitly and list what you checked.
```
