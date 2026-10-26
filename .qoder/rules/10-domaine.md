---
trigger: glob
glob: "apps/officine/server/src/domain/**"
---
# Domain code rules

Domain functions are pure business logic: they receive a database transaction and a context object with actor, now and register, and never import anything from http or Fastify.

Write the test first, named with the requirement ID, for example "S-02 FEFO takes the lot that expires first". Inject the clock; never call Date.now directly in domain code.

Stock is the sum of stock_movements. To change stock, insert a movement; never store or update a quantity column. FEFO picks sellable lots only: not expired, not recalled, positive quantity, ordered by expiry then creation date. Only the technical regularisation lot may go negative, and only when allow_regul_sales is on.

Every command that changes state calls ledger.append inside the same transaction, with a payload that contains enough data to recompute the projection (lot ids, signed quantities, amounts). Payloads never contain secrets or images.

Return typed results or throw a DomainError with a stable code such as recalled_lot, expired_lot, rx_required, insufficient_stock, invalid_transition, reauth_required. No any types, no function longer than 60 lines.
