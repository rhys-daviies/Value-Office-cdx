@AGENTS.md

# Value Office — project rules

- Read `docs/architecture.md` before changing schema, commands or versioning.
- All authoritative writes go through a named command (`src/server/commands`). Never write tables directly from UI, scripts or AI code.
- Authorised Value Case versions are immutable; forecasts never alter them; only an approved Value Change (VCO) creates V2+.
- Money: `numeric(18,2)` + `decimal.js` (`src/domain/money.ts`). Never JS numbers.
- Do not invent Value Office methodology (statuses, formulas, reconciliations). Raise it for PMO review.
- Build incrementally: do not add tables for workflows not yet being implemented.
- Gates before claiming done: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run db:verify`, `npm run build`.
