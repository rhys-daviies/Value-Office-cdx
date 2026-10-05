# Architecture

Priorities: speed → simplicity → correctness/auditability → maintainability → future reuse.

## Shape

One Next.js application, one PostgreSQL database. No separate API, workers, queues, Redis or agent frameworks.

```
src/
  app/              UI routes (server components). Reads via queries, writes via server actions only.
  ui/               Presentation: components, labels, formatting (money via Decimal, never floats).
  domain/           Pure rules and values: money, status vocabularies, errors. No I/O.
  server/
    auth/           Authentication seam: getCurrentActor(). Only place that knows how identity is established.
    actions/        Server actions: parse FormData → call a command as the current actor → revalidate.
                    Map DomainError to consultant-facing messages. No business rules here.
    commands/       Named commands — the only way authoritative data changes.
    queries/        Read models (totals are derived here, never stored).
    db/             Drizzle schema + client.
  fixtures/         Canonical fixtures (Project Horizon), built through commands.
drizzle/            Migrations (generated schema + hand-written integrity/audit, see each file header).
tests/              Vitest against real PostgreSQL.  e2e/  Playwright.
```

Enforced by ESLint (`eslint.config.mjs`): `src/domain` imports no server/framework code; `src/app` never
imports `@/server/db`; a future `src/ai` may not import `@/server/db` or `@/server/commands`.

## Command pattern

```
UI / script → command(actor, input)
            → Zod validation
            → one transaction: set_config('vo.actor_id', 'vo.command') → writes
            → audit trigger records every row change
```

`defineCommand(name, zodSchema, handler)` in `src/server/commands/run.ts`. Command names live in
`src/server/commands/names.ts`. Database rule violations are raised as `VO_<CODE>: message` and surface as
`DomainError(code)`.

### UI mutation path

```
<ActionForm> (client) → server action → command → transaction + audit → revalidatePath(project)
```

`ActionForm` submits without React's automatic form reset so values survive validation errors; field errors come
from Zod issue paths or known constraint names (`src/server/actions/errors.ts`).

## Audit

- Generic `AFTER INSERT/UPDATE/DELETE` trigger on every authoritative table writes `audit_event`:
  actor, command, transaction id, timestamp, table, row id, before/after row images.
- A mutation without command context (`vo.actor_id`, `vo.command`) is **rejected** — not merely unaudited.
- `audit_event` is append-only (update/delete/truncate rejected).
- Limitation: a database superuser can disable triggers. Production should connect as a non-owner role
  (to be set up with hosting).

## Value Case versioning

| Version | Kind                      | Lifecycle                                      |
| ------- | ------------------------- | ---------------------------------------------- |
| V0      | `inherited_business_case` | `draft → recorded` (locked)                    |
| V1      | `value_case`              | `draft ⇄ proposed → authorised` (locked)       |
| V2+     | `value_case`              | via its Value Change (see Management response) |

- `value_driver` = stable identity (code, e.g. `VD-01`, unique per Value Case, immutable).
  `value_driver_version` = that driver's content in one version. New versions copy content forward
  (copy-on-write) including assumptions and evidence links; earlier versions are never touched.
- Contents (driver versions, assumptions, evidence links) are editable only while their version is `draft`.
- `proposed → authorised` is allowed only under command `valueCase.authoriseInitialVersion`, only when the
  authoriser is the Value Case's VCO, with authorisation evidence, a non-future date, a defined Value Basis,
  and only if no version of that case has ever been authorised.
- Exactly one `authorised` version per case (partial unique index); at most one open draft/proposed version.
- `authorised → superseded` is currently rejected; the Value Change phase will add that path (and may attach
  a `value_change_id` to versions — including, if methodology confirms, the initial V1).
- Evidence relied on by a locked version is frozen; project currency and Value Basis lock once a version is
  proposed or authorised.
- Totals are derived from driver versions; nothing stores a total except V0's `stated_total_value`, which
  records the headline figure of the inherited Business Case (which may not be decomposed into drivers).

### Phase 1 presentation rules

- Authority is colour-coded consistently: inherited V0 slate · draft amber · proposed sky · authorised emerald.
- Non-financial drivers (`financial_value` null) are labelled and excluded from totals. Negative values are allowed.
- Status summaries are counts only — no scores or readiness measures (that would be methodology).
- No forecast terminology exists in Phase 1.

## Value Assurance

```
assurance_review  draft → finalised (immutable)   against_version_id = Authorised version in force at opening
  └ previous_review_id = latest finalised review (null for the first) — one draft at a time keeps the chain linear
value_position    one per (review, driver): current_forecast, realised_value (cumulative), rationales
evidence_link     + assurance_review_id target (review-relevant evidence); 4D.2 adds working targets (below)
```

- Reviews never write to Value Case tables; Authorised V1 is untouched by Assurance.
- `vo_assurance_review_guard`: created as draft by the acting consultant; against an authorised version; previous
  review must be same project, finalised, the latest finalised, and not later-dated; finalisation only via
  `assurance.finaliseReview`, only changes status/finaliser, and requires a position for every driver in the
  version (including non-financial). Finalised reviews cannot be updated or deleted.
- `vo_value_position_guard`: positions only in draft reviews, only for drivers in the review's version.
- Evidence linked to, or triggering, a finalised review is frozen (`vo_evidence_is_locked`).
- Calculations (`src/domain/assurance.ts`), derived never stored:
  Value Gap = Authorised − Current Forecast; first-review movement = forecast − Authorised; later movement =
  forecast − previous finalised forecast. Project figures sum financial drivers only, and are reported as
  incomplete (not partially summed) until every financial driver is assessed. Realised totals show coverage.
- **Unattributed realised value** (`assurance_review.unattributed_realised_value` + required rationale): realised value
  known at project level but not attributable to drivers. Project Realised = attributed per-driver + unattributed.
  It never belongs to any driver.
- **Finalisation coverage:** every financial driver needs a Current Forecast or an explicit, reasoned
  `forecast_not_assessed`; any Not Assessed makes the project forecast and Value Gap Incomplete.
- Cadence (`src/domain/assurance-cadence.ts`) derives kick-off / Go-Live from key dates; **six-monthly is anchored on
  Go-Live** (Go-Live + 6k months, computed from the anchor; finalised six-month reviews satisfy occurrences in order,
  so early/late reviews never shift the schedule); without Go-Live only recorded six-month key dates count. Material-
  change evidence recorded since the latest finalised position and not yet reviewed is flagged.

## Management response (Phase 3)

```
value_leakage         register item: code, issue, AVO response owner, status, identified_in_review
  ├ value_leakage_driver   affected drivers (same Value Case)
  └ leakage_assessment     per review: total ≥ 0, 0 ≤ unrecoverable ≤ total; recoverable derived
scenario              per review: label, kind (current|recommended|alternative|no_action), consultant-entered total
recommendation        1 per review → the recommended scenario; immutable once issued (options freeze with it)
decision              1 per review → selected scenario, decision maker, date, evidence; immutable; needs an issued recommendation
value_change          VC code; from = version in force, to = copy-forward draft; stated change; review/decision origin
```

