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
