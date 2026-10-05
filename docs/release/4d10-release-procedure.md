# 4D.10 production release procedure

**Status: frozen procedure for PMO authorisation, hardened after the aborted R2 (4D.10R2B).** Production is still at
0020 on `b7d0c46`; the attempts so far are recorded in `4d10-release-record.md`. The R2 restart migrated the new
recovery branch instead of production (release targeting / branch identity failure): every database step now proves
**which Neon branch** it is connected to (§2a), and the Console sequence has a deliberate switch back to `main` (§3–4).
Supersedes the 4D.10I preflight plan.

## 1. What is released

| Item               | Value                                                                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production today   | `main` = `b7d0c46`, PostgreSQL 18.6 (Neon), migration head **0020** (21 rows), runtime `vo_runtime`                                                                                                                                                |
| Release candidate  | the **Phase 4D.10R2B** commit (release tooling only on top of the application at `83f1514`); ancestry `0cb2328` (R2A) → `0ebde60` (R1) → `83f1514` → `fa017b6` → `4256329` → `8c83656` → `851d749` → `098aa48` → `9781c4f` → `bd71123` → `b7d0c46` |
| Migrations         | `0021`–`0026`, additive, no backfill, prospective rules only                                                                                                                                                                                       |
| Head after         | **0026**, **27** rows; last tag `0026_phase4d10h_value_change_determination_integrity`                                                                                                                                                             |
| Migration identity | `neondb_owner`, **unpooled** host, TLS                                                                                                                                                                                                             |
| Runtime identity   | `vo_runtime` (pooled, least privilege) — unchanged                                                                                                                                                                                                 |
| Records            | `4d10e/g/h-migration.md` (contents, reversal SQL), `4d10i-acceptance-record.md` (full-chain PG18 rehearsal)                                                                                                                                        |

Migration file SHA-256 (= `drizzle.__drizzle_migrations.hash`):

```
f54c6863e97204555945126803ae1696a08333d9c383cb0ab2eb46fe818bfae6  0020_phase4d9c_value_trajectory_integrity.sql (already applied)
32f092e1d4ed3646bfd7ba47dd3a6bdc6f92d1602554d8b4dcd10c483ec8c774  0021_phase4d10e_governed_movements.sql
bf132649b79c8839170a55f497d1d1bf477e530e9ed03888fb31ad2712a7eaa7  0022_phase4d10e_governed_movements_integrity.sql
f8c3a1f23d323c4a97b07e7740cf90ee584c5fb671eb9ffcab3dfedcf094f602  0023_phase4d10g_recommendation_review.sql
0d8c06da2968ecba342773d4063c4474fc7ea48cea929b84d6d3f2acfb6f4f80  0024_phase4d10g_recommendation_review_integrity.sql
02d4f98e3afd342a75eb6db23cd2590ad640b59cd1e3edaa1c879e5b07531680  0025_phase4d10h_value_change_determination.sql
d02cea6c4a2fd4c2e6d4e6c849d8e1867301711bf3d964dd4408f14bf14fd1c0  0026_phase4d10h_value_change_determination_integrity.sql
```

## 2. Release tools (in the repository, no secrets)