- Leakage and Value Gap are independent; nothing reconciles one to the other. Unrecoverable > 0 requires a rationale
  and is validated by the acting consultant (trigger-checked). Assessments lock with their review.
- Client-elected difference = selected − recommended (derived); the recommendation is never rewritten.
- **Value Change → V2+** (`vo_value_change_guard`, extended `vo_value_case_version_guard`): versions after the first
  authorised one are created, proposed, returned, authorised, rejected and withdrawn only in lock-step with their
  Value Change. Authorisation (VCO only, evidence, not future-dated) must reconcile the proposed drivers' financial
  total to the stated change, then in one transaction: change → authorised, old version → superseded, new version →
  authorised. Rejected/withdrawn changes and their versions are preserved and immutable. One open change at a time.
- Old reviews keep the version they measured against; new reviews open against the version in force.

## Three layers: commitment, continuous assurance, formal position (Phase 4D)

| Layer                           | Question                                               | Record                                                                                              |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Authorised Value Case**       | What has management formally committed to?             | `value_case_version` + driver versions — immutable; changes only through an authorised Value Change |
| **Continuous Assurance matter** | What threatens that value today and what are we doing? | `value_leakage` — the living matter, worked on day to day                                           |
| **Formal Assurance Review**     | Where do we officially stand as at this date?          | `assurance_review` + `value_position` + `leakage_assessment` — immutable once finalised             |

**Continuous Assurance matter (4D.1).** An Assurance matter is raised with `matter.create`, without a review
(`identified_on`; review-raised matters keep `identified_in_review_id`). While it is open, consultants can:

- move it freely between the provisional working stages (`identified`, `awaiting_evidence`, `assessing`,
  `remediation`, `monitoring`, `escalated`). This is not a workflow; every change is audited;
- assign the **Risk / Leakage Owner**, who may differ from the drivers' AVOs;
- record a **working assessment**: total and unrecoverable (Recoverable = Total − Unrecoverable), with a rationale
  when unrecoverable is above zero. The database attributes it to the acting consultant at `now()`. A matter may stay
  **not yet quantified**, which is never zero;
- record a remediation plan and a monitor-until date.

Resolved = `matter.close` with a closure note; `matter.reopen` reopens. Status open/closed stays authoritative.
Matters are never deleted, and code and origin are immutable (`vo_value_leakage_guard`, per-command rules). Working
figures never change Authorised Value, Current Forecast, Value Gap or any version.

**Formal snapshot.** `leakage_assessment` remains "the matter's formal position in one review":

- its amounts come only from that review's own assessment (`leakage.assess`). Null means not yet quantified in that
  review;
- when a review is finalised, `assurance.finaliseReview` writes `snapshot_*` columns (status, stage, title,
  description, owner, affected drivers, consultant assessment, decision date, remediation, monitor-until) for every
  open matter and every matter assessed in the review. Unassessed matters get a row with null amounts; working
  figures are never copied;
- only finalisation may write snapshot columns, and finalisation may not write amounts;
- `vo_assurance_review_guard` refuses finalisation unless the snapshot is complete (`matter_snapshot_at`);
- finalised rows are immutable.

**Read models (`src/server/queries/response.ts`)** keep the layers apart:

- `getContinuousAssurance` and `getAssuranceMatter` read the living matter;
- `getReviewResponse` (and so the Assurance Report) reads a finalised review's snapshot, with working fields removed.

Reviews finalised before 4D.1 (`matter_snapshot_at` null) read their matters live, as before. Nothing was backfilled.

**Evidence in Continuous Assurance (4D.2).** Evidence can support a living matter as well as a formal position. The
consultant either **documents** evidence already held (`matter.documentEvidence`, or `matter.linkEvidence` for
existing evidence) or **requests** what is missing (`matter.requestEvidence`: an item on an Assurance Information
Request). When it arrives, the item is fulfilled with that evidence through the existing
`informationRequest.updateItem`, so the trail is matter → request item → evidence.

Two kinds of `evidence_link` are kept apart. Exactly one target is still set:

| Kind                | Targets                                                                         | Effect                                                                                            |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Formal reliance** | driver version, assumption, Assurance Review (+ authorisation/decision columns) | locks the evidence once the version is locked / the review finalised (`vo_evidence_is_locked`)    |
| **Working link**    | `value_leakage_id` (living matter), `value_driver_id` (stable driver identity)  | informs the consultant; never locks, never unlocks; written only by its own commands (DB-checked) |

- Matter links change only while the matter is open; driver-identity links never touch a `value_driver_version`.
  They are the foundation for the living-driver record (4D.3).
- Formal review evidence stays deliberate: nothing copies matter evidence into a review. A draft review lists open
  matters' evidence and the consultant may link any of it with `assurance.linkEvidence`. Finalising then applies
  the usual locking. Unlinked working evidence stays editable.
- Evidence never drives anything by itself: no trigger moves a matter's stage or working figures, and nothing
  changes forecast, Value Gap, Authorised Value, qualification or Value Changes. The UI may suggest a next step;
  the consultant acts.

**Information Requests throughout the engagement.** A project may have many requests. Each new request has a
`purpose`, `mobilisation` or `assurance`; the purpose is required on insert and immutable afterwards. Requests
created before 4D.2 keep a null purpose and read as Mobilisation. Nothing was backfilled. An item may belong to one
Assurance matter (`information_request_item.value_leakage_id`), but only on an Assurance request, only while the
matter is open, and the link is immutable. Information Request reports are unchanged.

## Governed value movements (Phase 4D.10E)

**Invariant.** Any non-zero governed value movement carries an explicit rationale at its formal governance gate.
Drafts stay working space (no reason per keystroke), there is no materiality threshold, and evidence stays optional.
The rationale answers _why the governed value changed_; `calculation_rationale` keeps its meaning (_how_ a value is
calculated). Actor, time, command and before/after come from `audit_event`; nothing duplicates them.

| Movement                  | Baseline                                                                                                                                                               | Gate                     | Stored in                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| **Value Case Definition** | the driver's counterpart in the **recorded** Original Business Case (a draft one is not a baseline)                                                                    | V1 draft → proposed      | `value_driver_version.adjustment_rationale`                              |
| — not carried forward     | a financial Original Business Case driver with no V1 row                                                                                                               | V1 draft → proposed      | `value_driver_exclusion` (same rationale concept; no phantom row)        |
| **Assurance forecast**    | the previous finalised review's forecast for the driver; else (first review, absent there, or Not Assessed there) its authorised value in the version measured against | review draft → finalised | `value_position.forecast_rationale` (+ optional `value_leakage_id`)      |
| **Value Change (V2+)**    | the version in force                                                                                                                                                   | Value Change proposal    | `value_change.reason` (existing, required); driver-level reason optional |

