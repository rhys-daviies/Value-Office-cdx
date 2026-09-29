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
drizzle/            Migrations (0000 generated schema, 0001 hand-written integrity/audit).
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

| Version | Kind                      | Lifecycle                                           |
| ------- | ------------------------- | --------------------------------------------------- |
| V0      | `inherited_business_case` | `draft → recorded` (locked)                         |
| V1      | `value_case`              | `draft ⇄ proposed → authorised` (locked)            |
| V2+     | `value_case`              | via approved Value Change — **not yet implemented** |

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
evidence_link     + assurance_review_id target (review-relevant evidence)
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

## Money

`numeric(18,2)` in the database, decimal strings at boundaries, `decimal.js` for arithmetic
(`src/domain/money.ts`). JavaScript numbers are never used for money.

## Authentication

Development only: the actor is `VO_DEV_USER_EMAIL`, auto-provisioned as an `app_user`. Production builds refuse
to resolve an actor until a real identity provider (Auth.js + Entra/Google) replaces `getCurrentActor()`.
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
