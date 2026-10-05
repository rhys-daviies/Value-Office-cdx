# 4D.10I consultant acceptance record

**Scope:** acceptance, integration testing, refinement and release readiness for the 4D.10 stack (local only). No
push, deploy, production migration, Vercel/Neon change, Security B step or production data change. No secrets here.

## Acceptance project

Built from zero through the consultant UI only (`e2e/consultant-acceptance.spec.ts`; no fixture seeds its state):
new client **"Synthetic Acceptance Client &lt;run id&gt;"**, project **"Acceptance Journey &lt;run id&gt; (SYNTHETIC)"**,
USD, Cumulative Benefit, Value Period 1 Jul 2026 – 30 Jun 2029, Kick-off 15 Jul 2026. Stakeholders Val Owner (VCO)
and Ava Accountable (AVO). Production DEMO-TRAJ / DEMO-TRAJ2 untouched.

## Journey completed

| Stage                       | What was proven                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start                       | Mobilisation status and next step from a blank project ("Nominate the Value Case Owner")                                                                                                                                                                                                                                                                                                      |
| Day-1 Information Request   | created from Mobilisation (2 suggestions + 1 custom), issued; items received (fulfilled by evidence), partial, not available; Mobilisation shows "1 of 3 outstanding"; request closed; no gate anywhere                                                                                                                                                                                       |
| Original Business Case      | stated total $10.0m; VD-01 Procurement Savings $6.0m, VD-02 Process Automation $3.0m, VD-03 Legacy Decommissioning $1.0m; editable until recorded; read-only after; "Continue to Value Case Definition"                                                                                                                                                                                       |
| Value Case Definition → V1  | V1 created from the Original Business Case (identities kept); VD-01 → $5.5m (why changed), VD-02 unchanged, VD-03 dropped (why not carried forward), VD-04 Working Capital Release $1.0m (why introduced, no false "+$1.0m from" arithmetic); proposal blocked until every reason exists; plan milestones reconcile; V1 **$9.5m** proposed as a whole and authorised by the VCO with evidence |
| After authorisation         | Overview: Authorised $9.5m, no formal position, no pre-V1 Mobilisation guidance; navigation sweep clean                                                                                                                                                                                                                                                                                       |
| Continuous Assurance        | VL-001 Supplier price increase (owner, VD-01); evidence requested (Assurance IR) and received; working Value Leakage $0.8m; remediation + monitor-until; stage Monitoring; workflow strip presentation-only ("Formal review" not yet done)                                                                                                                                                    |
| Review #1 (Kick-off)        | reasoning order context → what changed / why → risks & leakage → forecast → options → recommendation → decision → impact → finalise; VL-001 assessed ($0.8m) and its evidence relied on; VD-01 $5.5m → $5.0m with reason and related matter; forecast **$9.0m**, Value Gap $0.5m, Value Leakage $0.8m (not reconciled)                                                                        |
| Internal review challenge   | 3 options; submit → read-only, finalise blocked; **returned** "Add a delayed renegotiation option"; option added (4 options), recommendation revised; resubmit → Ready to Issue (read-only, finalise blocked, no decision) → issued → options frozen; history 4 steps                                                                                                                         |
| Decision + no change        | management chose "Renegotiate supplier now"; **No Value Change Required** with rationale; Authorised stays $9.5m (V1); Review #1 finalised                                                                                                                                                                                                                                                    |
| Review #2 (material change) | material-change evidence recorded and offered as trigger; baseline from Review #1 ($5.0m); VD-01 → $4.5m with reason; forecast **$8.5m**, movement −$0.5m, Value Gap $1.0m; recommendation submit → ready → issue; decision; **Value Change Proposed**; finalised while V1 in force                                                                                                           |
| Value Change → V2           | prepared from the review (Overview next action); determination shown on VC-001 and kept separate from the Value Change reason; draft changes nothing ($9.5m); VD-01 $5.0m, plan re-phased to $9.0m; proposed; VCO authorisation with evidence; V1 superseded; **V2 $9.0m** authorised                                                                                                         |
| Review #3 against V2        | Authorised V2 $9.0m in context; baseline Review #2 ($4.5m); moved forecast blocked until reasoned; forecast **$8.6m**, Value Gap **$0.4m** on V2; VL-001 continues (recorded in Reviews #1–#3); Value Case Evolution Original $10.0m → V1 $9.5m → V2 $9.0m with Reviews #1–#3                                                                                                                 |
| Navigation                  | all 10 destinations swept pre-authorisation, after V1 and after V2 (no error pages, no retired terminology); aliases `/mobilisation`, `/value-case-definition` resolve once with the right tab active                                                                                                                                                                                         |

