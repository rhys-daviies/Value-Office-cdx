# 4D.10 production release record

## R2 — production database release: STOPPED at PRE (2026-10-05)

**Outcome: STOP at procedure step 3 (`release-check.py pre` FAIL). Nothing in production was changed.** No recovery
branch created, no owner credential rotated or requested, no migration run, nothing pushed or deployed.

| Item                      | Result                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release freeze (09:01Z)   | PASS — tree clean; `origin/main` = `b7d0c46` (fetched); `0ebde60` descends from it; exactly the 9 reviewed commits; 0021–0026 hashes = accepted                                                                                                                                             |
| Production identity       | PostgreSQL 18.6 (`180006`); `vo_runtime`, read-only session; database `neondb`; head 0020 (21 rows, hashes = repository 0000–0020); no `neondb_owner` / `vo_app` sessions; DEMO-TRAJ `90276823…` and DEMO-TRAJ2 `8f635bdf…` present                                                         |
| Application               | unchanged: Production deployment `dpl_6PUBbKWZ2HC6Wb1uju5MRVSdbUvr` (`b7d0c46`), Ready                                                                                                                                                                                                      |
| PRE (09:01:30Z–09:03:38Z) | **FAIL** — see below. All other checks PASS: schema exactly `schema-0020.txt` (1,110 facts; no PostgreSQL 18.6 vs 18.1 difference), every frozen row byte-identical, 3 stored PDFs match their SHA-256, issued-report inventory unchanged, `vo_runtime` least privilege and `db:check-role` |

### PRE differences (factual rows added since the 4D.9N freeze, audit id > 365)

All by **Rhys Davies**, through normal application commands, on the synthetic project **DEMO-TRAJ2** only:

| UTC                     | Command                                                                                                      | Effect                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 2026-10-04 21:29, 22:01 | `auth.signIn` ×2                                                                                             | sign-in (permitted)                                                                |
| 2026-10-04 22:06        | `driver.initialiseRecord`                                                                                    | VD-01 living record created                                                        |
| 2026-10-05 00:29        | `driver.updateWorking`                                                                                       | VD-01 working record updated                                                       |
| 2026-10-05 00:31–00:42  | `matter.create`, `matter.assessWorking` ×2, `matter.setRemediation` ×2, `matter.setOwner`, `matter.setStage` | matter VL-002 (open, escalated)                                                    |
| 2026-10-05 00:45–00:54  | `assurance.createReview`, `assurance.updateReview` ×2, `assurance.linkEvidence`                              | draft Assurance Review #4 (material evidence change) with one review evidence link |
| 2026-10-05 00:56        | `leakage.update`, `leakage.setDrivers`                                                                       | VL-002 details and drivers                                                         |

Added rows: `assurance_review` 1, `evidence_link` 1, `value_leakage` 1, `value_leakage_driver` 2,
`value_driver_record` 1 (plus their audit rows and 2 sessions). No row of the freeze changed; no report issued.

