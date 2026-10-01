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
