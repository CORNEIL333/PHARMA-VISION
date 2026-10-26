---
trigger: glob
glob: ["apps/officine/server/src/security/**", "apps/officine/server/src/http/**", "apps/officine/scripts/**"]
---
# Security code rules

Passwords: scrypt with N=131072, r=8, p=1, 16-byte salt, 32-byte output, stored as scrypt$N$r$p$salt$hash, compared with timingSafeEqual. Minimum length 12, checked against the embedded common-password list and the username.

Sessions: 32 random bytes in cookie vp_sid with HttpOnly, Secure, SameSite=Strict, Path=/. Store only the SHA-256 of the token. Idle timeout 30 minutes, absolute 12 hours. Mutating requests require header X-CSRF-Token equal to the session CSRF token.

Re-authentication younger than 5 minutes is required for voiding a sale, stock adjustment or destruction, recalls, account management, restore and ledger export.

Encryption at rest uses AES-256-GCM with a random 96-bit nonce, keys derived with HKDF-SHA-256 from the data key, and the header as associated data. Every encrypted or signed object carries alg and kid. Key files must be mode 0600; refuse to start otherwise.

Every route has a TypeBox schema for input and output, rejects unknown fields, and declares a permission from the matrix. Errors use RFC 9457 problem+json with a stable code and no sensitive detail. Security events (login, failure, lockout, re-auth, role change, restore) go into the hash-chained ledger.
