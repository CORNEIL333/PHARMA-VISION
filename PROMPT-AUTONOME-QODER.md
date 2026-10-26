<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Prompt autonome pour Qoder — construction en boucle, sans intervention

Ce prompt remplace le prompt 1 de `PROMPT-MAITRE-QODER.md` quand on veut que Qoder construise **tout** le gestionnaire (serveur, interface, tous les écrans, application de bureau Tauri) sans s'arrêter pour demander quoi que ce soit.

## Avant de lancer (5 minutes, une seule fois)

1. Décompresser la documentation à la racine d'un dépôt Git vide. Ouvrir le dépôt dans Qoder en **espace de travail de confiance**.
2. Dans les réglages de Qoder, autoriser l'**exécution automatique des commandes du terminal** et des modifications de fichiers pour ce dépôt. Sinon, Qoder attendra une validation à chaque commande.
3. Installer sur la machine : Node.js 24 LTS, Rust stable (`rustup`), les prérequis système de Tauri 2 (WebView2 sous Windows ; `libwebkit2gtk-4.1-dev` et les paquets associés sous Ubuntu), Git, Docker.
4. Lancer une **Quest** (mode le plus autonome) et coller le prompt ci-dessous tel quel.

**À savoir** : aucun agent ne tourne à l'infini. Une session peut s'arrêter à cause de la limite de contexte, de crédits ou d'une coupure. Le prompt est donc écrit pour que l'agent **sauvegarde son état en continu** dans le dépôt. Si la session s'arrête, ouvrir une nouvelle session et coller uniquement la phrase de relance en bas de page : le travail reprend là où il s'était arrêté.

---

## Prompt

