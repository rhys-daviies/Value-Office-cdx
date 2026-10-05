# Production security posture and Security B record

**Status: Security B IN PROGRESS** — B1 done (recovery branch), B2 done (this documentation). B3–B8 pending PMO
approval. Never print or paste connection strings, passwords, tokens or session secrets.

## Current safe runtime architecture

| Item                  | State (verified read-only, 2026-10-04)                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application           | Vercel project `value-office-cdx` (team `cardaxia`), `main` = `bc3fdc5`, deployment `dpl_CLZ7vfhk3ERoZYCtY6NTeHTxffVy`                               |
| Runtime path          | Vercel **Production-only** `DATABASE_URL` → `vo_runtime` (pooled). Startup log `db-role=least-privilege`; only `vo_runtime` client sessions          |
| Vercel variables      | Production: `DATABASE_URL`, `VO_SESSION_SECRET`, `VO_REPORT_STORAGE`, `VO_DEPLOYMENT_MODE`. Preview and Development: none (no production credential) |
| Deployment protection | Vercel Authentication on every deployment URL except the production domain                                                                           |
| Database              | Neon PostgreSQL 18.6, database `neondb`, migration head 0020 (21 hashes verified)                                                                    |
| Data at Security A    | 618 rows in 33 tables, 39 trajectory points, 3 issued reports, 3 stored PDFs (SHA-256 verified)                                                      |

## Production roles

| Role           | Purpose                                                      | Notes                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vo_runtime`   | **Least-privilege application runtime identity**             | DML only (no audit writes, no report UPDATE/DELETE, no session/credential DELETE, no CREATE, owns nothing); `db:check-role` PASS. Credential: Vercel Production `DATABASE_URL` and the operator Keychain item `value-office-prod-vo_runtime`                                        |
| `neondb_owner` | **Administrative / migration identity**                      | Owns `neondb`, the `drizzle` schema, all tables, sequences, triggers and audit functions; holds ADMIN over `vo_runtime`. Never in application runtime configuration                                                                                                                 |
| `vo_app`       | **Legacy — pending retirement; MUST NOT be used by runtime** | Created in the Neon Console, so a member of `neon_superuser` (CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, `pg_write_all_data`). No sessions, owns nothing, referenced by no runtime config. `neondb_owner` cannot alter it (no ADMIN option): retirement is a Neon Console action |

## Database administration and migrations

- The application runtime uses `vo_runtime`, which deliberately cannot migrate (no DDL, owns nothing).
- Production migrations run as the administrative owner (`neondb_owner`) on the **unpooled** host, from an operator
  machine, with the credential entered at a hidden prompt — never stored in files, Vercel or the shell history:
  `MIGRATION_DATABASE_URL=<owner, unpooled> VO_APP_DB_ROLE=vo_runtime npm run db:migrate` (re-applies `vo_runtime`
  grants), then `npm run db:check-role` with the runtime URL must report least-privilege.
- Owner credentials must never be placed in application runtime configuration (Vercel Production or Preview).
- Migrate **before** deploying code that needs the new schema; migrations are forward-only and additive so far.
- `VO_APP_DB_ROLE` for production is `vo_runtime`.

## Neon / Vercel integration warning

- The Neon **marketplace integration remains installed** on the Vercel team, with store `neon-red-plank`.
- It is connected to **zero** Vercel projects; nothing syncs into `value-office-cdx`.
- **Do not reconnect it casually.** Connecting the store to a project re-injects the owner `DATABASE_*` variables
  (about 18) into Vercel Production and Preview, undoing the 4D.9M runtime-role separation.
- The store and the Neon project it represents hold the production database. **Do not delete the integration, the
  store or the Neon project as part of security cleanup.**

## Rollback policy (supersedes the 4D.9M runbook's rollback rows)

Vercel Instant Rollback restores a deployment **with the environment it was built with**.

**Safe rollback family** — built after the `vo_runtime` switch, compatible with migration head 0020:

| Deployment                         | Commit    | Content                                        |
| ---------------------------------- | --------- | ---------------------------------------------- |
| `dpl_CLZ7vfhk3ERoZYCtY6NTeHTxffVy` | `bc3fdc5` | Current (4D.9N freeze record)                  |
| `dpl_2GHjactKuQEXtWofNne23ZRQyLS3` | `df2f186` | 4D.9N tooling (same runtime behaviour)         |
| `dpl_6QBmEYThTULCzSxvDzNhKWevb3Rt` | `df6f033` | 4D.9N application release                      |
| `dpl_C9R2FPPMTy22ujd1xTLi4yGtfTz2` | `5ee4167` | 4D.9M release (pre-4D.9N visuals; same schema) |

**Never restore directly to production** — built with the historical `neondb_owner` credential in their environment
and running pre-0019 code: `m0zhti4s0` (`a5e960d`, the old 4D.9M rollback target — **explicitly unsafe**),
`h1bpup2ha` (`a88cc72`), `7la0tly73` and `d8jt3kber` (`29828b1`), `mbgh505et` (`b0b7864`), `ofxuxk42a`
(`b499ac5`). Restoring one would put an owner-privileged credential back into the public runtime and run code that
predates the current schema.

Preferred recovery sequence:

1. Application fault → Instant Rollback to the newest deployment in the safe family that predates the fault.
2. Before any rollback, confirm the target is compatible with the current migration head (all safe targets are
   0020-compatible; there is no down-migration).
3. After rollback: health, startup log `db-role=least-privilege`, only `vo_runtime` sessions, fingerprint unchanged.
4. Roll forward with a fix rather than reaching further back.
5. `vo_runtime` compromised → as `neondb_owner` (ADMIN over `vo_runtime`) set a new password over TLS, update the
   Keychain item and the Production `DATABASE_URL` without printing it, redeploy, end old sessions, run
   `db:check-role`.
6. Data must be restored → PMO decision; restore from the recovery branch below (or PITR, retention unknown) into a
   new branch first, verify, then repoint. Restoring loses changes made since the recovery point.

## Recovery points

| Branch                        | Status                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post-4d9n-freeze-2026-10-04` | **Preferred recovery branch.** Created by Rhys in the Neon Console after the 4D.9N freeze (B1). HUMAN CONFIRMED — TOOL VERIFICATION UNAVAILABLE (no Neon API access from the operator tooling)                                                                                                                                    |
| `pre-4d10-release-2026-10-05` | **INVALID AS PRE-RELEASE RECOVERY POINT — MIGRATED TO 0026 DURING ABORTED R2 — PRESERVED FOR FORENSIC / MIGRATION EVIDENCE.** Created from `main` after the R2 PRE (0020), then migrated by mistake (4D.10R2B; branch `br-bitter-boat-b75plc9y`, endpoint `ep-weathered-smoke-b7i4m245`). Do not delete, reset or restore from it |
| `pre-4d9m-2026-10-03`         | **Legacy, not preferred.** Taken at migration 0018 before 4D.9M: predates 0019/0020, the `vo_runtime` switch, the Information Request report issued 2026-10-02 23:36Z, DEMO-TRAJ and DEMO-TRAJ2. Still exists (human confirmed). Retained pending later cleanup (B8)                                                              |