| Tool                                                        | Role                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/release/release-check.py reconcile` / `capture`    | read-only: reconcile changes since the 4D.9N freeze; `capture` (PMO-authorised, R2A) writes the **4D.10 pre-release production baseline** only on PASS                                                                                                                                                                                                |
| `scripts/release/release-check.py pre`                      | read-only (`vo_runtime` from the Keychain): production is exactly the accepted 0020 state and factually identical to the 4D.10 pre-release production baseline; publishes the release baseline **only on a full PASS** (atomic)                                                                                                                       |
| `scripts/release/release-check.py post`                     | read-only: production is exactly the accepted 0026 state; every baseline row identical; refuses any baseline that is not an accepted, PRE-published 0020-state release baseline                                                                                                                                                                       |
| `scripts/release/selftest-release-check.py`                 | non-production self-test of the accepted-file handling (throwaway PostgreSQL 18 cluster; cases A–G, 19 checks)                                                                                                                                                                                                                                        |
| `scripts/release/schema-0020.txt` / `schema-0026.txt`       | accepted schema fingerprints (1,110 / 1,216 facts: columns, constraints, indexes, triggers, functions, enums, `vo_runtime` grants), captured from a fresh PostgreSQL 18.1 migration of this repository                                                                                                                                                |
| `scripts/release/migrate-production.py`                     | Rhys's operator runner: hidden prompt for the owner URL; refuses unless `neondb_owner`, unpooled, **positively the production target (§2a)**, exactly 0020; branch-name checkpoint, then `MIGRATE`; runs `db:migrate` with `VO_APP_DB_ROLE=vo_runtime`; re-verifies the target; verifies 0026 and the new grants; holds the credential only in memory |
| `scripts/release/neon_target.py` / `production-target.json` | (R2B) target identity: the accepted production host, port, database and Neon server identity; used by the runner and by every production `release-check.py` run                                                                                                                                                                                       |
| `scripts/release/release-check.py evidence --endpoint ep-…` | (R2B) read-only `post` checks on **another** branch of the production project, which must be positively not production — forensic evidence only                                                                                                                                                                                                       |
| `scripts/release/selftest-branch-targeting.py`              | (R2B) non-production test of the wrong-branch failure mode: two byte-identical 0020 clusters differing only in server identity (12 checks)                                                                                                                                                                                                            |

### 2a. Target identity — which Neon branch (R2B)

A Neon branch is a byte-identical clone of its parent: same database name, schema, migration state, PostgreSQL
version, roles and rows. None of those can tell production from a fresh branch, which is how the aborted R2 migrated
the recovery branch. What does distinguish them, and what is now required:

| Signal                 | Source                                                                                                                     | Proves                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Host                   | the connection URL: `ep-<endpoint>[-pooler].<region>.aws.neon.tech`; every branch has its own compute endpoint (Neon docs) | which endpoint the client addressed                      |
| `neon.endpoint_id`     | server `pg_catalog.pg_settings`, source `configuration file`, superuser context                                            | which compute answered                                   |
| `neon.branch_id`       | same, postmaster context                                                                                                   | which branch (timeline) that compute serves              |
| `neon.project_id`      | same, postmaster context                                                                                                   | which Neon project                                       |
| database               | `current_database()`                                                                                                       | which database                                           |
| Branch **name** `main` | not visible to SQL — human-confirmed in the Console (R2B) and pinned to the IDs in `production-target.json`                | that `br-tiny-star-b7b8d3bh` is the branch called `main` |

Accepted production target (`scripts/release/production-target.json`, read-only capture + Console confirmation, R2B):
project `delicate-resonance-93129287`, branch `main` = `br-tiny-star-b7b8d3bh`, endpoint `ep-old-mode-b7jl3rd0`, host
`ep-old-mode-b7jl3rd0.c-13.us-east-1.aws.neon.tech:5432`, database `neondb`. Settings not from the configuration file
(e.g. a client `options=-c`) are refused; the Neon settings are postmaster/superuser context and cannot be overridden by
`neondb_owner` or `vo_runtime`. There is no override flag for the production target. What this does **not** prove:
that the branch is still called `main` in the Console (a rename would not change the IDs — the Console check in §4
covers it); anything about which branch a Console password reset was applied to (§4, human checkpoint).

### Changes to the production check scripts (`~/.cardaxia-4d9m`)

| Old check (n1c-check.py / s2check.py)                                                                                                                        | What it proved                      | 4D.10 treatment                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| migration hashes = repository, `len(local) == 21`                                                                                                            | production at the repository head   | **split by state**: `pre` = production equals repository 0000–0020 (21 rows) and the checkout is the 0026 release; `post` = equals 0000–0026 (27) and the first 21 are the baseline's. A plain 21 → 27 would fail pre-release and could pass a partial migration                         |
| row md5 over **all** columns                                                                                                                                 | every factual row unchanged         | `post` hashes baseline tables over their **baseline columns**; the three added columns are checked separately (exist, exactly these three, NULL on every row); new tables must be empty                                                                                                  |
| trajectory constraints exact (`schema_expect.py`, 0019/0020)                                                                                                 | 0020 schema correct (version-aware) | superseded by an exact **full-schema** fingerprint for each state (includes those constraints and PG18 NOT NULL constraints)                                                                                                                                                             |
| `vo_runtime` least privilege + `db:check-role`                                                                                                               | runtime cannot escalate             | unchanged, both modes; **plus** exact `vo_runtime` table grants via the schema fingerprint (catches missing grants on new tables and any extra privilege)                                                                                                                                |
| no other connections as `neondb_owner` / `vo_app`                                                                                                            | runtime identity separation         | **defect fixed**: as `vo_runtime`, other roles' sessions show `backend_type` NULL, so the old `backend_type = 'client backend'` filter could never see an owner session (past PASSes were vacuous). Now counts sessions with a visible role and a client or hidden backend type          |
| stored PDFs byte-match their SHA-256; none missing                                                                                                           | issued reports intact               | unchanged; `post` also requires the issued-report list identical to the baseline                                                                                                                                                                                                         |
| factual compare vs baseline, auth/session activity separate                                                                                                  | no unintended data change           | `pre` compares with the **4D.10 pre-release production baseline** (R2A). The 4D.9N freeze (`n1c-freeze.json`, 618 rows) stays the historical reference, used only by `reconcile`. `post` compares with the PRE-published release baseline. Audit rows since must be sign-in/session only |
| N.1C `pre` (5 projects, 18 points, DEMO-TRAJ2 absent), `post` (DEMO-TRAJ2 attribution), s2check continuity (0 points, 0 classified, 15 printed fingerprints) | one-off historical states           | **retired**: they cannot describe production before or after 4D.10. Both old scripts now refuse to run (originals kept as `*.bak-4d10r1`); `n1c-check.py snapshot` (unchanged formula) still works                                                                                       |
| DEMO projects                                                                                                                                                | —                                   | **new**: DEMO-TRAJ and DEMO-TRAJ2 (`8f635bdf…`) must be present (production runs only)                                                                                                                                                                                                   |
| PostgreSQL major version                                                                                                                                     | —                                   | **new**: must be 18 (the accepted fingerprints were captured on 18)                                                                                                                                                                                                                      |
| —                                                                                                                                                            | —                                   | **new (R2B)**: target identity (§2a) on every production run; public tables/views counted from `pg_class` (any owner, any privilege) — `information_schema` hides tables `vo_runtime` has no grant on, so a bare owner-created table was invisible to the fingerprint                    |

### Validation (PostgreSQL 18.1, local; data seeded by the production code `b7d0c46`)

| Case                                     | Expected | Result                                                                                               |
| ---------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| 0020 production-shaped database → `pre`  | PASS     | PASS (21 rows, 1,110 schema facts, 885 rows identical to its freeze, 3 PDFs)                         |
| same 0020 database → `post`              | FAIL     | FAIL (head 21, 106 schema facts missing, new tables/columns missing)                                 |
| after `db:migrate` to 0026 → `post`      | PASS     | PASS (27 rows, 1,216 facts, new tables empty, 3 new columns null, every row identical)               |
| same 0026 database → `pre`               | FAIL     | FAIL (head, 106 unexpected facts; all-column hashing would show 103 rows "changed" — the old defect) |
| 0026 + a factual row altered             | FAIL     | FAIL (project 1 changed)                                                                             |
| 0026 + `GRANT TRUNCATE` to `vo_runtime`  | FAIL     | FAIL (grant fact differs)                                                                            |
| 0026 + a new column set on an old row    | FAIL     | FAIL (internal_review_status 1 non-null)                                                             |
| 0026 − one 4D.10 trigger                 | FAIL     | FAIL (1 schema fact missing)                                                                         |
| 0026 − last migration row (partial head) | FAIL     | FAIL (26 rows)                                                                                       |
| 0026 + a live `neondb_owner` session     | FAIL     | FAIL (after the visibility fix; the old filter passed it)                                            |
| 0020 + a factual row altered → `pre`     | FAIL     | FAIL (evidence 1 changed)                                                                            |
| runner on 0020 (rehearse)                | migrate  | 0020 → 0026, grants applied, then `post` PASS                                                        |
| runner on 0026 / non-local rehearse URL  | STOP     | STOP / STOP                                                                                          |
| runner where the grant step fails        | STOP     | STOP "migration failed — do not retry" (observed on a cluster without `vo_runtime`)                  |

## 3. Recovery branch

- Name: **`pre-4d10-release-r2-YYYY-MM-DD`** (UTC date of creation), created by Rhys in the Neon Console from `main`
  **after** a fresh strict PRE, **immediately before** the owner rotation and migration. (`pre-4d10-release-2026-10-05`
  is invalid as a recovery point — migrated to 0026 in the aborted R2 — and is preserved, untouched, as evidence.)
- Keep `post-4d9n-freeze-2026-10-04` (earlier point) and do not delete any of these branches.
- Creating a branch leaves the Console **on the new branch**. Before anything else, switch back to `main` (§4 step 1).
- Verify before continuing (Rhys in the Console; Claude reads nothing secret): branch exists, parent = production
  branch, created after the preflight time, status ready. Optionally Rhys connects to the branch read-only and runs
  `select count(*) from drizzle.__drizzle_migrations` (expect 21).
- STOP if the branch cannot be created or verified.

## 4. Security B4 — owner credential (one exposure), with a deliberate switch back to `main`

Neon roles belong to a branch and password resets are **branch-scoped** (Neon docs, Manage roles). The aborted R2 reset
the recovery branch's `neondb_owner`, not production's. The sequence below is strict; each step is one deliberate
Console action.

1. **Rhys — leave the recovery branch.** Branches → click **`main`**. Confirm the branch selector / breadcrumb reads
   `main` and the branch overview shows ID `br-tiny-star-b7b8d3bh` and compute `ep-old-mode-b7jl3rd0`. Tell Claude
   "on main, IDs match" (no secrets).
2. **Rhys — rotate on `main` (B4).** Still on `main`: Roles → `neondb_owner` → Reset password. Before confirming, check
   the dialog / page names branch `main`. The historical credential (frozen in six pre-4D.9M deployments and the
   integration store) stops working.
3. **Rhys — Connect on `main`.** Connect → branch **`main`** (check the dialog's branch field), database `neondb`, role
   `neondb_owner`, pooling **off**. The host must start `ep-old-mode-b7jl3rd0.` with no `-pooler`. Checkpoint: tell
   Claude "Connect shows main, host ep-old-mode-b7jl3rd0" (the endpoint ID is not a secret; never paste the string).
4. **Rhys (own terminal)** — run `scripts/release/migrate-production.py`; paste the string only into its hidden prompt.
   Never into Vercel, `.env*`, a file, a chat or an agent. The runner shows the **TARGET IDENTITY** table (expected vs
   actual host, port, database, `neon.project_id`, `neon.branch_id`, `neon.endpoint_id`) and refuses unless every row
   is `ok`; then shows the 0020 check; then asks for the branch name shown in Connect (`main`); only then offers
   `MIGRATE`. If anything differs: abort, do not retry, report.
5. The runner re-checks the target identity immediately before and after migrating, verifies 0026 and grants, then
   exits (credential discarded with the process). **Rhys** clears the clipboard and does not store the password.
6. **Claude** verifies without the secret: Vercel Production/Preview variable **names** unchanged (`DATABASE_URL`,
   `VO_SESSION_SECRET`, `VO_REPORT_STORAGE`, `VO_DEPLOYMENT_MODE` in Production; none in Preview/Development; no
   `DATABASE_*`/`PG*`/`POSTGRES_*` additions); `release-check.py` reports only `vo_runtime` connections; the deployment
   logs `db-role=least-privilege`.

## 5. Execution sequence (each step is a bounded action; STOP conditions in §6)

| #   | Step                             | Who                | Action / evidence                                                                                                                                                              |
| --- | -------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Release freeze                   | PMO / Rhys         | in force since **2026-10-05T09:15:57Z** (R2A): no production writes, incl. synthetic, until R4 completes                                                                       |
| 2   | Identity / state                 | Claude             | `git fetch`; `origin/main` = `b7d0c46`; local RC = the 4D.10R1 commit, clean tree; Vercel current production deployment = `b7d0c46` (`dpl_6PUB…`), Ready; variable names as §4 |
| 3   | Read-only preflight              | Claude             | `python3 scripts/release/release-check.py pre` → PASS against the 4D.10 pre-release baseline; release baseline published only on PASS                                          |
| 4   | Recovery branch                  | Rhys               | create + verify `pre-4d10-release-r2-YYYY-MM-DD` (§3)                                                                                                                          |
| 5   | Back to `main`, rotate (B4)      | Rhys               | §4 steps 1–3 (switch to `main`, confirm IDs, reset on `main`, Connect on `main`) — Claude confirms each checkpoint before the next                                             |
| 6   | Migration 0020 → 0026            | Rhys               | `python3 scripts/release/migrate-production.py`: TARGET IDENTITY all `ok` → 0020 → branch name `main` → `MIGRATE` (§4 step 4)                                                  |
| 7   | Schema / migration verification  | runner + Claude    | runner: head 0026 + grants; then step 8                                                                                                                                        |
| 8   | Factual-row comparison           | Claude             | `release-check.py post` → PASS (also covers steps 9–11)                                                                                                                        |
| 9   | Governance rules present         | Claude             | via the 0026 schema fingerprint (all 4D.10 triggers/functions exact). No production writes are used to exercise rules                                                          |
| 10  | Runtime grants                   | Claude             | `post`: exact `vo_runtime` grants incl. the 3 new tables; least privilege; `db:check-role`                                                                                     |
| 11  | Production checks                | Claude             | `post` RESULT PASS is the gate                                                                                                                                                 |
| 12  | Discard owner credential         | Rhys               | runner exited; clipboard cleared; nothing stored; Claude confirms §4 step 6                                                                                                    |
| 13  | Push release candidate to `main` | Claude (on PMO go) | §7                                                                                                                                                                             |
| 14  | Vercel automatic deployment      | Vercel             | §8                                                                                                                                                                             |
| 15  | Deployment health                | Claude             | §8 checks                                                                                                                                                                      |
| 16  | Smoke journey                    | Rhys + Claude      | §9 (read-only)                                                                                                                                                                 |
| 17  | Report / hash verification       | Claude             | `release-check.py post` again after the smoke → PASS (sign-in activity only)                                                                                                   |
| 18  | Release record                   | Claude             | `docs/release/4d10-release-record.md`: timings, deployment id, check outputs (scrubbed), recovery branch name                                                                  |

Old code runs against the new schema only between steps 6 and 14 (frozen window; degraded but safe — see §10).

## 6. STOP conditions — do not improvise past any of them

- `origin/main` ≠ `b7d0c46`, or the RC ancestry/hashes differ, or the checkout is not clean.
- `pre` FAIL for any reason: head not exactly 0020 / hashes differ; schema not exactly `schema-0020.txt`; factual rows
  differ from the 4D.10 pre-release production baseline (other than sign-in activity — any factual write after the
  freeze is a STOP); PDFs fail; `vo_runtime` privileges or connections wrong. Never re-baseline during the release.
- Recovery branch cannot be created or verified.
- Any target identity check fails (§2a): in `pre`/`post`, or in the runner — **including a 0020 database that is not
  `main`**. Never edit `production-target.json` during a release to make it pass.
- The Console cannot be confirmed to be on `main` before the owner reset or the Connect step.
- Owner rotation fails, or the new credential is the pooled URL / not `neondb_owner` (the runner refuses).
- The runner STOPs, or any migration fails — **do not retry**; PMO decides between continuing investigation, reversal
  SQL, or restoring the recovery branch.
- `post` FAIL: head/hashes ≠ 0026; schema ≠ `schema-0026.txt`; any pre-existing factual row changed; new columns
  non-null; new tables not empty; `vo_runtime` grants missing or extra; report hashes changed.
- The current production application becomes unhealthy before deployment.
- Any owner credential appears in Vercel or any runtime configuration, or an owner/`vo_app` session appears in
  `pg_stat_activity` after step 12.

## 7. Git release method (no Preview deployment)

Only `main` is pushed, and only the reviewed commit, fast-forward:

```
git fetch origin
git rev-parse origin/main                       # must be b7d0c46…
git merge-base --is-ancestor origin/main <RC>   # must succeed
git log --oneline origin/main..<RC>             # exactly the reviewed commits, bd71123 … 4D.10R2B
git push origin <RC>:refs/heads/main            # fast-forward only; never --force; no other branch pushed
```

No merge commit is created (ancestry preserved; nothing newer or unreviewed enters). Pushing any other branch would
create a Vercel Preview deployment — not done.

## 8. Vercel expectations (step 14–15)

- One new **Production** deployment built from `<RC>` (project `value-office-cdx`, team `cardaxia`), state Ready.
- Environment unchanged (names as §4); startup log `[value-office] configuration ok … db-role=least-privilege`.
- `GET /api/health` 200; only `vo_runtime` client sessions; no build of any other branch.
- Rollback target if needed: the `b7d0c46` deployment (`dpl_6PUB…`) via Instant Rollback (safe family; never a
  pre-4D.9M deployment).

## 9. Production smoke journey (read-only; synthetic projects only)

Signed in as Rhys (no new account, no real client data, no writes):

1. Sign in; projects list shows DEMO-TRAJ and DEMO-TRAJ2.
2. DEMO-TRAJ: Overview (value position, governance strip, trajectory, latest decision; a historical decision with no
   Value Change reads "To be determined" and the next action may suggest determining it — do **not** act on it),
   Mobilisation, Value Case Definition, Value Case (Evolution, Value Change
   history), Assurance (landing, a finalised review: reasoning, matters, forecast position, options, issued
   recommendation with no internal-review history, decision, Value Case impact), Evidence, Information Requests,
   Value Drivers, Reports (open an issued report PDF), History.
3. DEMO-TRAJ2: Overview, Value Case, Assurance, one finalised review.
4. Confirm the new schema is read: review pages show the recommendation state and Value Case impact sections without
   errors (they read `internal_review_status`, `recommendation_review_event`, `value_change_determination`).
5. Do **not** record a determination, submit a recommendation or open a review (no production writes).

## 10. Rollback

- **Before step 13:** the old application keeps running; the new database rules apply to it (it cannot issue a
  recommendation without internal review, prepare a decision-linked Value Change without a determination, finalise a
  moved forecast without a reason, or propose V1 without reasons). Safe; keep frozen. If the release is abandoned,
  PMO decides between leaving 0026 in place and the combined reversal SQL (0026 → 0020, rehearsed exact on PG18).
- **After deployment:** Instant Rollback to `dpl_6PUB…` (schema stays 0026 — degraded but safe as above).
- **Data restore:** PMO decision; restore `pre-4d10-release-YYYY-MM-DD` into a new branch, verify, repoint.

## 11. After the release: Mike / Jon hands-on review

- The release does **not** depend on the methodology register (`4d10-methodology-questions.md`): every open item has
  a defined, conservative MVP behaviour, and none blocks a consultant journey.
- Recommendation: **B — a revised guided trial aligned to the 4D.10 workflow**, not a repeat of the earlier Northstar
  trial. The earlier script predates rules that now hold in the database, so following it would dead-end at: V1
  proposal without driver reasons; issuing a recommendation without internal review; a review finalisation with an
  unexplained forecast movement; a Value Change prepared from a decision without a determination. The revised trial
  should follow the 4D.10I acceptance journey (`e2e/consultant-acceptance.spec.ts`) on a **new synthetic project**
  (never DEMO-TRAJ / DEMO-TRAJ2), and capture the register questions as they arise.
- The revised manual is not needed for the release itself and has not been written.