Overview captured at nine states (authorised V1; Review #1 underway; recommendation in internal review; decision
awaiting determination; No Value Change Required; Value Change Proposed; draft Value Change; authorised V2;
Review #3 against V2) — governance strip and next action correct at each (artefacts kept with the test output).

## Findings and fixes (4D.10I)

| Finding                                                                                                  | Classification       | Action                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Overview said "No governed action pending" beside "Kick-off review · Due"                                | PRODUCT DEFECT       | Fixed: next action falls back to "Open the …" when a requirement is Due and no review is open (existing cadence read model) |
| "Inherited starting point" for the Original Business Case (Value Case summary, Evolution table, V0 page) | PRODUCT DEFECT       | Fixed in-app ("Recorded starting point"); report renderers keep their wording                                               |
| "Re-Qualification Report" link on Value Case Definition                                                  | METHODOLOGY QUESTION | Kept — the issued report's name (register Q10)                                                                              |
| Command / guard messages with legacy terms                                                               | (none)               | Already re-worded at presentation by `presentRuleMessage` (4D.10B, tested)                                                  |
| Acceptance-spec locator / timing issues during authoring                                                 | TEST DEFECT          | Fixed in the spec; artefacts preserved before each rerun                                                                    |

No acceptance BLOCKER; no schema change needed.

## Migration-chain rehearsal (0020 → 0026)

PostgreSQL **18.1** (EDB binaries, a throwaway local cluster on port 5434; production runs 18.6 — same major
version, not identical patch level). Seeded **by the production code `b7d0c46` at 0020**: Horizon, compact scenarios,
canonical journey, three client reports — 33 tables, 879 rows, 13 reviews (12 finalised), 6 issued + 1 unissued
recommendation, 6 decisions, 5 Value Changes (2 authorised V2s), 49 trajectory points. Migrated with
`VO_APP_DB_ROLE=vo_runtime`.

| Check                         | Result                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0020 → 0026                   | all 33 pre-existing tables row-for-row identical (new nullable columns excluded, all null); 3 new tables empty; 21 → 27 rows                                                                                                                                                                                         |
| Schema delta                  | 26 columns, 42 constraints, 11 functions, 13 triggers, 3 enums; `vo_runtime` granted on the 3 new tables                                                                                                                                                                                                             |
| Historical                    | 6 issued recommendations read Issued (no history); decisions without determinations valid; 27 finalised positions without a forecast reason untouched; 3 stored report PDFs verified against their recorded hashes                                                                                                   |
| Prospective gates             | issue without internal review `VO_INTERNAL_REVIEW_REQUIRED`; finalise in review `VO_RECOMMENDATION_REVIEW_INCOMPLETE`; Value Change from an undetermined decision `VO_DETERMINATION_REQUIRED`; moved forecast without reason `VO_FORECAST_RATIONALE_REQUIRED`; V1 without reasons `VO_ADJUSTMENT_RATIONALE_REQUIRED` |
| Combined reversal 0026 → 0020 | schema (including grants) and every row identical to 0020                                                                                                                                                                                                                                                            |
| Re-apply                      | identical to the first forward run (deterministic)                                                                                                                                                                                                                                                                   |

## Test results

format, typecheck, lint pass · Vitest **517/517** · report suites **48/48** · drizzle check: no schema changes ·
db:verify pass · build, verify:bundle pass · reports:smoke byte-identical (172059 / 240367 / 130747 bytes) ·
Playwright **37/37** (including the acceptance journey, ~1 min).

## Release readiness

- Plan: `docs/release/4d10-release-procedure.md` (prepared, not executed; superseded the 4D.10I preflight plan).
- Methodology questions: `docs/release/4d10-methodology-questions.md` (13 items, current behaviour stated).
- Remaining before production: PMO release authorisation; owner credential window combined with Security B4;
  update the production checks that pin 0020; pre-release Neon recovery branch; Preview-deployment decision.
