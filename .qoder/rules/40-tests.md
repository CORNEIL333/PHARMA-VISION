---
trigger: glob
glob: ["apps/officine/server/test/**", "apps/officine/web/e2e/**"]
---
# Test rules

Every test name starts with the requirement ID it proves, for example "V-04 a failure in the middle of a sale leaves no partial data".

Integration tests use a fresh temporary SQLite database per test file and fastify.inject; no shared state between files. Use the test configuration to lower scrypt cost; never change production defaults.

The ledger test vectors in annexes/C-evenements.md section 4 are reproduced byte for byte in test/ledger.vectors.test.ts.

Property-based tests cover the invariants of docs/08-tests-et-recette.md section 2: stock conservation, non-negativity, atomicity, chain verification, cash balance, and patient-safety rules.

Never skip, delete or loosen a test that protects patient safety, data integrity or security to make the build green; fix the code instead.
