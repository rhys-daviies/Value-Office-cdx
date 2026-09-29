# Architecture

Priorities: speed → simplicity → correctness/auditability → maintainability → future reuse.

## Shape

One Next.js application, one PostgreSQL database. No separate API, workers, queues, Redis or agent frameworks.

```
src/
  app/              UI routes (server components). Reads via queries, writes via commands only.
  domain/           Pure rules and values: money, status vocabularies, errors. No I/O.
  server/
    auth/           Authentication seam: getCurrentActor(). Only place that knows how identity is established.
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

Assurance reviews, value positions, leakage, scenarios, recommendations, decisions, Value Changes (V2+),
reports/PDF, charts, AI, client portal, production auth, binary document storage.
