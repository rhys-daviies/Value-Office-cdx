# Cardaxia Value Office

Consultant-operated Value Office application (MVP). Standalone — no dependency on `impaxia-platform`.

**Stack:** Next.js (App Router) · TypeScript strict · PostgreSQL 16 · Drizzle ORM · Zod · Tailwind · Vitest (real Postgres) · Playwright.
**Architecture:** one application + one database. See [docs/architecture.md](docs/architecture.md).

## Local setup

Requirements: Node 24+, PostgreSQL 16.

```bash
npm install
cp .env.example .env.local        # then adjust if needed
createdb -p 5433 value_office_dev
createdb -p 5433 value_office_test
npm run db:migrate
npm run db:seed:horizon           # optional: Project Horizon through Authorised V1
npm run dev                       # http://localhost:3000
npx playwright install chromium   # once: report PDFs, tests and e2e
```

> **This machine:** Homebrew PostgreSQL 16 runs on port **5433**, because a separate EDB PostgreSQL 18
> install (`/Library/PostgreSQL/18`) owns 5432. Adjust `DATABASE_URL` if your setup differs.

## Environment variables

All configuration is validated in [src/server/env.ts](src/server/env.ts); see [.env.example](.env.example) for every
variable. Production fails closed on unsafe or incomplete security configuration (see
[docs/deployment.md](docs/deployment.md)).

| Variable                                    | Purpose                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | Application database (production: the least-privilege `vo_app` role)                                     |
| `MIGRATION_DATABASE_URL`, `VO_APP_DB_ROLE`  | Migrations as the owner role, then re-grant the app role (operator machine only)                         |
| `TEST_DATABASE_URL` / `E2E_DATABASE_URL`    | Test / Playwright databases — **reset every run**; names must end in `_test` / `_e2e`                    |
| `VO_AUTH_MODE`                              | `password` (default; only mode in production) or `dev` (local convenience)                               |
| `VO_DEV_USER_EMAIL` / `_NAME`               | Local development identity (implies `dev` mode outside production; refused in production)                |
| `VO_SESSION_SECRET`, `VO_SESSION_TTL_HOURS` | Session-token HMAC key (≥ 32 chars) and lifetime                                                         |
| `VO_APP_ORIGIN`                             | Public origin (required in production)                                                                   |
| `VO_DEPLOYMENT_MODE`                        | Deployed tier: `internal` (pilot, non-sensitive data) or `production` (default; client data)             |
| `VO_REPORT_STORAGE` + `VO_S3_*`             | `local` (dev/test), `database` (internal tier) or `s3` (private bucket; required in the production tier) |
| `VO_PDF_RUNTIME`                            | `playwright` (local Chromium) or `serverless` (`@sparticuz/chromium`, Vercel)                            |

## Sign-in (Phase 4B)

Consultants sign in with email + password at `/sign-in` (no public sign-up, no client accounts). Accounts are
created by an operator:

```bash
npm run user:create -- --email rhys@cardaxia.ai --name "Rhys Davies"   # password prompted, hidden
```

Locally, `VO_DEV_USER_EMAIL` keeps the implicit development identity; deployed servers never allow it.
Deployment has two explicit tiers: **internal / pilot** (Vercel + Neon, three variables) and **production /
client data** (restricted DB role, private S3). See [docs/deployment.md](docs/deployment.md).

## Consultant workflow (Phase 1)

`/projects` → create project → **Setup** (context, Value Basis, key dates, stakeholders, VCO, document references) →
**Information Request** → **Value Case** (capture and record inherited V0) → **Evidence** → **Re-Qualification**
(draft V1 against V0, edit drivers, propose, record VCO authorisation) → **Authorised V1**. **History** shows the audit
trail per command. `/status` is an operational check.

## Value Assurance (Phase 2)

**Assurance** → open a review (trigger, date, optional triggering evidence) against the Authorised Value Case in force
→ record what changed and link evidence → enter each driver's Current Forecast and cumulative Realised Value with
rationale → see movement, Value Gap and totals → finalise (immutable). The next review measures movement against the
latest finalised review. Mandatory cadence (kick-off, Go-Live, six-monthly, material evidence) is derived and shown,
never scheduled (six-monthly is anchored on Go-Live).

