# Deployment runbook — Vercel (internal Cardaxia use)

The Value Office is one Next.js app on Vercel with a managed PostgreSQL database. It is independent of Impaxia:
separate repository, project and database, with no runtime dependency. There are two deployment tiers, chosen
explicitly with `VO_DEPLOYMENT_MODE`:

| Tier                            | `VO_DEPLOYMENT_MODE`    | Use                                                        |
| ------------------------------- | ----------------------- | ---------------------------------------------------------- |
| **A. Internal / pilot**         | `internal`              | Demo and internal, **non-sensitive** data. Fastest set-up. |
| **B. Production / client data** | `production` (or unset) | Required before any sensitive client data is stored.       |

An unset mode is treated as `production`. An unknown value stops the server. Nothing ever silently downgrades to
`internal`.

**What stays the same in both tiers:**

- sign-in is required everywhere, and the development identity is always refused;
- sessions are secure (`__Host-` Secure HttpOnly cookie, server-side revocation);
- audit logging, command enforcement, authorised Value Case and Value Change controls, and issued-report
  immutability (all enforced by database triggers, which fire for every role);
- security headers, CSP, `no-store` and a minimal health endpoint.

**What the internal tier relaxes:**

- the app may connect as the provider-managed role (Neon's `neondb_owner`). A table owner _could_ disable
  triggers; the app never does, but the database no longer prevents it;
- issued PDFs may be stored in PostgreSQL instead of a private S3 bucket.

The UI shows an "Internal pilot — no sensitive client data" badge in this tier.

---

## A. Internal / pilot — quickest Vercel deployment

1. **Import** the GitHub repository into Vercel (default Next.js settings; Node 24 comes from `package.json`).
2. **Connect Neon** through the Vercel integration. It sets `DATABASE_URL` (pooled, `neondb_owner`) and
   `DATABASE_URL_UNPOOLED`.
3. **Run migrations** once, from a developer machine, with the Neon owner connection. They are re-runnable and
   apply only what's missing:
   ```bash
   MIGRATION_DATABASE_URL='<DATABASE_URL_UNPOOLED from Vercel/Neon>' npm run db:migrate
   ```
4. **Set three variables** in Vercel (Settings → Environment Variables → _Production_):

   | Variable             | Value                            |
   | -------------------- | -------------------------------- |
   | `VO_DEPLOYMENT_MODE` | `internal`                       |
   | `VO_SESSION_SECRET`  | output of `openssl rand -hex 32` |
   | `VO_REPORT_STORAGE`  | `database`                       |

   Derived automatically on Vercel in this tier:
   - `VO_APP_ORIGIN` = `https://$VERCEL_PROJECT_PRODUCTION_URL`. Set it explicitly if you use a custom domain.
     Sign-in only works on that origin; preview URLs are refused.
   - `VO_PDF_RUNTIME` = `serverless` (bundled Chromium).

   Do **not** set `VO_DEV_USER_EMAIL` or `VO_AUTH_MODE=dev`. The server refuses to start with either.

5. **Create consultant accounts.** The password is prompted and hidden:
   ```bash
   DATABASE_URL='<DATABASE_URL from Vercel/Neon>' npm run user:create -- --email rhys@cardaxia.ai --name "Rhys Davies"
   ```
6. **Deploy** (redeploy after changing environment variables). The function log shows
   `configuration ok: deployment=internal … db-role=provider-managed`, preceded by the INTERNAL / PILOT warning.
7. **Smoke test:**
   ```bash
   read -rs SMOKE_PASSWORD && export SMOKE_PASSWORD
   SMOKE_BASE_URL=https://<project>.vercel.app SMOKE_EMAIL=rhys@cardaxia.ai npm run smoke:deploy
   ```
   This creates one project, "Deployment smoke <timestamp>".

No PostgreSQL role creation, S3 bucket or IAM set-up is needed. CI exercises exactly this tier on every push
(`SMOKE_MODE=internal ./scripts/production-smoke.sh`).

**Why not Vercel's local disk for PDFs?** Only `/tmp` is writable, and it is per instance and ephemeral. An issued
PDF would disappear, or be missing on the next instance, so the internal tier stores PDFs in PostgreSQL instead. That
store is insert-only, content-addressed, and hash-checked by the database and on every read. It is suitable for pilot
volumes, since a PDF is typically 50–200 KB.

**Moving from A to B later:**

- set up the production-tier items below (restricted role, S3 bucket, `VO_DEPLOYMENT_MODE=production`);
- redeploy;
- PDFs issued in the internal tier stay in `report_document` and remain readable only while
  `VO_REPORT_STORAGE=database`. Copying them to S3 before switching is a one-off step to plan, if pilot issues must
  be kept.

---

## B. Production / client data — hardened deployment

Everything below is the Phase 4B posture, and is required before sensitive client data is used. Set
`VO_DEPLOYMENT_MODE=production` (or leave it unset).

```
Browser ──HTTPS──► Vercel (Next.js 16, Node 24 functions)
                     ├─ auth: email + password → opaque session (Postgres)
                     ├─ server actions → commands → PostgreSQL (least-privilege app role)
                     └─ report issue → serverless Chromium → PDF → private S3 bucket
```

### What the runtime needs (verified)

| Requirement          | How it is met on Vercel                                                                                                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js 16, Node 24  | Framework auto-detected. `engines.node = "24.x"` selects Node 24. No `vercel.json` is needed.                                                                                                                                                                                                |
| Server actions, auth | Node.js runtime (no Edge). `src/proxy.ts` runs on Node (Next 16 default).                                                                                                                                                                                                                    |
| PDF packaging        | Vercel ships only traced files. `outputFileTracingIncludes` adds what `@sparticuz/chromium` and `playwright-core` load by computed path (bin/*.br, browsers.json). After every CI build, `npm run verify:bundle -- --launch` rebuilds the function from its trace and renders a PDF from it. |
| PDF generation       | `VO_PDF_RUNTIME=serverless` → `@sparticuz/chromium@153` (the same Chromium major as `playwright-core@1.63`), traced into only the report-preview/issue function (~86 MB of the 250 MB limit). CI renders all Horizon reports with it on Linux x64.                                           |
| Function limits      | Issuing sets `maxDuration = 60` s. The default 2 GB function memory is enough (Chromium needs ≈1–1.6 GB). A cold start adds a few seconds to the first issue.                                                                                                                                |
| Database             | Any managed PostgreSQL ≥ 15 that allows creating a second role (Neon via the Vercel Marketplace, Supabase, AWS RDS). Use the pooled connection string for `DATABASE_URL`.                                                                                                                    |
| Report storage       | Private S3-compatible bucket (`VO_REPORT_STORAGE=s3`). PDFs are served only through the authenticated `/…/pdf` route.                                                                                                                                                                        |
| Health               | `GET /api/health` → `{"status":"ok","database":"ok"}` (public, no infrastructure detail).                                                                                                                                                                                                    |

**Plan:** internal commercial use needs a Vercel **Pro** team, which Cardaxia already has for Impaxia. Hobby is
non-commercial.

### Roles and secrets

| Item                      | Where it lives                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Migration (owner) role    | Operator machine only (`MIGRATION_DATABASE_URL`). Owns the schema, tables and integrity functions.           |
| Application role `vo_app` | Vercel `DATABASE_URL`. DML only: cannot alter or disable triggers, write audit rows, or edit issued reports. |
| `VO_SESSION_SECRET`       | Vercel (Production). ≥ 32 random chars. Rotating it signs everyone out.                                      |
| S3 key pair               | Vercel (Production). Scoped to the one bucket and prefix, Put and Get only.                                  |
| Consultant passwords      | Typed at the `user:create` prompt. Stored only as scrypt hashes.                                             |

The production tier refuses to start if any of the following is true:

- `VO_AUTH_MODE=dev`, or `VO_DEV_USER_EMAIL` is set;
- the session secret is missing or shorter than 32 characters;
- `VO_APP_ORIGIN` is missing;
- storage is not `s3`, or the S3 settings are incomplete;
- `VO_PDF_RUNTIME` is unset;
- `DATABASE_URL` connects as a superuser, a table owner, or a role able to create in `public`.

Errors name the variable, never its value.

### Initial deployment

1. **[Cardaxia] Create the Vercel project** from `rhys-daviies/Value-Office-cdx`, in the Cardaxia team. Use the
   default framework settings: build `npm run build`, install `npm ci`. Restrict preview deployments (see
   _Previews_ below).
2. **[Cardaxia] Provision PostgreSQL.** Either use Neon through the Vercel Marketplace (**Storage → Create
   database**), or a Cardaxia-managed provider. Record the owner connection string (for migrations) and the
   pooled host.
3. **Create the application role** as the owner:
   ```sql
   CREATE ROLE vo_app LOGIN PASSWORD '<generated>';  -- run in the provider's SQL console
   ```
   The grants are applied by the migration step. Keep `vo_app` free of `CREATEROLE`, `BYPASSRLS` and superuser.
4. **[Cardaxia] Set the production environment variables** (Vercel → Settings → Environment Variables,
   _Production_):
   `DATABASE_URL` (the `vo_app` user on the pooled host), `VO_SESSION_SECRET`, `VO_APP_ORIGIN`,
   `VO_REPORT_STORAGE=s3`, `VO_S3_BUCKET`, `VO_S3_REGION`, `VO_S3_ACCESS_KEY_ID`, `VO_S3_SECRET_ACCESS_KEY`,
   `VO_PDF_RUNTIME=serverless`, `VO_DEPLOYMENT_MODE=production`, and optionally `VO_DB_POOL_MAX=5`, `VO_S3_PREFIX`, `VO_S3_ENDPOINT` (R2) and
   `VO_SESSION_TTL_HOURS`. Do **not** set `VO_DEV_USER_EMAIL`, `VO_AUTH_MODE=dev` or `MIGRATION_DATABASE_URL`.
5. **[Cardaxia] Create the private bucket** (see _Object storage_) and its access key.
6. **PDF runtime:** there's nothing to install. `VO_PDF_RUNTIME=serverless` is enough.
7. **Run migrations** from an operator machine, with the owner URL:
   ```bash
   MIGRATION_DATABASE_URL='<owner url>' VO_APP_DB_ROLE=vo_app npm run db:migrate
   DATABASE_URL='<vo_app url>' npm run db:check-role     # must print ✓ … least-privilege
   ```
8. **Create the consultant accounts** (Rhys, John, Mike). The password is prompted and hidden; it is never an
   argument:
   ```bash
   DATABASE_URL='<vo_app url>' npm run user:create -- --email rhys@cardaxia.ai --name "Rhys Davies"
   ```
   Later: `npm run user:set-password -- --email …` and `npm run user:disable -- --email …`. Disabling revokes the
   account's sessions immediately.
9. **Deploy** (Vercel → Deploy, or push to `main`).
10. **Verify health:** `curl https://<origin>/api/health` returns `{"status":"ok","database":"ok"}`. The
    function log shows
    `configuration ok: deployment=production auth=password storage=s3 pdf=serverless db-role=least-privilege`.
11. **Sign in** at `https://<origin>/sign-in`.
12. **Open or create a project.** Creating one is also the mutation step (13).
13. **Perform a mutation**, for example add a key date.
14. **Verify the audit actor:** the project's **History** shows your name and email against the change.
15. **Preview a report:** Reports → Preview.
16. **Issue a test report:** confirm, then **Issue report**. Allow up to about 20 s on a cold start.
17. **Retrieve the PDF:** **Download PDF**.
18. **Verify the PDF hash:** `shasum -a 256 <file>` must equal _PDF SHA-256_ on the issued page. The route also
    checks this on every read.
19. **Sign out.**
20. **Verify protected access:** `/projects` redirects to sign-in, and the PDF URL redirects too.
21. **Verify database integrity:** run `npm run db:check-role` (step 7). Optionally, as `vo_app`, confirm that
    `update report_issue set title = 'x'` fails with `permission denied`.

Steps 10–20 are automated. Use test-only credentials, or a dedicated smoke account that you disable afterwards:

```bash
read -rs SMOKE_PASSWORD && export SMOKE_PASSWORD
SMOKE_BASE_URL=https://<origin> SMOKE_EMAIL=<account> npm run smoke:deploy
```

The smoke test creates one project, named `Deployment smoke <timestamp>` under client "Cardaxia — deployment smoke
test". It is ordinary audited data.

### Update deployment

1. Review the release: CI must be green on the exact commit.
2. **Migrate first** (step 7 command). Migrations so far are additive, so the running version keeps working on the
   new schema. The command re-applies the `vo_app` grants for any new tables.
3. Deploy the commit (push to `main` or promote in Vercel).
4. Smoke: health, sign in, open a project, and `npm run smoke:deploy` for larger releases.
5. **Rollback:** Vercel _Instant Rollback_ restores the previous build. The database is not rolled back:
   migrations are forward-only, so rolling back code over an additive migration is safe. A destructive migration
   would need its own reviewed plan; none exists today. Issued reports and audit rows are never rewritten.

### Object storage

**Recommended: AWS S3.** Impaxia already uses S3 for private attachments, so Cardaxia's AWS account and practices
apply. Use a **separate bucket** for the Value Office. Cloudflare R2 (`VO_S3_ENDPOINT`, region `auto`) is an
alternative.

Bucket settings:

- **Block all public access** is on;
- default encryption (SSE-S3) is on;
- no bucket policy grants anonymous access;
- versioning is optional.

Objects are content-addressed and never overwritten, since writes use `If-None-Match: *`. Versioning therefore
mainly protects against deletion.

Minimal IAM policy for the app's key:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::<bucket>/<prefix>*" }
  ]
}
```

The app never deletes objects, and never generates public or pre-signed URLs.

### Previews

Preview deployments must never receive production secrets or the production database. Either:

- disable previews for this project; or
- give the Preview environment its own database, bucket and secret.

A preview deployment with no `VO_APP_ORIGIN` fails closed at startup, which is intended. Enable Vercel Deployment
Protection for previews.

## Both tiers

### Backups and recovery (requirements; nothing is configured by this repository)

- **PostgreSQL** holds the whole Value Record, including the audit trail and issued-report snapshots.
  - Enable the provider's managed backups with point-in-time recovery. Retention should be at least 14 days; 30 is
    better.
  - Document who can restore.
  - Restore procedure: restore to a new database, re-create or re-grant `vo_app`, run `npm run db:check-role`,
    then repoint `DATABASE_URL`.
  - Test a restore before relying on it, then periodically.
- **Internal tier:** issued PDFs are in PostgreSQL (`report_document`), so the database backups cover them.
- **Object storage** holds the issued PDFs in the production tier.
  - S3 is designed for very high durability. Keep the bucket private.
  - Optionally enable versioning or replication.
  - If a PDF is lost, the issue record and its immutable snapshot remain in Postgres and are viewable. The PDF can
    be regenerated from the snapshot, but not byte-identically, so its recorded hash would not match.
- Neither is claimed as configured until Cardaxia has done so.

### Local development

This repository changes nothing about local development: dev identity (`VO_DEV_USER_EMAIL`), local PDF storage
and Playwright Chromium, as before. To try password sign-in locally:

- set `VO_AUTH_MODE=password` and `VO_SESSION_SECRET`;
- run `npm run user:create -- …`.

`npm run fixture:horizon:align -- --confirm` (development only) updates an older Horizon fixture's VL-001 narrative
to the canonical seed. It refuses production and touches nothing but the Horizon fixture.
