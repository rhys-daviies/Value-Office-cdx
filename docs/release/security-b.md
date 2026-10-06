# Production security posture and Security B record

**Status: Security B IN PROGRESS** — B1, B2, B3, B4 done; B5–B8 pending PMO decision (4D.11 recommendations
below). Security B is **not** complete. Never print or paste connection strings, passwords, tokens or session secrets.

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

| Role           | Purpose                                                                                                             | Notes                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vo_runtime`   | **Least-privilege application runtime identity**                                                                    | DML only (no audit writes, no report UPDATE/DELETE, no session/credential DELETE, no CREATE, owns nothing); `db:check-role` PASS. Credential: Vercel Production `DATABASE_URL` and the operator Keychain item `value-office-prod-vo_runtime`                                        |
| `neondb_owner` | **Administrative / migration identity**                                                                             | Owns `neondb`, the `drizzle` schema, all tables, sequences, triggers and audit functions; holds ADMIN over `vo_runtime`. Never in application runtime configuration                                                                                                                 |
| `vo_app`       | **Legacy — password reset and discarded on `main` (B3, 4D.11); pending deletion (B7); MUST NOT be used by runtime** | Created in the Neon Console, so a member of `neon_superuser` (CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, `pg_write_all_data`). No sessions, owns nothing, referenced by no runtime config. `neondb_owner` cannot alter it (no ADMIN option): retirement is a Neon Console action |

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

| Branch                           | Status                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post-4d9n-freeze-2026-10-04`    | **Preferred recovery branch.** Created by Rhys in the Neon Console after the 4D.9N freeze (B1). HUMAN CONFIRMED — TOOL VERIFICATION UNAVAILABLE (no Neon API access from the operator tooling)                                                                                                                                    |
| `pre-4d10-release-r2-2026-10-05` | **Pre-4D.10 recovery point (valid).** Created from `main` after the fresh R2 PRE (`br-shy-mud-b788by30`, `ep-red-recipe-b7k2f2ih`); verified read-only at 0020 / 21, identical to the release baseline. Do not delete                                                                                                             |
| `pre-4d10-release-2026-10-05`    | **INVALID AS PRE-RELEASE RECOVERY POINT — MIGRATED TO 0026 DURING ABORTED R2 — PRESERVED FOR FORENSIC / MIGRATION EVIDENCE.** Created from `main` after the R2 PRE (0020), then migrated by mistake (4D.10R2B; branch `br-bitter-boat-b75plc9y`, endpoint `ep-weathered-smoke-b7i4m245`). Do not delete, reset or restore from it |
| `pre-4d9m-2026-10-03`            | **Legacy, not preferred.** Taken at migration 0018 before 4D.9M: predates 0019/0020, the `vo_runtime` switch, the Information Request report issued 2026-10-02 23:36Z, DEMO-TRAJ and DEMO-TRAJ2. Still exists (human confirmed). Retained pending later cleanup (B8)                                                              |

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

