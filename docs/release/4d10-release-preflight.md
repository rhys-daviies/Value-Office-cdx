# 4D.10 production release — preflight plan (PREPARED, NOT EXECUTED)

**Status: plan only.** Nothing here has been run against production. No credential has been requested or rotated, no
migration applied, nothing pushed or deployed. Execution needs a PMO decision and a scheduled release window.

## What is released

| Item                 | Value                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Production today     | `main` = `b7d0c46`, migration head **0020** (21 rows in `drizzle.__drizzle_migrations`), runtime `vo_runtime` |
| Code to release      | the 4D.10 stack `bd71123` → `9781c4f` → `098aa48` → `851d749` → `8c83656` → `4256329` → `fa017b6` → 4D.10I    |
| Migrations           | `0021`–`0026` (additive; no backfill; prospective rules only)                                                 |
| Expected head after  | **0026**, **27** rows; last tag `0026_phase4d10h_value_change_determination_integrity`                        |
| Migration records    | `docs/release/4d10e-migration.md`, `4d10g-migration.md`, `4d10h-migration.md` (contents, reversal SQL)        |
| Full-chain rehearsal | `docs/release/4d10i-acceptance-record.md` — 0020 → 0026 on PostgreSQL 18.1, reversal and re-apply exact       |

Expected `drizzle.__drizzle_migrations.hash` (= SHA-256 of each file) for the new rows, first 16 hex characters:

| Migration | Hash prefix        |
| --------- | ------------------ |
| 0021      | `32f092e1d4ed3646` |
| 0022      | `bf132649b79c8839` |
| 0023      | `f8c3a1f23d323c4a` |
| 0024      | `0d8c06da2968ecba` |
| 0025      | `02d4f98e3afd342a` |
| 0026      | `d02cea6c4a2fd4c2` |

## Credentials and identities

- Migration identity: **`neondb_owner`** on the **unpooled** host (owns the schema; required for DDL). Supplied only at
  the operator prompt — never in Vercel, the repository, logs or Claude output.
- Runtime identity: **`vo_runtime`** (pooled, least privilege). Unchanged by the release; `db:migrate` with
  `VO_APP_DB_ROLE=vo_runtime` re-applies its grants so the three new tables are covered (DML; the new tables'
  triggers make them insert-only).
- Retired/legacy: `vo_app` (password reset in B3; deletion pending B7) is not used.

## Security B4 interaction — one owner-credential exposure

B4 (rotate `neondb_owner`, store nowhere) is paused. The release needs that credential once. Combine them so the
owner credential is exposed **exactly once**:

1. Rhys rotates `neondb_owner` in the Neon Console at the start of the window (this is B4). The old credential —
   still frozen in six pre-4D.9M deployments and the integration store — stops working at this moment.
2. The new credential is typed only at the migration prompt (`MIGRATION_DATABASE_URL=<owner, unpooled>`), used for
   the migration and the owner-only postflight queries in the same session, then discarded (not stored, per B4).
3. No other step needs the owner credential (preflight/postflight checks run read-only as `vo_runtime`).

If B4 is not approved for the same window, the migration uses the current owner credential once and B4 remains a
separate, later exposure (two exposures in total).

## Sequence

0. **Freeze.** Agree a window; consultants make no changes during it (the old code runs briefly against the new
   schema between steps 3 and 5 — see "Compatibility window").
1. **Recovery point.** Rhys creates a Neon branch from production immediately before the window (B1 convention, e.g.
   `pre-4d10-release-YYYY-MM-DD`); `post-4d9n-freeze-2026-10-04` stays as the earlier point. Do not delete either.
2. **Preflight (read-only, `vo_runtime`).** Run the queries below and capture a fingerprint baseline
   (`n1c-check.py snapshot`).
3. **Migrate (owner).**
   `MIGRATION_DATABASE_URL=<owner, unpooled> VO_APP_DB_ROLE=vo_runtime npm run db:migrate` from a checkout of the
   release commit; then `db:check-role` as `vo_runtime`.
