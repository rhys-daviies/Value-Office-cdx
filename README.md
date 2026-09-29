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
npx playwright install chromium   # once, for e2e tests
```

> **This machine:** Homebrew PostgreSQL 16 runs on port **5433**, because a separate EDB PostgreSQL 18
> install (`/Library/PostgreSQL/18`) owns 5432. Adjust `DATABASE_URL` if your setup differs.

## Environment variables

| Variable            | Required | Purpose                                                                         |
| ------------------- | -------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`      | yes      | Application database                                                            |
| `TEST_DATABASE_URL` | tests    | Test database. **Reset on every test run**; name must end in `_test`            |
| `VO_DEV_USER_EMAIL` | dev      | Development identity (consultant). Ignored — and refused — in production builds |
| `VO_DEV_USER_NAME`  | no       | Display name for the dev identity                                               |

## Database and migrations

- Schema source of truth: [src/server/db/schema.ts](src/server/db/schema.ts).
- Integrity, immutability and audit triggers: [drizzle/0001_integrity_and_audit.sql](drizzle/0001_integrity_and_audit.sql) (hand-written).
- Change the schema → `npm run db:generate` → review the SQL → `npm run db:migrate`.
- Hand-written SQL (triggers/functions): `npx drizzle-kit generate --custom --name=<name>`.
- `npm run db:verify` fails if `schema.ts` and the committed migrations have drifted.

## Scripts

| Script                    | What it does                                                          |
| ------------------------- | --------------------------------------------------------------------- |
| `npm run dev`             | Dev server                                                            |
| `npm run build` / `start` | Production build / serve                                              |
| `npm run typecheck`       | Route typegen + `tsc --noEmit`                                        |
| `npm run lint`            | ESLint, including architecture-boundary rules                         |
| `npm run format[:check]`  | Prettier                                                              |
| `npm test`                | Vitest: domain + database invariant tests against `TEST_DATABASE_URL` |
| `npm run test:e2e`        | Playwright smoke tests (starts a dev server on :3100)                 |
| `npm run db:migrate`      | Apply migrations to `DATABASE_URL`                                    |
| `npm run db:seed:horizon` | Seed Project Horizon through the public commands (idempotent)         |
| `npm run verify`          | typecheck + lint + format + tests + build                             |

CI (`.github/workflows/ci.yml`) runs all of the above against a fresh PostgreSQL 16 service.
