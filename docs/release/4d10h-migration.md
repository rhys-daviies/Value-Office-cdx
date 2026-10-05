# 4D.10H migration: Value Change determination (0025 + 0026)

**Status: prepared and rehearsed locally. NOT applied to production** (production remains at 0020; 0021–0024 are also
held). Apply only in a PMO-authorised 4D.10 release, after 0021–0024.

## Contents

- `0025_phase4d10h_value_change_determination.sql` (generated, additive):
  - enum `value_change_determination_kind` (`no_value_change_required`, `value_change_proposed`);
  - unique `decision_id_review_uq` (decision id, assurance_review_id) for the determination FK;
  - new insert-only table `value_change_determination` (project, review, decision, determination, rationale,
    created_by, created_at): unique per decision; FK to the decision **of the same review**; non-blank rationale CHECK.
  - drizzle-kit emitted the unique constraint after the FK that needs it; the statement was moved earlier (same
    statements, generator ordering only — as in 0023).
- `0026_phase4d10h_value_change_determination_integrity.sql` (hand-written, new functions and triggers only):
  - audit trigger and `vo_value_change_determination_guard` (insert-only; only `valueChange.determineImpact`; actor);
  - `vo_value_change_impact_gate` on `value_change` insert, and on update when `decision_id` changes: a Value Change
    citing a decision needs that decision's determination to be `value_change_proposed`;
  - `vo_review_recommendation_gate` on `assurance_review`: no finalisation while the recommendation is in internal
    review or ready to issue.

## Compatibility rule

- Decisions recorded before 4D.10H have no determination and stay valid; none is manufactured.
- Existing Value Changes (including decision-linked ones and authorised V2s) are never re-checked; the gate fires only
  when a Value Change is created, or its `decision_id` is changed, from now on.
- Value Changes that cite no decision (the existing ad hoc route) are unaffected.
- Review finalisation is unchanged for no / draft / returned / issued recommendations.

## Local rehearsal (production-shaped)

Local PostgreSQL 16.15 (production runs 18.6). A database migrated to 0024 and seeded **by the accepted 4D.10G code
(4256329)**: Horizon, the compact scenarios and the canonical journey, three client reports issued by that code, and
one recommendation put into internal review by that code — 35 tables, 1,013 rows, 6 decisions (none determined), 5
Value Changes (4 citing a decision; 2 authorised V2s), 13 review-history events.

| Step                    | Result                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0024 → 0026             | all 35 tables row-for-row identical; `value_change_determination` empty; migrations 25 → 27                                                                                        |
| Schema delta            | only the additions above (1 enum, 1 table, 1 constraint on `decision`, 3 functions, 4 triggers)                                                                                    |
| Historical              | 6 decisions without a determination read correctly (awaiting / change in progress / change authorised); a historical draft decision-linked Value Change stays editable             |
| Finalisation            | the review whose recommendation is in internal review: `VO_RECOMMENDATION_REVIEW_INCOMPLETE`                                                                                       |
| Prospective             | No Value Change Required recorded; a second determination `VO_DETERMINATION_EXISTS`; a Value Change from that decision `VO_NO_VALUE_CHANGE_DETERMINED`; Authorised Value unchanged |
| Reversal (below)        | schema and every row identical to 0024; migrations 27 → 25                                                                                                                         |
| Re-apply after reversal | schema and data identical to the first forward run                                                                                                                                 |

## Reversal (drizzle has no down migrations)

Owner role, one transaction, after rolling the application back to 0024-compatible code. It discards recorded
determinations; decisions, Value Changes and versions are unaffected.

```sql
BEGIN;
DROP TRIGGER vo_review_recommendation_gate ON assurance_review;
DROP FUNCTION vo_review_recommendation_gate();
DROP TRIGGER vo_value_change_impact_gate ON value_change;
DROP FUNCTION vo_value_change_impact_gate();
DROP TABLE value_change_determination;
DROP FUNCTION vo_value_change_determination_guard();
ALTER TABLE decision DROP CONSTRAINT decision_id_review_uq;
DROP TYPE value_change_determination_kind;
DELETE FROM drizzle.__drizzle_migrations
 WHERE id IN (SELECT id FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 2);
COMMIT;
```

## Before a production application (not authorised now)

- Apply 0021–0026 together, migration before code (`MIGRATION_DATABASE_URL=<owner, unpooled>
VO_APP_DB_ROLE=vo_runtime npm run db:migrate`, which re-applies application-role grants; then `db:check-role`).
- Update the read-only production checks that pin the migration head at 0020.
- Sequence with Security B4 (owner credential rotation), which is paused.
- Rehearse once more on PostgreSQL 18 if available.
