---
trigger: always_on
---
# VisionPharma - garde-fous permanents

Current mission: build VisionPharma Officine in apps/officine, following docs/05-mvp-officine-spec.md (requirement IDs) and docs/06-architecture-securite.md. Read GUARDRAILS.md and AGENTS.md at the start of each session.

Never allow the sale of a recalled or expired lot. Never allow dispensing a prescription-only product without a prescription validated by a pharmacist. No feature diagnoses, prescribes or gives medical advice. Never disable or weaken the tests for these rules.

Tables events, stock_movements and checkpoints are append-only: never write UPDATE or DELETE on them and never remove their triggers. Every business write happens in one BEGIN IMMEDIATE transaction that changes the tables and appends the ledger event together. Never edit a published migration; add a new one. Never change the hash, checkpoint or backup formats without a human-approved ADR; the ledger test vectors in annexes/C-evenements.md must always pass.

Money is integer XAF. Time is stored as ISO 8601 UTC. IDs are UUID v4.

No secrets in code, tests, logs or the repository. Cryptography only through node:crypto with the primitives of the security document; never Math.random for anything sensitive. Never lower scrypt parameters, disable TLS, CSRF, security headers or rate limiting outside the test configuration. Every route declares a permission from the role matrix and is checked server-side. SQL is always parameterized. No health data or secrets in technical logs.

No emulation in production code: mocks and fakes only under test. A feature that is not ready is absent from the UI. No outbound network calls and no telemetry in the MVP. No new production dependency without human approval.

Stop and ask a human before touching these rules, changing the stack, breaking existing data, doing anything irreversible outside the repository, or deciding a regulatory question. For everything else, choose the safest option, write it under Assumptions in the pull request, and keep going.