- **Definition movement** = contribution(V1 row) − contribution(counterpart); a non-financial row or an absent
  counterpart contributes nothing (the existing total semantics). Where there is no counterpart the reason is "why
  introduced" — provenance for the commitment, not a claim of movement from zero, and the UI shows no movement
  arithmetic. $0 and non-financial introductions need none. Pure rule: `definitionRationaleRequired`.
- **Forecast movement** uses the existing movement basis (`forecastMovement`); non-financial drivers are outside it and
  Not Assessed keeps its own required rationale. A forecast may name the Assurance matter (Value Leakage) that explains
  it; never required, and Value Gap is never reconciled to Value Leakage. Evidence uses the existing review links.
- **Enforcement:** `vo_version_rationale_gate` and `vo_review_value_rationale_gate` (0022), named to fire after the
  existing guards; `vo_value_driver_exclusion_guard` (command, draft first governed version, Original Business Case
  driver not in V1). Adjustment rationale is never copied forward (`copyVersionContents`).
- **Prospective only.** Locked versions and finalised reviews are never re-checked or backfilled; historical rows
  without rationale stay valid. Reports are unchanged (a rationale section would be a future versioned renderer).
  Migration record and reversal: `docs/release/4d10e-migration.md`.

## Assurance operating workspace (Phase 4D.10F)

Presentation and composition only: no schema, no migration, no new methodology.

- **Landing** reads in three bands: _Current position_ (governed: Authorised Value, latest formal forecast, realised,
  Value Gap, latest formal review, next derived requirement), _Active Assurance_ (working: open matters, attention,
  evidence outstanding, working Value Leakage, remediation) and _Formal Assurance Reviews_ (latest, requirements,
  create, history). Governed and working figures stay visually and numerically separate.
- **Review page order:** context → What changed + Why it matters (one review-level step) → Risks / Value Leakage /
  evidence / remediation → Forecast Value Position (4D.10E baseline → forecast → movement → why → related matter) →
  options → recommendation → decision → Value Case impact → finalise. Option economics, the issue freeze and decision
  rules are unchanged.
- **Review creation** may record both What changed and Why it matters (`createReview` accepts `whyItMatters`; the
  column already existed).
- **Matter workflow** (`src/domain/assurance-workflow.ts`) is a read-time lens: risk identified → evidence → Value
  Leakage → remediation → monitoring → formal review. It never sets a stage. Evidence request status is derived from
  the matter's Information Request items and never blocks a review.
- **Matter → review handoff** uses the existing relationships only: "Rely on in Review #N" creates the existing
  review-evidence link; "Assess in Review #N" opens the review's existing leakage assessment; open matters are
  snapshotted at finalisation as before. Nothing is copied outside finalisation.
- **Value Gap vs Value Leakage** is stated wherever both appear and never reconciled. A forecast movement never alters
  the Authorised Value Case; a Value Change stays explicit and manual.
- The **in-app story** adds Why it matters after What changed. Issued report renderers and snapshots are unchanged.

## Recommendation internal review (Phase 4D.10G)

Cardaxia challenges its own advice before management sees it. The reviewer is **internal Cardaxia**, never the client
VCO.

| State              | Stored as                             | Recommendation, options, option paths | Decision |
| ------------------ | ------------------------------------- | ------------------------------------- | -------- |
| Draft              | `internal_review_status` null         | editable                              | no       |
| In internal review | `in_internal_review`                  | read-only (not frozen)                | no       |
| Returned           | `returned`                            | editable                              | no       |
| Ready to Issue     | `ready_to_issue`                      | read-only (not frozen)                | no       |
| Issued             | `issued_at` set (status kept or null) | permanently frozen (unchanged guards) | yes      |

- Transitions: draft/returned → submit → in review → return (feedback required) | ready to issue; ready to issue →
  return | issue. Commands `options.submitRecommendation`, `options.returnRecommendation`,
  `options.approveRecommendation`; issue keeps `options.issueRecommendation` and now requires Ready to Issue.
- Each step writes an insert-only `recommendation_review_event` in the same transaction as the state change (the
  guard requires it), so every return reason across cycles is kept; `audit_event` records actor and before/after.
- Submission already requires the option paths to reconcile (the issue-time economics), so review cannot bypass them.
- The acting user of every step is recorded. The pilot's auth model cannot separate author and reviewer, so separation
  of duties is not enforced (no pretend RBAC).
- Prospective: recommendations issued before this phase read as Issued with no history. Reports are unchanged.
- Migration record: `docs/release/4d10g-migration.md`.

## Value Change determination (Phase 4D.10H)

Closes the loop Formal Assurance → recommendation → management decision → Authorised Value Case. Neither a forecast
movement nor a decision changes the Authorised Value Case by itself.

- After a management decision the consultant answers, once and with a rationale: **No Value Change Required** or
  **Value Change Proposed** (`value_change_determination`, insert-only, one per decision, `valueChange.determineImpact`).
  A correction would need a later governance feature (superseding determination); none exists yet.
- The determination writes nothing to the Value Case, versions, positions, leakage or the decision, and never creates
  a Value Change. Value Change Proposed leads to **Prepare Value Change** in the existing workflow; the resulting
  change is linked through `value_change.decision_id`, and the database requires the decision's determination to be
  Value Change Proposed. The determination rationale (why the Authorised Value Case must change) and
  `value_change.reason` (what change is proposed) stay separate.
- A review cannot be finalised while its recommendation is in internal review or ready to issue (PMO, 4D.10G);
  no / draft / returned / issued recommendations finalise as before. A draft or returned recommendation on a finalised
  review can no longer progress (existing draft-review rule for recommendations).
- Overview adds a governance strip (draft review, recommendation, decision, Value Case impact, open Value Change) and
  one derived next governed action (`postAuthorisationNextAction`). The pre-V1 Mobilisation checklist still ends at
  authorisation.
- Prospective only: earlier decisions have no determination and stay valid. Reports are unchanged.
- Migration record: `docs/release/4d10h-migration.md`.

## Value Drivers: identity, living record, versioned snapshot (Phase 4D.3)

| Layer                  | Record                                         | Changes how                                                   |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| **Stable identity**    | `value_driver` (VD-04)                         | created once; never renamed; kept while anything refers to it |
| **Living record**      | `value_driver_record` (+ working assumptions)  | bounded `driver.*` commands, any time; audited                |
| **Versioned snapshot** | `value_driver_version` in a Value Case version | draft only; locked with its version                           |

- **Living changes never rewrite authorised history.** The living record holds Cardaxia's current working
  understanding: working AVO, qualification, evidence status, metric and target, rationale, notes, assumptions and a
  **working estimate**. A null estimate reads "Not yet quantified". Each version keeps the content and AVO it had.
  Totals, Value Positions and reports read versions only, so a working estimate can never reach Authorised Value,
  Current Forecast, Value Gap or realised value.
- **Emerging drivers.** Once the Value Case is authorised, `driver.createEmerging` adds a new identity with only a
  living record. It may record the Assurance matter it came from. It has no version and no Value Position, and it
  creates no Value Change.