| Step | Action                                                                                            | Status                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | Create recovery branch `post-4d9n-freeze-2026-10-04` (Neon Console, Rhys)                         | Done (human)                                                                                                                                                                                 |
| B2   | Documentation: rollback policy, canonical roles, migration path, integration warning, this record | Done (local)                                                                                                                                                                                 |
| B3   | Reset `vo_app` password in the Neon Console and discard it (stage 1 retirement)                   | **Done for production (2026-10-06, 4D.11)** — reset on `main` after Rhys confirmed all four `main` identifiers; new password discarded; production unaffected (POST PASS, `vo_runtime` only) |
| B4   | Rotate `neondb_owner` (Neon Console); store nowhere; supply only at the migration prompt          | **Done for production (2026-10-05, R2 fresh attempt #2)** — reset on `main` (human-confirmed), used once by the runner, not persisted                                                        |
| B5   | Optionally delete the six pre-4D.9M deployments in Vercel                                         | Deferred, optional — see 4D.11 assessment                                                                                                                                                    |
| B6   | Remove the expired `VERCEL_OIDC_TOKEN` line from the local `.env.local`                           | Deferred — see 4D.11 assessment                                                                                                                                                              |
| B7   | After observation, delete the `vo_app` role (Neon Console)                                        | Deferred — see 4D.11 assessment                                                                                                                                                              |
| B8   | After B1 is relied on, delete the legacy `pre-4d9m-2026-10-03` branch (Neon Console)              | Deferred — see 4D.11 assessment                                                                                                                                                              |

Do not change: `vo_runtime` and its grants, the Production variables, the Keychain item, Vercel deployment protection,
`neondb_owner` ownership, or the Neon integration / store.

Status at 4D.10R4 close (2026-10-06): B1, B2 and B4 complete; B3 and B5–B8 deferred.

## 4D.11 — post-release security and development hygiene (2026-10-06)

### B3 — `vo_app` password reset (done)

Dependency check (read-only, before any action): production `DATABASE_URL` is not `vo_app` — the startup role check
logs `db-role=provider-managed` for any role with CREATEROLE / BYPASSRLS (both held by `vo_app`) and production logs
`db-role=least-privilege`; only `vo_runtime` application sessions throughout 4D.10; Vercel holds only the four
Production variables; migrations use `neondb_owner` via the hardened runner; `vo_app` owns no objects, has no
members, no sessions, no table privileges (only USAGE on schemas `public` and `drizzle`); no code connects as it.
Rhys selected `main` and confirmed all four identifiers (`main`, `br-tiny-star-b7b8d3bh`, `ep-old-mode-b7jl3rd0`,
`delicate-resonance-93129287`), reset `vo_app` with `main` selected throughout and discarded the new password (not
pasted, stored or kept). Afterwards: `/api/health` ok; `release-check.py post` PASS (0026 / 27, 256 factual rows
identical, reports identical, `vo_runtime` least privilege); no `vo_app` / `neondb_owner` sessions; `vo_app` still
exists with login (B7).

### Local credential hygiene — shell history (done)

The two historical connection strings (the `neondb_owner` string retired by B4 and the `vo_app` string retired by B3)
were in `~/.zsh_history` **and** in 12 macOS Terminal session-restore files (`~/.zsh_sessions/*.history`); no other
history file held credentials. After both were invalid: backed up the 13 files to
`~/.cardaxia-4d11-history-backup-20261006T053908Z/` (outside the repository; directory 700, files 600), removed only
the two lines per file (26 lines), atomically, permissions preserved. Verified without printing secrets: no embedded
database credential remains; every other line byte-identical and in order. Open shells: none uses the Terminal
session-restore hook; zsh appends only new commands on exit, so the lines cannot return except by a history-trim
rewrite after 100+ new commands in a shell started before the cleanup — exit those shells when convenient. Delete the
backup directory once satisfied (it still contains the two now-invalid strings).

### Local development environment (resolved)

A `next dev` preview (`.claude/launch.json` → `value-office-dev`, started by the Claude app) shared the checkout's
`.next`; it was killed mid-write when the app quit (~02:03Z on 2026-10-06), leaving a corrupt generated
`.next/dev/types/validator.ts`, which `tsconfig.json` includes — typecheck and build then failed. The process had
already exited; only the git-ignored `.next` build output was removed (no source change). From the main checkout:
typecheck, lint, build, verify:bundle, Vitest 517/517 and db:verify pass. Practice: stop the preview dev server before
`typecheck` / `build`; if `.next/dev/types` is ever corrupt again, delete `.next` (generated) and rebuild.

### Branch-scoped credentials — new finding

Neon role passwords are per branch, and B3 / B4 reset them on `main` only. Branches created before those resets keep
the **old** passwords: `post-4d9n-freeze-2026-10-04`, `pre-4d9m-2026-10-03` and `pre-4d10-release-r2-2026-10-05`
(old `neondb_owner` and `vo_app`), `pre-4d10-release-2026-10-05` (old `vo_app`; its owner was reset in the aborted R2).
The historical strings name the `main` host, so they no longer work as written, but the same passwords would work
against a branch's own endpoint. Copies of the old passwords remain in the six pre-4D.9M Vercel deployments' build
environments (B5) and the local history backup. Inferred from Neon's documented behaviour; **not tested** (testing
would mean using the credentials). Recommended (PMO): reset `neondb_owner` and `vo_app` on each retained branch
(passwords discarded; branch data unchanged, so recovery points stay valid), or delete branches that are no longer
needed.

### B5–B8 assessment (no action taken)

| Step | Purpose / current risk                                                                                                                                                                                                                                                                                            | Assessment                                                                                           | Recommendation                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B5   | Delete the six pre-4D.9M deployments (`m0zhti4s0`, `h1bpup2ha`, `7la0tly73`, `d8jt3kber`, `mbgh505et`, `ofxuxk42a`; all still present). Their environments hold the old owner password (dead on `main` since B4, live on older branches) and pre-0019 code; an accidental Instant Rollback would break production | Still useful; risk reduced by B4; deletion irreversible but removes only unsafe rollback targets     | **Safe to execute** (Vercel, Rhys) — do it with or before the branch-credential resets                                                                   |
| B6   | Remove the expired `VERCEL_OIDC_TOKEN` line from the local `.env.local` (still present)                                                                                                                                                                                                                           | Still necessary (hygiene); local only; token expired                                                 | **Safe to execute now** — a one-line local edit                                                                                                          |
| B7   | Delete the `vo_app` role. After B3 nobody holds a valid `main` password; it owns nothing, has no table grants, no sessions, no members; it still holds `neon_superuser` membership and USAGE on `public` / `drizzle`                                                                                              | Now safe on `main`; deletion is branch-scoped (other branches keep their copy)                       | **Safe to execute** (Neon Console on `main`): revoke the two schema USAGE grants (as `neondb_owner`, Console SQL Editor on `main`), then delete the role |
| B8   | Delete the legacy `pre-4d9m-2026-10-03` branch (migration 0018; a full copy of production data with the old `neondb_owner` and `vo_app` passwords)                                                                                                                                                                | Superseded as a recovery point by `post-4d9n-freeze-2026-10-04` and `pre-4d10-release-r2-2026-10-05` | **Safe to execute** (Neon Console) — removes a stale data copy holding old passwords; irreversible                                                       |

The rollback policy above (safe family 0020-compatible, newest `bc3fdc5`) predates 4D.10: the current rollback target
is `dpl_6PUBbKWZ2HC6Wb1uju5MRVSdbUvr` (`b7d0c46`, verified healthy on 0026 in 4D.10R2); the older safe-family
deployments have not been verified against 0026.