Neon roles belong to a branch and password resets are branch-scoped (Neon docs, Manage roles: "Resets are branch-scoped,
so reset the role on each branch where it is used"); a child branch starts with copies of its parent's roles.

PITR / history retention: **UNKNOWN** — follow-up: confirm the plan's retention in the Neon Console.

## Security A findings (2026-10-04, read-only)

Critical: none. High: none.

- **Medium** — dormant `vo_app` with `neon_superuser`-level privileges and a still-valid login (B3, B7).
- **Medium** — the historical `neondb_owner` credential is still valid and frozen in six pre-4D.9M deployments and in
  the integration store (B4, B5).
- **Medium** — the 4D.9M runbook named `a5e960d` as the rollback target (**fixed in B2**).
- **Low** — Neon integration installed (0 projects); reconnecting would re-inject owner variables (documented, B2).
- **Low** — stale legacy recovery branch; second copy of production data (B1 done; B8 pending).
- **Low** — stale `vo_app` runtime guidance in README, deployment guide and `.env.example` (**fixed in B2**).
- **Informational** — expired `VERCEL_OIDC_TOKEN` in an ignored local `.env.local` (B6); `pg` SSL-mode warning; no
  RLS by design (triggers enforce); `neondb_owner` ADMIN over `vo_runtime` (expected).

## Security B actions

| Step | Action                                                                                            | Status                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | Create recovery branch `post-4d9n-freeze-2026-10-04` (Neon Console, Rhys)                         | Done (human)                                                                                                                                   |
| B2   | Documentation: rollback policy, canonical roles, migration path, integration warning, this record | Done (local)                                                                                                                                   |
| B3   | Reset `vo_app` password in the Neon Console and discard it (stage 1 retirement)                   | Pending                                                                                                                                        |
| B4   | Rotate `neondb_owner` (Neon Console); store nowhere; supply only at the migration prompt          | **NOT complete for production** — the R2 reset was made on the recovery branch only (Neon resets are branch-scoped); redo on `main` (4D.10R2B) |
| B5   | Optionally delete the six pre-4D.9M deployments in Vercel                                         | Pending, optional                                                                                                                              |
| B6   | Remove the expired `VERCEL_OIDC_TOKEN` line from the local `.env.local`                           | Pending                                                                                                                                        |
| B7   | After observation, delete the `vo_app` role (Neon Console)                                        | Pending                                                                                                                                        |
| B8   | After B1 is relied on, delete the legacy `pre-4d9m-2026-10-03` branch (Neon Console)              | Pending                                                                                                                                        |

Do not change: `vo_runtime` and its grants, the Production variables, the Keychain item, Vercel deployment protection,
`neondb_owner` ownership, or the Neon integration / store.