- **Status is derived, not stored.** A driver is **In Value Case** when its identity is in the authorised version in
  force; otherwise it is **Emerging** (noting "was in Vn" if a Value Change dropped it). Nothing can drift out of sync.
- **Existing drivers get a record lazily.** Until a consultant starts one (`driver.initialiseRecord`), the register
  shows the governed content. Starting a record copies the in-force content once, and records
  `initialised_from_version_id`. Nothing was backfilled.
- **A Value Change is the only way in.** `valueChange.includeDriver` adds the identity to a draft Value Change's
  proposed version, starting from the living record (working estimate → proposed financial value; assumptions
  copied). The normal lifecycle still applies: reconciliation, proposal, VCO authorisation. There is no
  synchronisation afterwards in either direction. Working evidence links on the identity (4D.2) are not copied;
  formal reliance stays deliberate.
- **Identity safety.** `valueCase.removeValueDriver` deletes an identity only when nothing refers to it: no version,
  living record, position, working evidence, matter, request item or formal matter snapshot.
  `vo_value_driver_identity_guard` refuses any other deletion.

## Operating experience (Phase 4D.4)

**Navigation** (`src/ui/navigation.ts`):

- **Primary:** Overview · Assurance · Value Drivers · Evidence (daily work), then Value Case · Value Changes ·
  Reports (governed value).
- **Secondary ("More"):** Setup · Information Requests · Re-Qualification · History. These are still one click away.

Every route is unchanged.

**Read models** (`src/server/queries/workspace.ts`) keep working and governed data apart:

- `getContinuousAssuranceWorkspace`: open matters, with evidence and request counts and derived attention. It gives
  a **working** Value Leakage total of quantified open matters only, and counts unquantified matters separately
  (never as zero).
- `getOverviewValueOfficeState`: the governed position next to that working picture.
- `getGovernedCommitment`: the authorised version in force and its drivers.

Working totals are never added to or netted against the Value Gap, and never shown as formal Value Leakage.

**Needs attention** (`src/domain/attention.ts`) is derived at read time from existing matter fields. It covers:

- escalated;
- awaiting evidence;
- no Risk / Leakage Owner;
- not yet quantified;
- decision date passed or approaching;
- monitoring period ended or ending.

"Approaching" means within 14 days, using UTC calendar dates. Nothing is stored, scheduled, assigned or scored.

**Visual language:**

- **Working:** violet, dashed, labelled with `WorkingTag` (e.g. "Working · not formally reviewed").
- **Governed:** solid, with a lock, labelled with `GovernedTag` (e.g. "Authorised V2").

Labels always accompany colour.

**Driver display status** is still derived:

- **In Value Case:** in the authorised version in force.
- **Outside Current Value Case:** in an earlier authorised version, but not the one in force.
- **Emerging:** never authorised.

A driver in a draft or proposed Value Change is noted for information only.

## Value Case Evolution (Phase 4D.5)

Value Case Evolution is the **governed historical view** of a project's value position:

- the **Original Business Case** (recorded V0 headline) — the inherited starting point; it has no governed date and is shown as "Not dated";
- each **Authorised Value Case version** (authorised or since superseded) at its recorded VCO authorisation date — a step line, in force until superseded;
- each **finalised Assurance Review**'s formal **Current Forecast** and **Realised Value**, at its review date, with the version it was measured against.

It **excludes** working driver estimates, emerging drivers, working Value Leakage, draft Assurance Reviews and draft/proposed/rejected/withdrawn versions and Value Changes. Formal Value Leakage and Value Gap are not series (Value Gap appears in the review tooltip and table).

- Read model: `getValueCaseEvolution` (`src/server/queries/evolution.ts`) returns decimal strings exactly as derived by existing domain code (`getVersionTotal`, `computeValuePosition`); ordering is the pure `orderEvolutionEvents` (`src/domain/evolution.ts`): a review always follows the authorisation of the version it measured; one measured against an older version is placed by date and never reassigned.
- Presentation: `ValueCaseEvolution` (`src/ui/evolution/`) — one component on Overview (companion table collapsed) and the Value Case page (table open). The client-only Recharts chart converts strings to numbers solely to position marks; every value read is server-formatted. The x-axis is event order, not elapsed time; forecast/realised connectors show sequence only. The companion table carries the full governed history for non-visual use.
- Not in reports (Phase 4D.7).

## Alternative Value Outcomes (Phase 4D.6)

Alternative Value Outcomes is a **point-in-time comparison of stored, quantified management-response scenarios and decision economics** for one Assurance Review. It is **not** a time-phased trajectory, a predictive model or a forecast engine: each scenario is one consultant-entered total, and nothing is interpolated between them.