## Management response and Value Change (Phase 3)

In a review: identify **Value Leakage** (Total = Recoverable + Unrecoverable; recoverable until evidence shows loss) →
enter **options / alternative trajectories** (consultant-entered totals) → draft and **issue Cardaxia's
recommendation** (then options freeze) → record the **client / AVO decision** (client-elected difference is
derived) → if the Authorised Value Case must change, prepare a **Value Change**: it copies the version in force into a
draft V<n+1>, the consultant adjusts the affected drivers until they reconcile to the stated change, proposes it, and
records the **VCO's authorisation** with evidence — atomically superseding the old version and authorising the new
one. Changes live under **Value Changes**.

## Client reports (Phase 4A)

**Reports** lists every report subject and every issued report. Four outputs are generated from the Value Record —
**Information Request**, **Re-Qualification Report** (V1), **Value Assurance Report** (finalised review) and **Value
Change Notice** (proposed or authorised change). Open a preview (draft, not issued) → review → confirm → **Issue
report**: the server snapshots the report model, renders it to PDF with Chromium, stores the PDF and records an
immutable issue (issuer, time, subject, subject status, snapshot and PDF SHA-256). A later issue is a new record.
Reports also link from the Information Request, Re-Qualification, review and Value Change pages.

> Next.js allows one `next dev` per checkout: stop your own dev server before `npm run test:e2e`.

## Database and migrations

- Schema source of truth: [src/server/db/schema.ts](src/server/db/schema.ts).
- Integrity, immutability and audit triggers: [drizzle/0001_integrity_and_audit.sql](drizzle/0001_integrity_and_audit.sql) (hand-written).
- Change the schema → `npm run db:generate` → review the SQL → `npm run db:migrate`.
- Hand-written SQL (triggers/functions): `npx drizzle-kit generate --custom --name=<name>`.
- `npm run db:verify` fails if `schema.ts` and the committed migrations have drifted.

## Scripts

| Script                                                       | What it does                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                | Dev server                                                                                                            |
| `npm run build` / `start`                                    | Production build / serve                                                                                              |
| `npm run typecheck`                                          | Route typegen + `tsc --noEmit`                                                                                        |
| `npm run lint`                                               | ESLint, including architecture-boundary rules                                                                         |
| `npm run format[:check]`                                     | Prettier                                                                                                              |
| `npm test`                                                   | Vitest: domain + database invariant tests against `TEST_DATABASE_URL`                                                 |
| `npm run test:e2e`                                           | Playwright: smoke, Horizon UI acceptance, consultant golden path (own dev server on :3100 against `E2E_DATABASE_URL`) |
| `npm run db:migrate`                                         | Apply migrations to `DATABASE_URL`                                                                                    |
| `npm run db:seed:horizon`                                    | Seed Project Horizon through the public commands (idempotent)                                                         |
| `npm run reports:smoke`                                      | Render Horizon's reports to PDF (read-only PDF generation smoke test)                                                 |
| `npm run user:create` / `user:set-password` / `user:disable` | Operator account management (password prompted or `--password-stdin`)                                                 |
| `npm run db:check-role`                                      | Verify `DATABASE_URL` is a least-privilege application role                                                           |
| `npm run smoke:deploy`                                       | Deployment smoke test against `SMOKE_BASE_URL` (see docs/deployment.md)                                               |
| `scripts/production-smoke.sh`                                | CI: production-like server (app role, password auth, fake S3) + deployment smoke                                      |
| `npm run fixture:horizon:align -- --confirm`                 | Dev only: align an older Horizon fixture's VL-001 narrative with the canonical seed                                   |
| `npm run verify`                                             | typecheck + lint + format + tests + build                                                                             |

CI (`.github/workflows/ci.yml`) runs all of the above against a fresh PostgreSQL 16 service.
