# 4D.10G migration: recommendation internal review (0023 + 0024)

**Status: prepared and rehearsed locally. NOT applied to production** (production remains at 0020; 0021/0022 are also
held). Apply only in a PMO-authorised 4D.10 release, after 0021/0022.

## Contents

- `0023_phase4d10g_recommendation_review.sql` (generated, additive):
  - enums `recommendation_review_status` (`in_internal_review`, `returned`, `ready_to_issue`) and
    `recommendation_review_event_kind` (`submitted`, `returned`, `approved`);
  - `recommendation.internal_review_status` (nullable — null means draft, and every recommendation issued before this
    phase keeps null);
  - unique `recommendation_id_review_uq` (id, assurance_review_id) for the history FK;
  - CHECK `recommendation_issued_review_shape`: issued rows have a null status (historical) or `ready_to_issue`;
  - new insert-only table `recommendation_review_event` (recommendation, review, project, kind, note, created_by,
    created_at) with a non-blank note required for `returned`.
  - drizzle-kit emitted the unique constraint after the FK that needs it; the statement was moved earlier (same
    statements, generator ordering only).
- `0024_phase4d10g_recommendation_review_integrity.sql` (hand-written): audit trigger and insert-only guard for the
  history; `vo_recommendation_review_guard` (transitions, command, history-in-the-same-transaction, issue requires
  `ready_to_issue`, read-only while in review); option and option-path read-only gates while in review. Every function
  and trigger is new; no existing guard is replaced.

## Compatibility rule

- Recommendation issued before 4D.10G (`issued_at` set, status null) → **Issued**. No history is manufactured; it stays
  valid and immutable under the existing guards.
- Unissued recommendation (status null) → **Draft**. Prospectively it must pass internal review (submit → ready to
  issue) before it can be issued.
- No row is updated or backfilled by the migration.

## Local rehearsal (production-shaped)

Local PostgreSQL 16.15 (production runs 18.6). A database migrated to 0022 and seeded **by the accepted pre-10G code
(8c83656)**: Horizon, the compact scenarios and the canonical journey, plus three client reports issued by that code —
34 tables, 943 rows, 13 finalised reviews of 14, 49 trajectory points, 6 issued recommendations, 1 unissued draft, 6
decisions, 3 issued reports.

| Step                    | Result                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0022 → 0024             | all 34 tables row-for-row identical (rows as JSON, new column excluded); new column null on all 7 rows; history empty; migrations 23 → 25                                                          |
| Schema delta            | only the additions listed above (2 enums, 1 column, 1 table, 2 constraints on `recommendation`, 5 functions, 5 triggers)                                                                           |
| Historical              | the 6 issued recommendations read **Issued** with no history and their decisions intact; the draft reads **Draft**                                                                                 |
| Prospective             | issuing the pre-existing draft directly: `VO_INTERNAL_REVIEW_REQUIRED`; decision on draft / ready: `VO_RECOMMENDATION_REQUIRED`; submit → return → resubmit → ready → issue → decision all succeed |
| Reversal (below)        | schema and every row identical to 0022; migrations 25 → 23                                                                                                                                         |
| Re-apply after reversal | schema and data identical to the first forward run                                                                                                                                                 |

## Reversal (drizzle has no down migrations)

Owner role, one transaction, after rolling the application back to 0022-compatible code. It discards the internal
review history and any in-review state (an unissued recommendation reads as a draft again); issued recommendations and
decisions are unaffected.

```sql
BEGIN;
DROP TRIGGER vo_value_trajectory_point_review_gate ON value_trajectory_point;
DROP FUNCTION vo_value_trajectory_point_review_gate();
DROP TRIGGER vo_scenario_review_gate ON scenario;
DROP FUNCTION vo_scenario_review_gate();
DROP FUNCTION vo_recommendation_in_review(uuid);
DROP TRIGGER vo_recommendation_review_guard ON recommendation;
DROP FUNCTION vo_recommendation_review_guard();
DROP TABLE recommendation_review_event;
DROP FUNCTION vo_recommendation_review_event_guard();
ALTER TABLE recommendation DROP CONSTRAINT recommendation_issued_review_shape;
ALTER TABLE recommendation DROP CONSTRAINT recommendation_id_review_uq;
ALTER TABLE recommendation DROP COLUMN internal_review_status;
DROP TYPE recommendation_review_status;
DROP TYPE recommendation_review_event_kind;
DELETE FROM drizzle.__drizzle_migrations
 WHERE id IN (SELECT id FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 2);
COMMIT;
```

## Before a production application (not authorised now)

- Apply 0021–0024 together, migration before code (`MIGRATION_DATABASE_URL=<owner, unpooled>
VO_APP_DB_ROLE=vo_runtime npm run db:migrate`, which re-applies application-role grants to the new table; then
  `db:check-role`), per `docs/release/security-b.md`.
- Update the read-only production checks that pin the migration head at 0020.
- Sequence with Security B4 (owner credential rotation), which is paused.
- Rehearse once more on PostgreSQL 18 if available.