4. **Postflight (read-only).** Queries below; fingerprint compare (with the new columns excluded — see "Checks to
   update").
5. **Deploy.** Merge the 4D.10 stack to `main` and push; Vercel builds the Production deployment. Confirm the
   deployment id, startup log `db-role=least-privilege`, only `vo_runtime` sessions, `/api/health`.
6. **Smoke (read-only).** Open DEMO-TRAJ and DEMO-TRAJ2 Overview / Value Case / Assurance / an issued report PDF; no
   writes. Unfreeze.

Pushing the release branch first would create a Vercel **Preview** deployment (Preview has no database variables);
push only `main`, after step 4, unless PMO decides otherwise on Preview deployments.

## Preflight queries (read-only)

```sql
SELECT count(*) AS migrations, max(created_at) AS head FROM drizzle.__drizzle_migrations;     -- 21 rows (0020)
SELECT count(*) FROM report_issue i
 WHERE NOT EXISTS (SELECT 1 FROM report_document d WHERE d.key = i.document_key AND d.sha256 = i.document_sha256); -- 0
SELECT count(*) FILTER (WHERE issued_at IS NULL) AS unissued_recommendations FROM recommendation; -- will need internal review before issue
SELECT count(*) FROM decision d WHERE NOT EXISTS (SELECT 1 FROM value_change c WHERE c.decision_id = d.id); -- will need a determination before a Value Change
SELECT r.id FROM assurance_review r WHERE r.status = 'draft';                                  -- open drafts (new finalisation gates apply)
SELECT to_regclass('value_driver_exclusion'), to_regclass('recommendation_review_event'), to_regclass('value_change_determination'); -- all NULL
SELECT code FROM project ORDER BY code;                                                         -- DEMO-TRAJ, DEMO-TRAJ2, …
```

## Postflight queries (read-only unless marked)

```sql
SELECT count(*) FROM drizzle.__drizzle_migrations;                                             -- 27
SELECT left(hash, 16) FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 6;      -- the six prefixes above
SELECT (SELECT count(*) FROM value_driver_exclusion), (SELECT count(*) FROM recommendation_review_event),
       (SELECT count(*) FROM value_change_determination);                                       -- 0, 0, 0
SELECT count(*) FROM value_driver_version WHERE adjustment_rationale IS NOT NULL;               -- 0
SELECT count(*) FROM value_position WHERE value_leakage_id IS NOT NULL;                         -- 0
SELECT count(*) FROM recommendation WHERE internal_review_status IS NOT NULL;                   -- 0
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
  'vo_version_rationale_gate','vo_review_value_rationale_gate','vo_value_driver_exclusion_guard',
  'vo_recommendation_review_guard','vo_recommendation_review_event_guard','vo_scenario_review_gate',
  'vo_value_trajectory_point_review_gate','vo_value_change_determination_guard','vo_value_change_impact_gate',
  'vo_review_recommendation_gate');                                                             -- 10 (plus 3 new vo_audit)
SELECT has_table_privilege('vo_runtime', t, 'INSERT')
  FROM unnest(ARRAY['value_driver_exclusion','recommendation_review_event','value_change_determination']) t; -- true ×3
```

Plus: `db:check-role` (least privilege unchanged), the fingerprint compare (every pre-existing row identical), and
stored-PDF integrity (every issued report's bytes match its SHA-256).

## Checks to update before the window (not changed in 4D.10I)

- `~/.cardaxia-4d9m/n1c-check.py` and `s2check.py` assert `len(local) == 21` and label the head "0020"; change to 27 /
  "0026" for postflight (keep 21 / 0020 for the preflight run).
- Their compare fingerprints hash **every column**; the three new nullable columns (`value_driver_version
.adjustment_rationale`, `value_position.value_leakage_id`, `recommendation.internal_review_status`) would make
  those tables read as changed. Exclude those columns in the post-migration compare, or re-capture the baseline
  immediately after migration (before deploy) and compare against it.
- `secA-baseline.json` / `secA-roles.py`: add the three new tables to the expected `vo_runtime` privilege set.

## Compatibility window and rollback

- **Old code on the new schema (between migrate and deploy, or after an app rollback):** safe but degraded. Reads
  work; the new database rules still apply, so the old UI cannot issue a recommendation without internal review,
  prepare a decision-linked Value Change without a determination, finalise a moved forecast without a reason, or
  propose V1 without reasons. No data is corrupted. Keep the window short and frozen.
- **Application rollback:** Vercel Instant Rollback to the newest deployment in the safe family (built with
  `vo_runtime`, e.g. the `b7d0c46` deployment `dpl_6PUB…`); never to a pre-4D.9M deployment. The schema stays at
  0026 (degraded-but-safe, above).
- **Schema rollback (PMO decision):** roll the application back first, then as owner run the combined reversal
  0026 → 0020 (the three records' reversal SQL, applied 4D.10H, then 4D.10G, then 4D.10E). It discards 4D.10
  governance records created since the release (reasons, internal review history, determinations); everything else
  is untouched. Rehearsed exactly on PostgreSQL 18.1.
- **Data restore (PMO decision):** restore the pre-release Neon branch into a new branch, verify, repoint — loses
  changes since the recovery point.

## Not covered here

Security B3 follow-up (B5–B8), Preview-deployment policy, and Mike/Jon methodology questions
(`docs/release/4d10-methodology-questions.md`) are separate decisions.