- References (not options): the Authorised Value of the version **that review** measured against, and **that review's** formal Current Forecast — never a later version or a later review.
- Outcomes: the review's stored scenarios. Cardaxia's recommendation is the **issued** recommendation only (a saved draft is not shown as Cardaxia's position); the client-selected outcome comes from the decision. Order is semantic, never by value: recommendation, other options in stored order, client choice; a scenario holding both roles appears once with both labels. Difference from Cardaxia recommendation = selected − recommended (decimal, signed; zero preserved), neutral wording.
- Under the current domain model a persisted scenario **always has a quantified total** (required by the command and `NOT NULL` in the database), and a recommendation must reference the review's `recommended`-kind scenario. Unquantified options are therefore not a stored state.
- Excluded: Value Changes (e.g. Horizon VC-002), working Value Leakage, emerging-driver working estimates, draft reviews.
- Read model `getAlternativeValueOutcomes` / `getLatestValueDecision` (`src/server/queries/outcomes.ts`), pure ordering in `src/domain/outcomes.ts`; one component (`src/ui/outcomes/`) — full on finalised reviews, compact "Latest Value Decision" on Overview only when the latest finalised review has options plus a recommendation or decision. Horizontal dot plot on a zero-inclusive scale (a narrow domain would exaggerate small differences); it replaced the earlier option bars, whose truncated baseline did. Not in reports (Phase 4D.7).
- 4D.5 refinement: Value Case Evolution's forecast connector now runs only between reviews measured against the same version (`src/ui/evolution/segments.ts`); realised value is cumulative and stays connected.

## Report visuals (Phase 4D.7)

- **Web visualisations use Recharts** (client-only, interactive). **Reports use deterministic server-side SVG** (`src/ui/reports/charts/`): no Recharts, browser JavaScript, canvas, screenshots, network or random ids; coordinates are derived with Decimal and emitted at fixed precision, all text is escaped by the report `html` builder. The PDF renderer runs Chromium with JavaScript disabled, so this is the only way charts can appear in a PDF.
- Both consume **the same governed semantics**: the report builder copies `getValueCaseEvolution` and `getAlternativeValueOutcomes` output into the report model, and the report SVG reuses the application's forecast-connector rule (`src/ui/evolution/segments.ts`). Reports interpret nothing new.
- **Value Case Evolution** (governed history: Original Business Case, Authorised versions, finalised reviews' formal forecast and realised value) is snapshotted **as at the reported review** (events after it are excluded). **Alternative Value Outcomes** (point-in-time decision economics of that review — not a trajectory) is snapshotted when the review has options plus an issued recommendation or a decision; a review with options only lists them without a chart, and one with no options omits the section.
- **Issued reports snapshot chart data.** `REPORT_MODEL_VERSION` 1 → 2 (Assurance gains `evolution` and `outcomes`); `RENDERER_VERSION` `report-html-1` → `report-html-2`. Stored v1 snapshots are never rewritten and render through the v1 path byte-for-byte as the **released renderer (a88cc72)** did (golden fixture `tests/fixtures/reports/assurance-v1.*`: a real a88cc72-issued snapshot and that release's own rendering, hashes pinned): same sections, numbering, "Alternative trajectories" and "Response owner (AVO)" wording, no charts. Wording changed after release (e.g. Phase 4D.1's "Risk / Leakage Owner") applies to v2 only. v2-only styles are emitted inside v2 reports, so the shared stylesheet — and therefore v1 output — is unchanged. v2 reports use "Alternative Value Outcomes" and renumber: 2 Value Case Evolution, 7 Alternative Value Outcomes.
- Print: each visual (heading, explanation, summary strip, legend, SVG) is one `break-inside: avoid` block well under an A4 page; tables continue naturally. Series differ by line style and marker shape as well as colour; no working violet.

## Value Trajectory methodology contract (Phase 4D.9B, approved)

Canonical contract for governed Value Trajectories. 4D.9C implements the domain (below); authoring UI, charts and
reports follow in 4D.9D–J. The Cardaxia Portal is a visual reference only: no linear plans, uplift/decay formulas,
generated ranges, delay simulators or red-vs-green option framing.

**Principles.** (1) A trajectory exists only when the governing Value Case version declares a trajectory-capable
**basis kind** and a **Value Period**. (2) Only consultant-entered, dated points are stored; nothing is interpolated,
generated or simulated, and there are no ranges. Straight joins between points are presentation only. (3) Every
line that has points ends on the Value Period end date at its governed total. (4) The plan is part of the authorised
commitment: re-phasing, even at an unchanged total, is a VCO-authorised Value Change; earlier plans stay immutable.
(5) The formal position comes from the latest finalised Assurance Review, distinct from Today; Continuous Assurance
working matters and emerging-driver estimates never enter the trajectory (a future Working Outlook would be separate).
(6) Realised value is not duplicated: finalised reviews' cumulative realised checkpoints are the actual line, shown
only where comparable. (7) Option paths share history to the review date and diverge after it; "delayed action" is an
ordinary consultant-defined option. (8) Value Trajectory, Alternative Value Trajectories and Value Case Evolution stay
three distinct visuals. (9) Sufficient phasing (4D.9N.1B.1): a forecast trajectory must contain sufficient explicit
formal milestones to represent the timing of expected variance where that timing is material to the value story.
Chart joins must not be used to infer when a forecast moves ahead of or behind the authorised plan. This is not a
requirement for monthly phasing — only for enough explicit phasing to carry the intended formal value story.

**Value Basis kind** (`value_basis_kind`, on the version; the free-text Value Basis description is unchanged):

| Kind                 | Trajectory | Y-axis                                                               | Authorised terminal means        | Cumulative Realised comparable       |
| -------------------- | ---------- | -------------------------------------------------------------------- | -------------------------------- | ------------------------------------ |
| `cumulative_benefit` | yes        | cumulative benefit since Value Period start (origin 0 by definition) | cumulative benefit by period end | yes                                  |
| `annual_run_rate`    | yes (rate) | annualised benefit run-rate at each date                             | target run-rate by period end    | **no** — plan + formal forecast only |
| `net_present_value`  | no         | —                                                                    | a single valuation               | —                                    |
| `other`              | no         | —                                                                    | as described                     | —                                    |

Kinds are never converted. Once a version is classified, later versions keep the same kind; a legacy (unclassified)
case is classified by a new version created through a Value Change.

**Ownership and lifecycle** (`value_trajectory_point`, exactly one parent):

| Line            | Parent                                       | Editable while                             | Frozen when                                   | Dates                                              |
| --------------- | -------------------------------------------- | ------------------------------------------ | --------------------------------------------- | -------------------------------------------------- |
| Plan            | Value Case version (V1+; never inherited V0) | version draft                              | version proposed (editable again if returned) | within the version's Value Period                  |
| Formal forecast | Assurance Review                             | review draft                               | review finalised                              | after the review date, within the governing period |
| Option path     | Scenario                                     | review draft and recommendation not issued | recommendation issued / review finalised      | after the review date, within the governing period |
| Realised        | — (finalised reviews' cumulative realised)   | —                                          | at finalisation                               | review dates                                       |

The governing period and kind for forecast and option points are those of the version the review measured against.

**Reconciliation** (no points = allowed, shown as "Phasing not entered"; drafts may be incomplete). When points exist:
version proposal and VCO authorisation require a point on the period end equal to the version total, all points in
the period; recommendation issue requires each option's period-end point to equal its stored total; review
finalisation requires the forecast period-end point to equal the complete formal forecast total (an incomplete
forecast cannot keep points) and re-checks option paths. Totals match exactly (numeric(18,2)).

**Value Changes.** `valueChange.create` copies the basis kind, Value Period and plan points into the draft version.
A phasing-only change (stated change 0, unchanged drivers) reconciles under the existing rule. The Value Period may
change through a Value Change; the earlier version is never mutated.

**Legacy.** Migration 0019/0020 is additive, with no backfill: unclassified versions, missing periods and absent
points stay valid and behave exactly as before. Existing projects adopt trajectories through a VCO-authorised Value
Change (stated change 0 where the total is unchanged). Project-level Value Basis description and Value Period remain
setup information and keep their existing lock.

**Out of MVP:** forecast ranges, a realised run-rate measure, Original Business Case (V0) phasing, per-driver
phasing, AI-generated points, Working Outlook.

**Realised completeness (4D.9F PMO decision).** A trajectory plots a finalised review's realised value only when the
review establishes a complete project-level position (`realisedPositionComplete`): every financial driver has a realised
value, or none does and the whole position is recorded as unattributed realised value. A position recorded for only
some drivers is not plotted (noted), even with an unattributed amount alongside. Today and the formal checkpoint are
combined only on the same calendar date; otherwise their labels are placed apart.

**Alternative Value Trajectories (4D.9F)** — `getAlternativeValueTrajectories` → `src/ui/trajectory/alternatives*`, on
the finalised review after the client decision. One review: shared history (cumulative only: zero origin and earlier
finalised reviews' complete realised positions), the branch anchor (that review's own complete realised position —
composition only, never stored), then each option's stored milestones; terminal labels are the stored option totals.
Roles come from the issued recommendation and the recorded decision; options keep the 4D.6 semantic order and are never
ranked. An option without milestones is a single end marker at its stored total ("Phasing not entered"). Run-rate has no
history or anchor. When no option has milestones, or the basis is unclassified, NPV, Other or has no Value Period, the
4D.6 endpoint-only Alternative Value Outcomes remain the visual. Overview's Latest Value Decision is unchanged.

**Review story and draft preview (4D.9G).** `getReviewStory` (`src/ui/assurance/story.tsx`, top of the review page)
composes what changed → value affected → Cardaxia response → management decision → governance through explicit links
only: matters via `leakage_assessment` (a finalised review's snapshot; a legacy finalised review's matters raised or
assessed in it; a draft's open matters and its own assessments), drivers via the snapshot driver ids, forecast movement
from the review's Value Position, formal evidence (trigger + review links — matter evidence links stay working links),
and Value Changes by `value_change.assurance_review_id` or `decision_id`. Value Leakage is shown per matter with exact
amounts and is never presented as the Value Gap. The governed Alternative Value Trajectories compare Client Selected
with Cardaxia Recommendation only once a decision exists. A draft review shows a non-governed preview (working styling,
"Draft · Not governed", a saved recommendation as "Draft recommendation (not issued)", no branch anchor, governed
history only). The primary trajectory marks the authorised Value Change that created the version in force.

**Analytical hierarchy (4D.9H).** Overview answers "what is the current executive value position?" (the primary Value
Trajectory, plus a compact Value Case governance summary from `getValueCaseSummary`). Assurance answers "what changed and
what should management do?" (Continuous and Formal Assurance, Alternative Value Trajectories, recommendation and
decision). The Value Case page answers "what have we committed to, and how has that changed?", in order: Current
Authorised Value Case (version in force, basis, Value Period, any pending Value Change shown as not in force), the Value
Trajectory ("progress against the current authorised plan"), Value Case Evolution ("history of the governed value
commitment" — unchanged semantics, shown with or without trajectory adoption), then Value Change history and version
history (the governed actions that produced it). A draft review preview also shows the draft's entered forecast
milestones as "Draft Formal Forecast (not governed)". Until a recommendation is issued, the stored "recommended" option
kind reads "Proposed recommendation".

**Executive Overview (4D.9I).** `getExecutiveOverview` composes existing read models; after authorisation the Overview
is, in order: Value position (Authorised, Realised, Formal Forecast, Value Gap, "Formal position as at" the latest
finalised review, next Assurance requirement from the existing cadence) → Value Trajectory (its facts strip is not
repeated here) → Value requiring attention (one open matter chosen by `firstNeedingAttention`: the existing attention
conditions in their "most pressing first" order, ties by matter code — never by amount — with its formal or labelled
working Value Leakage, plus counts and the existing formal open-matter summary) → Latest recorded value decision (issued
recommendation, management selection, difference and decision date; text, with the options on the review)
→ Value Case summary (pending changes shown as "Proposed change … · Draft/Proposed — not in force") → a collapsed
setup and mobilisation record. The Working picture, Formal Value Leakage block, Governance panel and V0 → V1 baseline
are no longer on the post-authorisation Overview (they remain in Assurance / Value Case). Before authorisation the
setup and re-qualification record is the page, unchanged.

Decision semantics (4D.9L, PMO-approved): the **latest formal position** is the latest finalised Assurance Review; the
**latest recorded value decision** is the management decision at the highest-sequence finalised review that has one
(`getLatestValueDecision` → `recorded`), which may be earlier than the formal position. The card names its source
review, that review's formal-position date and measured-against version, and the decision date; when the source is
not the latest formal position it says so and states what the latest review records. A recommendation issued at the
latest formal position with no decision recorded (`awaiting`) is shown as a recommendation awaiting management
decision — never as a recorded decision. Historical reviews are read, never changed.

**Attention ordering (4D.9I, confirmed 4D.9J).** `firstNeedingAttention` is an operational display rule — existing
attention conditions in their most-pressing-first order, ties by matter code — **not** a formal materiality
methodology, and it never ranks by amount. Materiality prioritisation is deferred for methodology review.

**Value Change presentation (4D.9J).** Pending (draft/proposed) changes surface the existing reconciliation invariant
without changing it: when the stated change equals the proposed version's movement one provisional amount is shown
("Proposed change +$450k · Draft — not in force"); when they differ both are shown ("Stated change +$250k · Current
draft movement $0 · Does not reconcile"). Governance/change amounts use `formatMoneyAdaptive` ($30.0m, $1.25m, $450k,
$0) so a smaller change is never rounded into a different-looking figure; headline figures keep `formatMoneyShort`.

**Report Value Trajectories (4D.9J, model v3 / renderer report-html-3).** One global model version, as before:
`REPORT_MODEL_VERSION = 3`. v3 snapshots add, built once at preview/issue time and stored verbatim:

| Report              | Snapshot                                                                                                                                                                                                                                                                                                                          | Rendered                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-Qualification    | `plan` (V1's basis, Value Period, milestones, total, availability)                                                                                                                                                                                                                                                                | Value Basis and Authorised Plan block (no later Assurance)                                                                                                                                                                                                                                                     |
| Value Assurance     | `trajectory` (as at the review: plan of the version it measured against; realised of finalised reviews up to and including it — cumulative, comparable, complete, in period; its own forecast milestones and anchor; the authorised Value Change that created that version) and `alternatives` (4D.9F model, phased options only) | New narrative (`renderAssuranceV3`): executive position → Value Trajectory → why the value position moved → Value Leakage → Alternative Value Trajectories (or the 4D.6 outcomes fallback) → recommendation → management decision → governance → driver position → Evolution → review record → values appendix |
| Value Change Notice | `plans.from` / `plans.to`                                                                                                                                                                                                                                                                                                         | Plans now/as proposed (a chart only when both are phased), reconciliation wording, adaptive precision                                                                                                                                                                                                          |
| Information Request | —                                                                                                                                                                                                                                                                                                                                 | Unchanged                                                                                                                                                                                                                                                                                                      |

Charts are deterministic server-side SVG (`ui/reports/charts/trajectory-svg.ts`) drawn only from the snapshot: real
dates, explicit observations only, joins as presentation, no "Today" (a report is as at its subject). Annual run-rate
shows plan and formal forecast only, with "Realised run-rate is not currently recorded." Missing basis / NPV / Other /
no period / no phasing render a short statement, never an empty chart; legacy projects remain issuable. Value
Leakage is per matter with exact amounts and is never presented as the Value Gap. **Compatibility:** v1/v2 snapshots
dispatch to the unchanged renderers; v3 sections in shared Re-Qualification / Value Change templates are spliced in
with no surrounding whitespace (templates are `prettier-ignore`). Goldens: `tests/fixtures/reports/assurance-v1.*`
(released a88cc72) and `*-v2.*` for all four report types (captured from 41275e4) must render byte-for-byte; issued
snapshots are never rewritten.

**Canonical end-to-end journey (4D.9K; story revised 4D.9N.1A).** `src/fixtures/canonical.ts` builds ONE synthetic engagement through commands
only, in stages a test can pause between (`establish` → `assure` → `change` → `proposeChange` → `authoriseChange` →
`continueAssurance`). "Trajectory Executive" is the journey through Review #2; "Canonical Value Journey" (seed `CANON`)
runs it to the end. `tests/db/canonical-journey.test.ts` validates it across every surface and `e2e/canonical-journey.spec.ts`
in the browser.

| Stage                                              | Synthetic values                                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original Business Case (V0)                        | $32.0m, headline only                                                                                                                                                 |
| Authorised V1 (15 Jan 2026)                        | $30.0m (VD-01 $15.0m, VD-02 $10.0m, VD-03 $5.0m); Value Period 1 Jan 2026 – 31 Dec 2028; plan $0 / $6.0m / $18.0m / $30.0m                                            |
| Review #1 (31 Mar 2026, V1)                        | forecast $28.0m, realised $1.0m                                                                                                                                       |
| VL-001 Vendor sequencing risk (14 Aug 2026, VD-01) | working evidence E-003; formal leakage in Review #2 $700,000 = $450,000 + $250,000                                                                                    |
| Review #2 (30 Sep 2026, V1)                        | forecast $26.0m (milestones $16.0m / $26.0m), realised $4.0m, Value Gap $4.0m                                                                                         |
| Options at Review #2                               | Act now $29.0m (Cardaxia recommendation), Delay 3 months $27.0m (management selected), No action $23.0m; difference −$2.0m                                            |
| Option paths (explicit scenario milestones)        | Act now $18.0m / $29.0m; No action $5.0m (30 Dec 2026) / $15.0m / $23.0m; Delay $5.0m (30 Dec 2026, note "Management acts — delayed action") / $16.5m / $27.0m        |
| VC-001 (from Review #2 and its decision)           | formalises the adopted Delay path: stated −$3.0m = VD-01 $15.0m → $12.0m; V2 plan $0 / $5.0m / $16.5m / $27.0m                                                        |
| Authorised V2 (3 Oct 2026)                         | $27.0m; V1 superseded and unchanged                                                                                                                                   |
| Review #3 (3 Oct 2026, V2)                         | forecast $25.0m (VD-01 $12.0m on plan; VD-02 $9.0m, VD-03 $4.0m continue Review #2's shortfalls; milestones $5.0m / $15.5m / $25.0m), realised $4.6m, Value Gap $2.0m |

Rules the journey proves: the management decision does not itself change the commitment — VC-001, an authorised,
reconciled Value Change with its own rationale, later formalises the adopted path; the Review #2 Formal Forecast ($26.0m) is the
"Current expected outcome before the assessed management interventions." (not the No action scenario); the 30 Dec 2026
$5.0m pivot is consultant scenario data (not realised, forecast or interpolated); a historical review keeps the version it measured against (its live rebuild differs from its issued
record only in that version's lifecycle status); issued reports keep their snapshot, rendering and PDF; Value Gap and
Value Leakage are separate numbers; draft and proposed versions are never the current plan. Every governance date is fixed
(4D.9N.1C): the decision, the VC-001 authorisation and Review #3 fall on 3 Oct 2026 (`CANONICAL.journeyDate`) whatever
day the journey runs, so forecast milestones always follow their review. Only the domain's own record timestamps
(recommendation issue, finalisation) use the clock; the canonical tests pin it to the journey date.

**Trajectory interaction and Evolution (4D.9N.1A, web only).** The primary and alternative trajectory charts add one
value-free cursor row per month without an explicit date, so the crosshair rests on every month while lines still join
only stored points. Tooltips (`src/ui/trajectory/cursor.ts`) state only governed values: the value on that date tagged
Entered / Formal / Scenario, otherwise Previous / Next stored values with their dates (Realised: the latest formal
checkpoint, or "no formal realised checkpoint yet"); the Value Gap appears only as "Value Gap at Value Period end". No
money is ever read off a visual join (tests trace every tooltip money string to a governed value). The primary chart
names its end labels and draws a period-end Value Gap bracket. Alternative paths that share their first stored
milestones with an earlier option are drawn once and branch at the last shared milestone; pivot / action markers come
only from notes stored on milestones, never from option names. Value Case Evolution is a server-rendered event chart:
a stepped Authorised Commitment from the Original Business Case, explicit version steps (with their Value Change), and
at each formal review a checkpoint (realised column, forecast marker, Value Gap bracket to the commitment measured
against), with an aligned strip of event values. Report charts are unchanged (a later, versioned phase).

**Known limitations / backlog (not implemented).**

- _Formal Assurance Evidence Snapshotting._ A finalised Formal Assurance Review should eventually preserve which evidence
  supported each Assurance matter at that checkpoint. Today matter evidence is a mutable working relationship
  (`evidence_link.value_leakage_id`) and is not snapshotted at finalisation, so the review story shows only the review's
  own formal evidence. Historical matter–evidence relationships are never inferred. Needs a schema change (PMO decision).
- _Pre-4D.1 matter state._ Reviews finalised before matters were captured at finalisation (`matter_snapshot_at` null)
  show current matter details rather than the matter as it stood then. No retrospective reconstruction or backfill.

**Phase 4D.9N is ACCEPTED AND FROZEN** (release lineage, DEMO-TRAJ2, accepted visual semantics, methodology principle
and recorded backlog: `docs/release/4d9n-freeze.md`).

## Client reports (Phase 4A)

```
Value Record → report read model (src/server/queries/reports.ts) → report model (src/domain/reports.ts)
             → HTML (src/ui/reports, one renderer) → preview page | issued view | Chromium PDF
             → report_issue (immutable snapshot + PDF reference)
```

- **One source of figures.** Report builders project the existing read models (`getRequalificationWorkspace`,
  `getVersionDetail`, `getAssuranceWorkspace`, `getReviewResponse`, `getValueChangeDetail`,
  `getInformationRequestWorkspace`); they add no calculations. Renderers only format.
- **One renderer.** Reports are rendered to strings with an escaping `html` template (`src/ui/reports/html.ts`), not
  React, because Next.js forbids `react-dom/server` in server code; the same string is embedded in the preview, the
  issued view and the PDF. Styles are one scoped stylesheet (`.vo-report`).
- **Client language, visible uncertainty.** Unquantified leakage renders "Not yet quantified" (never $0); incomplete
  forecasts render "Incomplete" with the blocking drivers; unattributed realised value is shown separately; an
  unreconciled proposed change is stamped NOT RECONCILED / NOT READY FOR AUTHORISATION. Only an issued recommendation
  appears. Value Gap and Value Leakage are never combined. "Next actions" lists only recorded follow-ups.
- **Issuing** (`src/server/reports/issue.ts`): build model → render issued HTML → PDF (Playwright/Chromium, JS
  disabled, network blocked) → store PDF → command `reports.issue`, which rebuilds the snapshot and refuses a stale
  one (`VO_REPORT_STALE`). `vo_report_issue_guard` (0008): insert only via `reports.issue` by the acting consultant at
  `now()`; subject must be issuable (IR issued/closed · V1 authorised/superseded · review finalised · change
  proposed/authorised) and `subject_status` must match it; `issue_number` is the next for that subject; update, delete
  and truncate are rejected.
- **Snapshot hash** = sha256 of canonical JSON (keys sorted) of the stored model — stable across environments.
  The PDF hash identifies the stored artefact; Chromium PDFs are not byte-identical across environments, so
  regeneration is not expected to reproduce it.
- **Storage** (`src/server/reports/storage.ts`): `DocumentStore` put/get by content-addressed key
  `reports/<sha256>.pdf`.
  - Adapters: `local` (`VO_REPORT_STORAGE_DIR`; development/test) and `s3` (any private S3-compatible bucket;
    required in production).
  - S3 writes use `If-None-Match: *`, so objects are never overwritten, and no ACL (objects stay private).
  - Every read is verified against the issue's recorded hash. PDFs are reachable only through the authenticated
    route.
  - If a PDF is missing, the issued snapshot remains viewable.
- **PDF runtime** (`VO_PDF_RUNTIME`): `playwright` (installed Chromium) or `serverless` (`@sparticuz/chromium`,
  Linux x64, same Chromium major as `playwright-core`; traced only into the report issue route).
- **Superseded V1:** a Re-Qualification Report previewed or issued after V1 was superseded carries a
  "Superseded — not current Authorised Value Case" stamp naming the version in force. Earlier issues are never
  rewritten.

## Money

`numeric(18,2)` in the database, decimal strings at boundaries, `decimal.js` for arithmetic
(`src/domain/money.ts`). JavaScript numbers are never used for money.

## Authentication and web security (Phase 4B)

- **Seam:** `getCurrentActor()` (`src/server/auth/actor.ts`) is the only place identity is established; SSO can
  replace password sessions there later. `app_user` remains the consultant identity.
- **Password mode** (default; the only mode in production): `app_credential` holds an scrypt hash
  (N=2¹⁵, r=8, p=1, per-user salt, parameters in the hash; constant-time verify; a dummy hash equalises timing
  for unknown accounts). Sign-in (`POST /api/auth/sign-in`, same-origin only) opens an `app_session`: the cookie
  carries 32 random bytes, and the database stores `HMAC-SHA256(VO_SESSION_SECRET, token)`. The cookie is
  `__Host-vo_session` in production: HttpOnly, Secure, SameSite=Lax, Path=/, expiring with the session
  (`VO_SESSION_TTL_HOURS`, default 12). Sign-out revokes the session server-side. Disabling an account revokes all
  its sessions. Credentials and sessions change only via `user.setPassword` / `user.disable` / `auth.signIn` /
  `auth.signOut` (trigger-checked, never deleted). Their audit rows redact `password_hash` and `token_hash`.
- **Dev mode:** `VO_DEV_USER_EMAIL`, implicit, for local development only. Refused by production configuration
  validation and again at resolution time.
- **Enforcement in depth:**
  1. `src/proxy.ts` redirects pages without a session cookie to `/sign-in`, and answers 401 to other requests.
     This is an optimistic check.
  2. Every page calls `requireConsultant()` (directly or via `requireProject`), every server action runs
     `perform()` → `getCurrentActor()`, and the PDF route checks the session. Each of these verifies against the
     database.
  3. `tests/auth/boundaries.test.ts` fails if any page, route or action skips this.
- **CSRF:** server actions carry Next.js's Origin/Host check. The auth routes require a matching `Origin`. Cookies
  are SameSite=Lax. Redirect targets are same-site paths only.
- **Headers:** a per-request nonce CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`,
  `object-src 'none'`, `form-action 'self'`). `style-src` allows inline styles for the report renderer. Also
  X-Frame-Options DENY, nosniff, Referrer-Policy same-origin, COOP, Permissions-Policy, noindex, HSTS (production)
  and `Cache-Control: private, no-store` (dynamic pages, PDFs, health).
- **Sensitive output:**
  - `/api/health` returns only `{status, database}`;
  - `/status` is for signed-in consultants only;
  - configuration errors name variables, never values;
  - storage errors omit credentials;
  - production error pages show Next's digest only.

## Production database role

Canonical production roles (Security B, 2026-10-04): **`vo_runtime`** — the least-privilege application runtime
identity (Vercel Production `DATABASE_URL` only); **`neondb_owner`** — the administrative / migration identity
(supplied only through the secure migration workflow, never in application runtime configuration); **`vo_app`** —
legacy, Neon-console-created role pending retirement that MUST NOT be used by the runtime. Rollback policy, recovery
branches and the Neon integration warning: `docs/release/security-b.md`.

Migrations run as the owner role. The app connects as a non-owner role granted DML only
(`src/server/db/role.ts`; re-granted after every migration when `VO_APP_DB_ROLE` is set). The audit functions are
`SECURITY DEFINER`, so the app role has no direct write access to `audit_event`. It also has no UPDATE or DELETE
on `report_issue`, no TRUNCATE, and no CREATE on `public`. Not owning the tables, it cannot alter or disable
triggers.

In the production tier (`VO_DEPLOYMENT_MODE=production` or unset), startup refuses a superuser, table-owner,
schema-CREATE, BYPASSRLS or CREATEROLE connection. The explicit **internal / pilot** tier (`VO_DEPLOYMENT_MODE=internal`)
accepts a provider-managed owner role (e.g. Neon), logging a warning. It may store PDFs in PostgreSQL
(`report_document`: insert-only via `reports.storeDocument`, sha256 re-checked by the database, bytes redacted from
audit). All triggers, auth and immutability are unchanged; see docs/deployment.md.
Remaining trust boundary: the app role sets `vo.actor_id`/`vo.command` itself. The database guards protect against
application bugs and misuse, not against a compromised application server.
Nothing else depends on how identity is established.

## Documents

Phase 1 stores document **references**: title, source, URI/location, optional filename/MIME/size/SHA-256.
Location, hash and file metadata are immutable (record a new document instead).
Upgrade path: add an upload action that writes to S3-compatible storage and fills `storage_key` + `sha256`;
no schema change needed.

## AI

Not wired. Client-data transmission to external AI providers is unapproved pending Cardaxia confirmation.
When added: `src/ai/` produces suggestions into its own table; consultants accept them through normal commands.

## Deliberately not built yet

Value Leakage (recoverable/unrecoverable), scenarios/alternative trajectories, Cardaxia recommendations, client
decisions, Value Changes (V2+), reports/PDF, charts, AI, automated scheduling/notifications, client portal,
production auth, binary document storage.

Domain-hardening candidates recorded in 4D.9N.1C.2 (not fixed): (1) a decision's `decidedOn` is not checked against
the recommendation's issue time (the database enforces only record order: no decision before issue); (2) forecast and
option milestones following their review date is documented and tested but not enforced by commands or the database;
(3) `reviewDate` is both the review's date and its formal "as at" date. Synthetic demo creation
(`src/fixtures/demo.ts`) takes its governance date from the database's `current_date` and keeps system timestamps real.
