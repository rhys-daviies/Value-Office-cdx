# Phase 4D.9N — ACCEPTED AND FROZEN

Executive Value Trajectory visuals on the synthetic production demo. Accepted by PMO after production visual
acceptance of DEMO-TRAJ2 (Overview / Value Trajectory, Review #2 / Alternative Value Trajectories, Value Case / Value
Case Evolution: all PASS; 0 blockers, 0 majors). No further product or visual change in this phase.

## Release lineage

| Commit    | Phase      | Content                                                                                    |
| --------- | ---------- | ------------------------------------------------------------------------------------------ |
| `5ee4167` | 4D.9M      | Previous production baseline (runtime role `vo_runtime`)                                   |
| `fde34fa` | 4D.9N.1A   | Executive trajectory visuals: monthly cursor, governed tooltips, pivot, Evolution E1 (web) |
| `22ac9a0` | 4D.9N.1B   | Review #2 Formal Forecast context in Alternative Value Trajectories                        |
| `71b7ded` | 4D.9N.1B.1 | Review #3 forecast milestone $5.0m at 31 Dec 2026 (21 canonical points)                    |
| `df6f033` | 4D.9N.1C   | Deterministic canonical dates; locked Formal Forecast wording (application release)        |
| `df2f186` | 4D.9N.1C.2 | Date-independent synthetic demo creation (fixture/tooling and docs only)                   |

Final production deployment: `dpl_2GHjactKuQEXtWofNne23ZRQyLS3` (`df2f186`, Ready, `value-office-cdx.vercel.app`).
The application release `df6f033` was deployed as `dpl_6QBmEYThTULCzSxvDzNhKWevb3Rt`; `df2f186` changed no runtime
behaviour. Database migration head 0020 (unchanged); runtime role `vo_runtime`, `db-role=least-privilege`; no
application connection as `neondb_owner` or `vo_app`.

## DEMO-TRAJ2 (permanent synthetic demo)

- Project: **Trajectory Executive Demo v2 (SYNTHETIC)**, code `DEMO-TRAJ2`, id `8f635bdf-e0a7-442a-a61a-5fe065e6e77f`;
  client Synthetic Test Client; USD; context "SYNTHETIC / INTERNAL DEMO — NOT CLIENT DATA".
- Created 2026-10-03 20:24–20:26 UTC through normal commands (`src/fixtures/demo.ts`, operator-run creator), acting as
  an existing account. Governance date G = production `current_date` = **3 Oct 2026** (decision `decidedOn`, VC-001 /
  V2 `authorisedOn`, Review #3 `reviewDate`); all system timestamps are the real creation time; the recommendation
  was issued before the decision was recorded.
- Economics: Original Business Case $32.0m → Authorised V1 $30.0m → Review #1 (31 Mar 2026) forecast $28.0m, realised
  $1.0m → Review #2 (30 Sep 2026, against V1) forecast $26.0m, realised $4.0m, Value Gap $4.0m; Value Leakage $700k =
  $450k recoverable + $250k unrecoverable → options Act now $29.0m (Cardaxia recommendation), Delay 3 months $27.0m
  (management selection), No action $23.0m; selected − recommended −$2.0m; explicit pivot 30 Dec 2026 $5.0m (No action
  and Delay; Delay note "Management acts — delayed action") → VC-001 −$3.0m → Authorised V2 $27.0m (plan $0 / $5.0m /
  $16.5m / $27.0m) → Review #3 (against V2) forecast $25.0m (milestones $5.0m / $15.5m / $25.0m), realised $4.6m, Value
  Gap $2.0m.
- 21 trajectory points: V1 plan 4, V2 plan 4, Review #2 forecast 2, Review #3 forecast 3, Act now 2, No action 3,
  Delay 3 months 3.
- Automated verifier PASS; production isolation PASS (every pre-existing row byte-identical; 68 new rows, 94 audit rows,
  66 transactions, one actor; all attributed to DEMO-TRAJ2); visual acceptance PASS.
- No report issued for DEMO-TRAJ2. DEMO-TRAJ (4D.9N, pre-N.1 economics) remains unchanged.

Frozen production state (after the `df2f186` deployment): 6 projects, 618 rows in 33 tables, audit max id 365, 39
trajectory points (DEMO-TRAJ 18, DEMO-TRAJ2 21), 3 issued reports with 3 stored PDFs matching their SHA-256.

## Accepted visual semantics

- **Value Trajectory** — progress against the current authorised plan.
- **Alternative Value Trajectories** — future value paths associated with assessed management choices.
- **Value Case Evolution** — governed history of the value commitment and formal positions.

## Methodology principle

Forecast trajectories require sufficient explicit formal phasing to truthfully represent when expected variance
develops. Visual joins must not invent the timing of economic movement.

## Backlog (recorded only; not part of 4D.9N)

Domain hardening

1. `decidedOn` chronology is not enforced against recommendation issue time.
2. Forecast-after-review chronology is documented and tested but not enforced by the domain.
3. `reviewDate` serves both review date and formal as-at date.

Minor UX

4. Today and VC markers can overlap when events share a date.
5. Evolution labels can become tight at narrower widths.
6. Alternatives detail below the graph may eventually be simplified for executive presentation.
7. Explanatory chart scaffolding may be reduced after guided user testing.

Infrastructure

8. PostgreSQL client SSL-mode deprecation warning at cold start.
9. Long local browser suites should run under `caffeinate` (display sleep suspends Chromium network I/O).

Security posture (not changed in 4D.9N): `vo_app` retained, `neondb_owner` unchanged, recovery branch
`pre-4d9m-2026-10-03` retained; the next PMO step assesses them.