Other production context (unchanged by this phase): draft reviews exist on BOTOX (#1), SALES-INITIATIVE (#1), DEMO-TRAJ
(#4) and DEMO-TRAJ2 (#4); after the release, finalising them is subject to the 4D.10 rules.

### Handling

- Per the procedure: no re-baseline, no edit to the checker or `schema-0020.txt`, no further steps.
- The baseline `pre` writes on every run was renamed `4d10-release-baseline.UNACCEPTED-pre-FAIL-2026-10-05T0903Z.json`
  (local, `~/.cardaxia-4d9m`) so `post` cannot use it.
- PMO decision requested (taken in R2A, below).

| Later item                           | Status                       |
| ------------------------------------ | ---------------------------- |
| Recovery branch `pre-4d10-release-*` | not created                  |
| Security B4 (owner rotation)         | not started                  |
| Migration 0020 → 0026                | not run (head 0020, 21 rows) |
| POST / grants / factual preservation | not applicable               |
| Old app on 0026                      | not applicable               |

## R2A — production baseline reconciliation (2026-10-05)

**PMO decisions:** accept the post-4D.9N DEMO-TRAJ2 activity as legitimate synthetic activity subject to independent
reconciliation; never rewrite the 4D.9N freeze; create a separate **4D.10 pre-release production baseline**; freeze
production from the successful release PRE until R2/R3/R4 complete; harden `release-check.py` so a failed PRE cannot
leave a consumable baseline. No migration, credential, recovery-branch or deployment action.

### Reconciliation — `release-check.py reconcile` (read-only, writes nothing): PASS

| Statement                | Result                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Migration state / schema | head 0020, 21 rows, hashes = repository; schema exactly `schema-0020.txt` (1,110 facts)                                                  |
| Frozen factual rows      | none modified, none deleted                                                                                                              |
| New factual rows         | 6, all owned by DEMO-TRAJ2 (`8f635bdf…`); no other project changed                                                                       |
| Traceability             | every new row has an INSERT audit since the freeze by an application command                                                             |
| Audit                    | 22 rows (id 366–388), 2026-10-04 21:29:18Z → 2026-10-05 00:56:11Z, every row names its command, actor **Rhys Davies** only               |
| Updates / deletes        | only on rows created since the freeze (VL-002's two original driver links, created by `matter.create`, replaced by `leakage.setDrivers`) |
| Reports                  | none issued; report_issue 3 / report_document 3; inventory and SHA-256 identical                                                         |

New rows: `assurance_review` 53bb328a… (DEMO-TRAJ2 draft Review #4: `assurance.createReview`, `updateReview` ×2);
`evidence_link` df48dd9e… (`assurance.linkEvidence`); `value_driver_record` aa78b1c4… (VD-01: `driver.initialiseRecord`,
`updateWorking`); `value_leakage` 38f3e3cb… (VL-002: `matter.create`, `assessWorking` ×2, `setRemediation` ×2,
`setOwner`, `setStage`, `leakage.update`); `value_leakage_driver` ff15ecae…, d8464047… (`leakage.setDrivers`); plus 2
sign-in sessions.

### Two references, different purposes

| Reference                                 | File (`~/.cardaxia-4d9m`)                             | Meaning                                                                                                       | State                                                  |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **4D.9N freeze**                          | `n1c-freeze.json` (sha256 `3032df3a…`)                | historical accepted production state at 4D.9N acceptance                                                      | unchanged (618 rows total, 245 factual, audit max 365) |
| **4D.10 pre-release production baseline** | `4d10-pre-release-baseline.json` (sha256 `f5f96f76…`) | accepted production state immediately before the 4D.10 migration, including the reconciled synthetic activity | captured below                                         |

### 4D.10 pre-release production baseline — `release-check.py capture`: PASS

Captured **2026-10-05T09:18:03Z** from release checkout `0ebde60`: PostgreSQL 18.6, `vo_runtime` read-only; head 0020,
21 migration rows; accepted schema sha256 `ce2e31ed8174d9d3…` (`schema-0020.txt`); 33 tables, **648 rows total, 251
factual**, audit max **388**; 3 issued reports (requalification #1, #2; information_request #1) with stored PDFs
matching their SHA-256; projects BOTOX, CUSTOMER-TRANSFORMATION-, DEMO-TRAJ (`90276823…`), DEMO-TRAJ2 (`8f635bdf…`),
E-004, SALES-INITIATIVE; `vo_runtime` least privilege, no owner / `vo_app` sessions. Envelope: kind
`4d10-pre-release-production-baseline`, accepted, accepted by PMO (4D.10R2A).

### Release freeze

Announced **2026-10-05T09:15:57Z** (before the capture). From then until R4 completes: **no production writes**,
including synthetic / demo writes. Allowed: read-only inspection, release verification, the migration, deployment and
approved read-only smoke. Any factual write after the baseline (audit id > 388) makes R2's PRE fail → STOP.

### Open draft reviews (read-only; must survive the migration unchanged)

| Project          | Review         | Status / trigger                 | Review date | Created (UTC)    | Against | Positions | Recommendation / decision | Options | Row md5     |
| ---------------- | -------------- | -------------------------------- | ----------- | ---------------- | ------- | --------- | ------------------------- | ------- | ----------- |
| BOTOX            | #1 `09dd31e0…` | draft · six_month                | 2027-03-30  | 2026-09-29 23:22 | V1      | 1         | issued / recorded         | 3       | `0e8c6def…` |
| DEMO-TRAJ        | #4 `2af7695a…` | draft · ad_hoc                   | 2026-10-03  | 2026-10-03 05:04 | V2      | 0         | none / none               | 0       | `90539009…` |
| DEMO-TRAJ2       | #4 `53bb328a…` | draft · material_evidence_change | 2026-10-05  | 2026-10-05 00:45 | V2      | 0         | none / none               | 0       | `097e5448…` |
| SALES-INITIATIVE | #1 `84d7056f…` | draft · ad_hoc                   | 2026-09-29  | 2026-09-29 22:27 | V1      | 1         | issued / recorded         | 3       | `63de53b9…` |

Not edited, finalised or deleted; no governance state manufactured. After the release their recommendations read as
issued (no internal-review history) and their decisions have no determination.

### Checker hardening (tested: `scripts/release/selftest-release-check.py`, 19/19)

`pre` publishes the release baseline only after every check passes (atomic rename); a failed run leaves only a
`*.FAILED-<time>.json` diagnostic; an existing accepted file is never replaced on failure (and only with `--replace` on
success). `post` refuses missing, malformed, unaccepted, FAILED, legacy bare-snapshot, wrong-kind, other-schema or
other-migration-state baselines. The unaccepted file left by the R2 run (`4d10-release-baseline.UNACCEPTED-pre-FAIL-…`,
no envelope) is refused by `post`.

### Status after R2A

| Item            | Status                                                                          |
| --------------- | ------------------------------------------------------------------------------- |
| Recovery branch | not created                                                                     |
| Security B4     | not started                                                                     |
| Migration       | not run (0020, 21 rows)                                                         |
| Application     | unchanged (`dpl_6PUBbKWZ2HC6Wb1uju5MRVSdbUvr`, `b7d0c46`)                       |
| Next            | restart R2 from step 1 (`pre` now compares with the 4D.10 pre-release baseline) |

## R2 restart — production database release: STOPPED at POST (2026-10-05)

**Outcome: STOP at procedure step 8 (`release-check.py post` FAIL — the production database is still at 0020).** No
retry, no re-baseline, nothing pushed or deployed. The application is unchanged (`dpl_6PUBbKWZ2HC6Wb1uju5MRVSdbUvr`,
`b7d0c46`).

| Step                         | Result                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Freeze verification (09:27Z) | PASS — tree clean; `origin/main` = `b7d0c46` (fetched); `0cb2328` descends from it; exactly the 10 reviewed commits (`bd71123` … `0cb2328`); 0021–0026 hashes = accepted; only tooling/docs since `0ebde60`; Vercel env names unchanged (4)                        |
| PRE (→ 09:29:57Z)            | **PASS** against the 4D.10 pre-release baseline: no factual row changed/added/removed, audit max 388, schema exactly 0020 (1,110), 0020 / 21, 3 PDFs match, least privilege, no owner / `vo_app` sessions, DEMO projects present                                   |
| Release baseline             | `4d10-release-baseline.json` (published by the aborted R2's PRE, repo `0cb2328`) left in place, unmodified. The fresh R2's `pre` refuses while it exists: PMO to authorise either archiving it under a new name or `pre --replace` (publishes only on a full PASS) |
| Recovery branch              | `pre-4d10-release-2026-10-05` — Rhys confirmed created and ready (after PRE); parent not yet explicitly confirmed. HUMAN CONFIRMED — no Neon API access. Production re-checked unchanged at 19:56Z                                                                 |
| B4 + runner                  | Rhys reported "success"; runner output not yet provided                                                                                                                                                                                                            |
| POST (20:01:49Z)             | **FAIL** — production `neondb` head still 0020 (21 rows, last applied before this phase), 33 tables, new tables/columns absent (106 schema facts missing). Every factual row, migration row and report still identical; no owner sessions                          |
| Re-check (20:04Z, read-only) | production still 21 migrations, 33 tables, audit max 388, nothing since the baseline                                                                                                                                                                               |

Cause: established by PMO and 4D.10R2B, below (the runner migrated the recovery branch). Old application on 0026: not
applicable (production still 0020).

## R2B — release targeting hardening after the wrong-branch migration (2026-10-05)

**Classification: RELEASE TARGETING / BRANCH IDENTITY FAILURE.** Not a migration-chain failure: 0021–0026 applied
exactly as accepted — on the wrong branch.

### Confirmed sequence

| #   | Event                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | PRE passed against production `main` at 0020 (09:29:57Z); release baseline published                                                                                             |
| B   | Recovery branch `pre-4d10-release-2026-10-05` created from `main` (Rhys, after PRE)                                                                                              |
| C   | The Neon Console remained on the recovery branch (branch creation leaves it selected)                                                                                            |
| D   | `neondb_owner` was reset while that branch was selected                                                                                                                          |
| E   | Connect supplied a connection string targeting that branch (endpoint `ep-weathered-smoke-b7i4m245`)                                                                              |
| F   | `migrate-production.py` accepted it: it checked role, unpooled host, TLS and the 0020 hashes — and a fresh branch is a byte-identical clone of production, so every check passed |
| G   | Migrations 0021–0026 applied successfully there                                                                                                                                  |
| H   | POST against actual production FAILED (20:01:49Z): production still 0020                                                                                                         |
| I   | Read-only production verification (20:04Z, and R2B) confirmed no production mutation                                                                                             |
| J   | PMO's SQL inspection of the recovery branch showed 27 migrations                                                                                                                 |
| K   | Rhys confirmed the owner reset was performed while the recovery branch was selected                                                                                              |

Root cause: the runner inferred production from the **data** (database name, role, schema, migration state, PostgreSQL
version, copied Console string), and the human sequence (create branch → stay → reset → Connect) put the Console on
the clone. Neither positively identified the **branch**.

### Production (R2B read-only, `reconcile`)

Target identity PASS (`ep-old-mode-b7jl3rd0`, `br-tiny-star-b7b8d3bh`, project `delicate-resonance-93129287`,
`neondb`); 0020 / 21; schema exactly 0020; 33 public tables (pg_class); still the same 22 reconciled audit rows since
the 4D.9N freeze, none since the accepted 4D.10 pre-release baseline (audit max 388); reports and PDFs identical; no
owner / `vo_app` sessions. The accepted baselines are unchanged.

### Recovery branch `pre-4d10-release-2026-10-05` — forensic evidence (`release-check.py evidence`, read-only)

**INVALID AS PRE-RELEASE RECOVERY POINT — MIGRATED TO 0026 DURING ABORTED R2 — PRESERVED FOR FORENSIC / MIGRATION
EVIDENCE.** Not modified, reset or deleted.

| Check                                                     | Result                                                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                                                  | branch `br-bitter-boat-b75plc9y`, endpoint `ep-weathered-smoke-b7i4m245`, project `delicate-resonance-93129287` — positively NOT `main` |
| Migrations                                                | 27; first 21 = baseline; 0021–0026 hashes = accepted                                                                                    |
| Schema                                                    | all 1,216 accepted 0026 facts present (missing 0); **4 unexpected** — `playing_with_neon` (Neon Console SQL Editor sample table)        |
| Relations (pg_class)                                      | 37 = the expected 36 + `playing_with_neon`                                                                                              |
| New tables / new columns                                  | 3 tables empty; 3 columns NULL on every row; exactly the accepted three added                                                           |
| Factual rows vs release baseline                          | all 251 present and byte-identical; none added; no audit since 388                                                                      |
| Reports, grants, least privilege, sessions, DEMO projects | identical / PASS                                                                                                                        |

Result FAIL only because of `playing_with_neon` — created on the branch after it was taken (absent from production),
not by any migration. Supplementary evidence that the 0020 → 0026 chain preserves the production data exactly; it does
not replace the production migration.

### Hardening

- **Target identity** (`neon_target.py`, `production-target.json`): host, port, database and the server's
  configuration-file `neon.project_id` / `neon.branch_id` / `neon.endpoint_id` must equal the accepted production
  target; branch name `main` pinned to those IDs by Rhys's Console confirmation. Runner: identity table shown and
  enforced before `MIGRATE` (no override), branch-name checkpoint, re-checked before and after migrating.
  `release-check.py`: the same check on every production run (a FAIL like any other); `evidence` mode for other branches.
- **Relations check**: public tables counted from `pg_class` — `information_schema` hid the ungranted
  `playing_with_neon` columns from `vo_runtime`; a bare owner-created table would have been invisible.
- **Console procedure** (`4d10-release-procedure.md` §3–4): after creating the recovery branch, switch to `main`,
  confirm IDs, reset on `main`, Connect on `main` (host `ep-old-mode-b7jl3rd0`), each confirmed to Claude before the next.
- Tests: `selftest-branch-targeting.py` 12/12 (wrong branch refused before MIGRATE, also at production's address and
  with a client spoof; unidentifiable target refused; no production override; correct target passes and migrates);
  `selftest-release-check.py` 20/20 (new case H: hidden table).

### Status after R2B

| Item             | Status                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production       | 0020 / 21, factually = accepted 4D.10 pre-release baseline; application `b7d0c46` (`dpl_6PUB…`)                                                                   |
| Release freeze   | in force since 2026-10-05T09:15:57Z                                                                                                                               |
| Security B4      | **NOT COMPLETE for production** (the reset was branch-scoped to the recovery branch)                                                                              |
| Recovery branch  | none valid for the next attempt; next: `pre-4d10-release-r2-YYYY-MM-DD` (UTC date) after a fresh strict PRE                                                       |
| Release baseline | `4d10-release-baseline.json` from the aborted R2 must not be reused: the fresh R2 runs `pre --replace` only after PMO authorisation, from a new release candidate |
| Next             | completely fresh R2 from step 1 on the R2B commit                                                                                                                 |

## R2 fresh attempt — STOPPED at PRE (2026-10-05)

**Outcome: STOP at procedure step 3 (fresh `release-check.py pre` FAIL — the release freeze was broken).** No recovery
branch, no owner reset, no migration, nothing pushed or deployed. Production unchanged apart from the writes below.

| Step                         | Result                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aborted-R2 baseline archived | `4d10-release-baseline.json` → `4d10-release-baseline.ABORTED-R2-2026-10-05.json` (byte-identical, sha256 `658a1760…`; permissions 000 so `post` cannot read it even with `--baseline` — verified refused); no canonical file left |
| Git (22:09Z)                 | PASS — clean; `origin/main` = `b7d0c46`; `87d7ff2` descends through exactly the 11 accepted commits; 0021–0026 hashes accepted; only `docs/release` / `scripts/release` since `83f1514`; target file = accepted IDs                |
| Production identity          | PASS — `ep-old-mode-b7jl3rd0`, `br-tiny-star-b7b8d3bh`, `delicate-resonance-93129287`, `neondb`:5432; PostgreSQL 18.6; 0020 / 21; Vercel `dpl_6PUB…` Ready, env names unchanged                                                    |
| Fresh PRE (→ 22:11:29Z)      | **FAIL** — factual rows added since the accepted baseline; every other check PASS (schema 0020, relations 33, no row changed/removed, reports/PDFs, least privilege, no owner / `vo_app` sessions)                                 |
| Release baseline             | not published; diagnostic `4d10-release-baseline.json.FAILED-2026-10-05T221129Z.json` only (refused by `post`)                                                                                                                     |

Freeze breach (audit id > 388, all **Rhys Davies**, through the application):

| Audit   | UTC                 | Command          | Effect                                                                                |
| ------- | ------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| 389     | 2026-10-05 21:45:24 | `auth.signIn`    | sign-in (permitted)                                                                   |
| 390–394 | 2026-10-05 22:00:04 | `project.create` | new project **PROJECT-DREAM** (`f4b55a20…`): client, project, Value Case, 2 key dates |

Per the procedure: no re-baseline, no `--replace`, no further steps. PMO decision required.

## R2C — PROJECT-DREAM accepted; pre-release baseline advanced to v2 (2026-10-05)

**PMO decision:** PROJECT-DREAM is synthetic test data — accept and preserve it; reconcile the movement since baseline
v1 and capture a successor baseline v2. No migration, credential, recovery-branch, push or deployment action.

**Data classification (this release point only):** Rhys and PMO confirm that every project currently in the Value
Office production environment is a synthetic / test project, used to confirm functionality, test the intended
operating workflow, identify product changes and support development and methodology review; there is no real client
project data in it today. PROJECT-DREAM is one such project. This describes the current environment only — it is not
a product assumption and does not relax any control intended for client data.

### Reconciliation v1 → now — `release-check.py reconcile --source` (read-only): PASS

Source: baseline **v1** `4d10-pre-release-baseline.json` (sha256 `f5f96f76…`, captured 09:18:03Z, audit max 388),
selected explicitly and pinned by sha256; strictly loaded (accepted, kind, 0020 state, hashes, schema). v1 predates the
recorded target identity, so it was proved through its connection: the Keychain item defining the production
connection is unchanged since 2026-10-02T22:58:54Z, and this run positively identified that connection as `main`
(`ep-old-mode-b7jl3rd0` / `br-tiny-star-b7b8d3bh` / `delicate-resonance-93129287` / `neondb`).

| Audit   | UTC                 | Command          | Effect                                                                                                            |
| ------- | ------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| 389     | 2026-10-05 21:45:24 | `auth.signIn`    | sign-in                                                                                                           |
| 390–394 | 2026-10-05 22:00:04 | `project.create` | PROJECT-DREAM `f4b55a20…`: client `453b593a…`, project, value_case `7f52385a…`, key_date `9ad390fb…`, `5623e529…` |
| 395     | 2026-10-05 22:14:26 | `auth.signIn`    | sign-in (after the fresh-R2 STOP; permitted, not factual)                                                         |

All by **Rhys Davies**. No v1 factual row modified or deleted; the 5 rows are the only factual additions, all owned by
PROJECT-DREAM (the client row as the project's own client) and each traced to its `project.create` INSERT; no report
issued or changed (3 / 3, PDFs match); schema exactly 0020, 33 relations; 0020 / 21; DEMO-TRAJ and DEMO-TRAJ2 and the
four open draft reviews unchanged (part of the unchanged v1 rows); no owner / `vo_app` sessions.

### Baseline v2 — `release-check.py capture --source`: PASS

`~/.cardaxia-4d9m/4d10-pre-release-baseline-v2.json`, sha256 `d820c9e5db284b67…`, captured **2026-10-05T22:38:43Z**
from release checkout `87d7ff2`: version 2, accepted by "PMO (4D.10R2C): PROJECT-DREAM accepted as synthetic test
activity"; source v1 recorded by sha256; target identity recorded; PostgreSQL 18.6; 0020 / 21; schema sha256
`ce2e31ed…`; 33 tables, **662 rows, 256 factual** (v1 + 5), audit max **395**; 3 issued reports with matching PDFs;
projects BOTOX, CUSTOMER-TRANSFORMATION-, DEMO-TRAJ `90276823…`, DEMO-TRAJ2 `8f635bdf…`, E-004, PROJECT-DREAM
`f4b55a20…`, SALES-INITIATIVE; the four open draft reviews (BOTOX #1, DEMO-TRAJ #4, DEMO-TRAJ2 #4, SALES-INITIATIVE #1)
with their row hashes. Delta from v1: client +1, project +1, value_case +1, key_date +2 (+ app_session +2, audit +7).

### Baseline hierarchy (all preserved, none rewritten)

| Reference                                   | File (`~/.cardaxia-4d9m`)                                        | State                                                     |
| ------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| 4D.9N freeze                                | `n1c-freeze.json` (`3032df3a…`)                                  | historical, unchanged                                     |
| 4D.10 pre-release baseline v1               | `4d10-pre-release-baseline.json` (`f5f96f76…`)                   | historical, unchanged (audit 388)                         |
| 4D.10 pre-release baseline **v2** (current) | `4d10-pre-release-baseline-v2.json` (`d820c9e5…`)                | current: `pre` compares with it (default)                 |
| R2 PRE-FAIL candidate                       | `4d10-release-baseline.UNACCEPTED-pre-FAIL-…T0903Z.json`         | evidence; refused by `post`                               |
| Aborted R2 release baseline                 | `4d10-release-baseline.ABORTED-R2-2026-10-05.json` (`658a1760…`) | evidence; unreadable (000), refused by `post`             |
| Fresh-R2 PRE-FAIL diagnostic                | `4d10-release-baseline.json.FAILED-2026-10-05T221129Z.json`      | evidence; refused by `post` and as a source               |
| Release baseline for the next R2            | `4d10-release-baseline.json`                                     | **does not exist** — only a fresh full-PASS PRE writes it |

### Release freeze — re-established

In force from the v2 capture, **2026-10-05T22:38:43Z**, until R4 completes: **no factual application writes** on any
project (PROJECT-DREAM, DEMO-TRAJ, DEMO-TRAJ2 or any other; no project creation or edits, Assurance, Information
Requests, Evidence, recommendations, decisions, Value Changes or reports). Permitted: sign-in, read-only release
checks, approved read-only smoke, the migration, deployment. Any factual write after audit 395 makes the fresh R2 PRE
fail → STOP.

### Status after R2C

| Item                      | Status                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Production                | 0020 / 21; factually = baseline v2; application `b7d0c46` (`dpl_6PUB…`)              |
| Recovery branch           | none created in the fresh attempt; next: `pre-4d10-release-r2-<UTC date>` after PRE  |
| Security B4               | **NOT COMPLETE for production**                                                      |
| Migration / push / deploy | none                                                                                 |
| Tooling                   | `reconcile` / `capture --source` (baseline-to-baseline); envelopes record the target |
| Next                      | completely fresh R2 from step 1 against baseline v2                                  |