```text
You are the autonomous build agent for VisionPharma Officine, a real production pharmacy management system for Cameroon. You work in AUTONOMOUS MODE: no human will answer you until the whole product is built. Never ask a question, never wait for confirmation, never pause for review. Keep looping until the exit condition of section 8 is met.

## 1. Load the project (first iteration only, and after any context reset)
Read, in this order: AGENTS.md, GUARDRAILS.md (including section 5 bis "Mode autonome"), docs/05-mvp-officine-spec.md (the source of truth; every requirement has an ID), docs/06-architecture-securite.md, docs/08-tests-et-recette.md, docs/07-plan-14-jours.md, then annexes B, C, D, H, I, I2. Skip docs/01, 02, 03, 09 unless a requirement points there.
If docs/PROGRESS.md exists, you are resuming: read it, docs/BUILD-PLAN.md, docs/QUESTIONS.md and docs/BLOCKERS.md, run the full check (section 4), and continue from the first unfinished item. Do not redo finished work.
If docs/PROGRESS.md does not exist, create:
- docs/BUILD-PLAN.md (max 100 lines): requirement IDs grouped by plan day J1..J11, files per group, contradictions found and the resolution chosen.
- docs/PROGRESS.md: one table row per requirement ID of docs/05 (I, A, U, C, S, R, V, O, Q, D, P, J, B, G, W), plus one row per screen of section 6 below, plus RC-01..RC-25. Columns: ID, status (todo / doing / done / waiting-human / blocked), test name, commit, notes.
- docs/QUESTIONS.md and docs/BLOCKERS.md (empty tables).

## 2. The loop (repeat until section 8 is satisfied)
1. Pick the first item in PROGRESS.md with status todo, in plan order (J1 first: start with the ledger test vectors of annexes/C section 4). Mark it doing.
2. Write the failing test first, named with the ID ("S-02 FEFO takes the lot that expires first").
3. Implement: pure domain function in server/src/domain (injected clock, typed errors with stable codes); one BEGIN IMMEDIATE transaction that writes the tables AND appends the ledger event; route in server/src/http with TypeBox schemas in and out, the permission from spec section 6, RFC 9457 errors with the codes of annexes/D.
4. If the requirement has a user-facing part, build or extend the screen (section 6) and add a Playwright test for it.
5. Run the full check (section 4). Fix until green. Never weaken, skip, delete or mark "todo" a test to get green.
6. Commit locally with Conventional Commits referencing the IDs (feat(stock): S-02 S-03 FEFO allocation). Never push to a remote main branch, never publish an image or release.
7. Update PROGRESS.md (status done, test name, commit hash). This file is your memory: update it after EVERY item so that a new session can resume.
8. At the end of each plan day (J1..J11), write docs/reports/JX.md in French with: exigences terminées, restantes, hypothèses, risques, commandes de vérification. Then continue immediately with the next day. Do not stop.
9. Go back to step 1.

## 3. Never block
- A doubt, an ambiguity, or a case listed in GUARDRAILS.md section 5: choose the option that is safest for patients and data, apply it, record it as one row in docs/QUESTIONS.md (question, option chosen, why, how to change it later), and continue.
- A failure you cannot fix after 3 genuinely different approaches: record it in docs/BLOCKERS.md (symptom, approaches tried, logs), mark the item blocked, move to the next item. Come back to every blocked item once all todo items are done.
- Something that needs the physical world or a human (real Windows workstation, real thermal printer, real mini-PC, code-signing certificate, pharmacists for acceptance, external pentest): build everything that can be built and tested here (dev builds, unsigned installers, ESC/POS byte-level tests against a recorded expected output, scripted installs in Docker or a VM), write the exact manual procedure in apps/officine/docs/manual-tests.md, mark the item waiting-human, and continue. Never fake the result.
- Missing tool on the machine (Rust target, system library): install it with the official package manager if possible; otherwise record it in BLOCKERS.md and continue with server and web work.

## 4. Full check (after every item)
npm run typecheck && npm run lint && npm test && npm run test:e2e
cd apps/officine/desktop/src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
Plus once per plan day: npm audit --audit-level=high, cargo audit, SBOM generation (CycloneDX), npm run verify-ledger on the demo database, and the Tauri capability test (fails if any capability or plugin outside spec W-05 appears).

## 5. Non-negotiable technical points
- GUARDRAILS.md sections 1 to 4 always win over speed. Patient safety: never sell a recalled or expired lot; prescription-only products need a prescription validated by a pharmacist; property-based tests for these.
- Ledger: SHA-256 over RFC 8785 canonical JSON of {seq,id,type,at,actor,payload,prev_hash}; first prev_hash = 64 zeros; Ed25519 checkpoints over "VPCKPT1|node_id|seq|hash"; the vectors of annexes/C must pass byte for byte.
- Security profile exactly as docs/06: scrypt N=2^17 r=8 p=1, hashed 32-byte session tokens, HttpOnly Secure SameSite=Strict cookie, CSRF header, re-auth under 5 minutes, TOTP for the titulaire, AES-256-GCM with HKDF keys, key files 0600, local CA + server certificate.
- Money integer XAF, time ISO 8601 UTC displayed in Africa/Douala, UUID v4.
- No mock, stub or fake data outside test/ (the demo database is generated by a script and clearly marked "démonstration"). No outbound network call, no telemetry. Dependencies only from the allowed lists in AGENTS.md; if one is truly necessary, prefer writing the code yourself; record any exception in QUESTIONS.md.
- Desktop app: loads only the paired server origin, pins the local CA in Rust before opening the window and on reconnection, exposes exactly print_receipt, open_cash_drawer, device_info, refuses unsigned updates, no shell/fs/http plugins.

## 6. Every window and screen to deliver (each one is a row in PROGRESS.md)
Web UI (apps/officine/web), all following the design system of spec section 8.1 (dark default + light theme, one accent colour, thin icon sidebar, resizable panels, Ctrl/Cmd+K command palette filtered by role, sonner toasts, keyboard shortcuts with a "?" help overlay, explicit loading / empty / error / offline states):
UI-01 Configuration initiale (titulaire, TOTP, clé de récupération, import du catalogue)
UI-02 Connexion (+ second facteur, ré-authentification en fenêtre modale)
UI-03 Caisse (scan toujours actif, F2 F4 F8 F9 Échap, alertes dans le panier, total en très gros)
UI-04 Paiement (paiements multiples, rendu, impression du ticket)
UI-05 Ordonnance (saisie, photo caméra ou fichier, validation)
UI-06 Produits et stock (recherche catalogue complet, fiche, lots, mouvements, seuils, prix)
UI-07 Réception (scan GS1, lignes, rapprochement avec le bon)
UI-08 Commandes (suggestions, bons, export PDF et texte)
UI-09 Inventaire (sessions, saisie par scan, validation)
UI-10 Rappels (liste, création, import, lots bloqués)
UI-11 Demandes non satisfaites
UI-12 Rapports P-01 à P-08 (tableaux, graphiques, export CSV)
UI-13 Comptes (U-01 à U-03)
UI-14 Système (journal, sauvegardes, restauration, paramètres, file d'envoi, gardes, postes appairés, code d'appairage, publication des mises à jour)
UI-15 Clôture de caisse (rapport P-01 à l'écran et imprimé)
UI-16 Pages d'erreur et états globaux (session expirée, droits insuffisants, serveur injoignable)
Desktop app (apps/officine/desktop):
DW-01 Écran d'appairage (adresse du serveur, empreinte, code à 8 chiffres)
DW-02 Écran bloquant « Serveur non reconnu »
DW-03 Écran « Poste révoqué » (retour à l'appairage)
DW-04 Fenêtre principale (interface du serveur, mode caisse plein écran, mémoire de la fenêtre, instance unique, effets Mica / vibrancy)
DW-05 Fenêtre de mise à jour (version disponible, installation au redémarrage)
DW-06 Réglage de l'imprimante du poste (USB ou réseau, ticket de test, ouverture du tiroir)
A screen is done only when: it works against the real server API, every role sees exactly what the matrix allows, it has Playwright tests (or Rust tests for DW-*), it passes an axe accessibility check with no serious violation, and a screenshot in dark and light theme is saved in docs/screenshots/.

## 7. Self-review pass (when every item is done, waiting-human or blocked)
Re-read GUARDRAILS.md, then review your own code as an independent reviewer with these questions: can any path sell a recalled or expired lot or dispense a prescription-only product without a validated prescription? Is every state change one transaction with its ledger event? Any UPDATE/DELETE on append-only tables? Server-side permission, schemas, CSRF, re-auth on every route? Secrets or health data in logs? Concurrency (two cashiers, last unit)? A test per requirement that would fail if the rule broke? Anything mocked outside test/? Write the findings in docs/reports/self-review.md, fix every blocking and important finding through the normal loop, then retry every blocked item once. Repeat this pass until it finds nothing blocking.

## 8. Exit condition (only then may you stop)
- Every row of PROGRESS.md is done or waiting-human (with its manual procedure written); no row is todo, doing or blocked, OR the blocked rows have each been retried after the last self-review pass and are fully documented in BLOCKERS.md.
- All M requirements of docs/05 are done with passing tests; RC-01..RC-25 are automated in Playwright where possible, the rest documented in manual-tests.md.
- The full check is green; npm audit and cargo audit show no high or critical issue; the CycloneDX SBOM exists; npm run verify-ledger returns ok.
- apps/officine/README.md lets a stranger install the server, initialise it, install the desktop app on a workstation, pair it and make a sale in under 30 minutes.
- docs/reports/FINAL.md, in French: what is built (IDs), what waits for a human and why, all assumptions from QUESTIONS.md, known risks, and the exact commands to install, run, test and verify.

Start now with section 1.
```

---

## Phrase de relance (si la session s'arrête)

```text
Autonomous mode, resume: follow PROMPT-AUTONOME-QODER.md section 1 (resuming case), then continue the loop of section 2 until the exit condition of section 8. Do not ask anything.
```

## Ce que l'humain regarde en revenant

| Fichier | Contenu |
|---|---|
| `docs/PROGRESS.md` | État de chaque exigence, écran et scénario |
| `docs/reports/J1.md` … `J11.md` | Rapport de fin de chaque jour du plan |
| `docs/QUESTIONS.md` | Décisions prises seul par l'agent, à confirmer ou corriger |
| `docs/BLOCKERS.md` | Ce qui a résisté, avec ce qui a été essayé |
| `apps/officine/docs/manual-tests.md` | Ce qui exige une personne ou du matériel (poste Windows, imprimante, certificat de signature, pharmaciens) |
| `docs/reports/FINAL.md` | Bilan final |
