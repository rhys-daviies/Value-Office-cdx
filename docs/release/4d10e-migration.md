# 4D.10E migration: governed value movements (0021 + 0022)

**Status: prepared and rehearsed locally. NOT applied to production** (production remains at 0020 until PMO
authorises a release that includes the 4D.10 stack).

## Contents

- `0021_phase4d10e_governed_movements.sql` (generated, additive):
  - `value_driver_version.adjustment_rationale text` (nullable);
  - `value_position.value_leakage_id uuid` (nullable) + FK `value_position_matter_fk` → `value_leakage(id, project_id)`;
  - new table `value_driver_exclusion` (version, driver, rationale; unique per version and driver; non-blank CHECK).
- `0022_phase4d10e_governed_movements_integrity.sql` (hand-written): audit trigger and guard for
  `value_driver_exclusion`; gates `vo_version_rationale_gate` (V1 proposal) and `vo_review_value_rationale_gate`
  (review finalisation). No existing function is replaced; no existing row is updated.

No backfill, no destructive change, no change to locked versions, finalised reviews, issued reports or trajectory
points. Application-role grants are re-applied by `db:migrate` when `VO_APP_DB_ROLE` is set (covers the new table).

## Local rehearsal (production-shaped)

Local PostgreSQL 16.15 (production runs 18.6). A database migrated to 0020 and seeded **by the production code
(b7d0c46)**: the canonical journey (as DEMO-TRAJ, V2 authorised, three finalised reviews, three issued reports with
PDFs), Horizon, and the compact Office / Evolution / Decision / Trajectory / Draft scenarios — 33 tables, 632 rows,
11 finalised reviews, 13 locked versions, 35 trajectory points.

| Step                    | Result                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0020 → 0022             | every one of the 33 tables row-for-row identical (rows as JSON, new nullable columns excluded); new columns all null; `value_driver_exclusion` empty; migrations 21 → 23 |
| Historical validity     | 18 finalised positions moved their forecast without a reason — untouched and valid                                                                                       |
| Prospective             | a new review on the migrated canonical project: finalisation refused without a reason (`VO_FORECAST_RATIONALE_REQUIRED … VD-02`), finalised with one                     |
| Reversal (below)        | schema (columns, triggers, functions, constraints) and every row identical to 0020; migrations 23 → 21                                                                   |
| Re-apply after reversal | identical to the first forward run                                                                                                                                       |

## Reversal (drizzle has no down migrations)

Owner role, one transaction. It discards any adjustment rationale, not-carried-forward reasons and forecast-to-matter
links recorded after the migration; locked versions and finalised reviews are otherwise unaffected.

```sql
BEGIN;
DROP TRIGGER vo_review_value_rationale_gate ON assurance_review;
DROP FUNCTION vo_review_value_rationale_gate();
DROP TRIGGER vo_version_rationale_gate ON value_case_version;
DROP FUNCTION vo_version_rationale_gate();
DROP TABLE value_driver_exclusion;
DROP FUNCTION vo_value_driver_exclusion_guard();
ALTER TABLE value_position DROP CONSTRAINT value_position_matter_fk;
ALTER TABLE value_position DROP COLUMN value_leakage_id;
ALTER TABLE value_driver_version DROP COLUMN adjustment_rationale;
DELETE FROM drizzle.__drizzle_migrations
 WHERE id IN (SELECT id FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 2);
COMMIT;
```

The application code must be rolled back to a 0020-compatible deployment first (the 4D.10E code writes the new
columns).

## Before a production application (not authorised now)

- Migrate before deploying code that needs the schema (`MIGRATION_DATABASE_URL=<owner, unpooled>
VO_APP_DB_ROLE=vo_runtime npm run db:migrate`, then `db:check-role`), per `docs/release/security-b.md`.
- Update the read-only production checks that pin the migration head at 0020 / 21 hashes.
- Sequence with Security B4 (owner credential rotation), which is paused.
