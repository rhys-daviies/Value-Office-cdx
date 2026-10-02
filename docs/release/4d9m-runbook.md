# Phase 4D.9M release runbook — Value Trajectory (migrations 0019–0020)

Prepared and rehearsed in Phase 4D.9L. **Nothing here has been run against production.** Each production step
needs PMO authorisation at the time. Never print or paste connection strings, passwords or session secrets.

|                              | Before                                                       | After                                                                    |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Application (Vercel, `main`) | `a5e960d`                                                    | the 4D.9L release-candidate commit (recorded in the 4D.9L report)        |
| Database (Neon)              | 19 migrations, last `0018_phase4d3_living_drivers_integrity` | 21 migrations, last `0020_phase4d9c_value_trajectory_integrity`          |
| Report renderer              | `report-html-2` (model v2)                                   | `report-html-3` (model v3); v1/v2 issued reports render byte-identically |
| Tier                         | internal; runtime role `vo_app`; PDFs in `report_document`   | unchanged                                                                |

Migration file hashes (`drizzle.__drizzle_migrations.hash` = sha256 of the file):

- `0019_phase4d9c_value_trajectory` — `40cd6382df4b0033aaf068ab983059d52ca00ce4cca25d49279713712a7be4bc`
- `0020_phase4d9c_value_trajectory_integrity` — `f54c6863e97204555945126803ae1696a08333d9c383cb0ab2eb46fe818bfae6`

## Order: migrate first, then push

Evidence from the 4D.9L rehearsal on a production-shaped database:

- **Deploy first is unsafe.** The release candidate on an unmigrated 0018 database fails on the Overview, the
  Value Case page and report previews (`column "value_basis_kind" does not exist`).
- **Migrate first is safe.** Production code `a5e960d` on the migrated 0020 database reads every project and every
  page model, renders all v1/v2 issued reports, and runs matters, review finalisation, report issue and a full Value
  Change lifecycle (create → propose → authorise).
- Pushing `main` auto-deploys on Vercel, so the push **is** the deploy. Migrate, verify, then push.

The migration is DDL only (one transaction, about 0.6 s in rehearsal). It changes no existing row and writes no audit
rows. It takes brief locks on `value_case_version`, `scenario`, `assurance_review` and `recommendation` to add
columns, constraints and triggers.

### Compatibility window (migrated database, `a5e960d` still serving)

- Safe: every existing operation, including report issue (still model v2 / `report-html-2`).
- Not available: trajectory features (no UI in `a5e960d`). Nothing can create trajectory data in this window.
- Keep the window short (minutes). Avoid issuing client reports in it, so the first post-release issues are v3.

## Steps

1. **Freeze and confirm.**
   - Confirm `origin/main` is still `a5e960d` and that the RC commit is the one 4D.9L recommended.
   - Ask users not to work in the app during the release.
2. **Backup / recovery point (required).**
   - Create a Neon branch (or snapshot) of the production branch named `pre-4d9m-<date>`.
   - Record its timestamp/LSN.
   - Confirm point-in-time restore covers the release window.
3. **Before fingerprint.**
   - Run `docs/release/4d9m-fingerprint.sql` with psql against production, from Rhys's terminal using the
     hidden-prompt connection script. It is read-only.
   - Save the output privately; it contains hashes only.
   - Confirm `migrations = 19` and that the last hash is 0018's.
4. **Migrate** as the owner role (`neondb_owner`, unpooled URL), re-applying `vo_app` grants. Run from the RC checkout:
   `MIGRATION_DATABASE_URL=<owner unpooled> VO_APP_DB_ROLE=vo_app npm run db:migrate`
   - Expect "Migrations applied" and "Application role grants applied to vo_app".
5. **After fingerprint.**
   - Run the same SQL and diff it against step 3.
   - The only allowed difference is `migrations 19 → 21` and the two new migration rows with the hashes above.
   - Any other difference: **STOP** — do not push; go to _Recovery_.
6. **Old app on the new schema (spot check).** On production (`a5e960d`), confirm health and that one project's
   Overview and an issued report open.
7. **Deploy.** Push the RC commit to `main` and wait for the Vercel production deployment of that exact commit.
8. **Verify** (checklist below).

## Production verification checklist (bounded; no trajectory data created in production)

1. **Migration head:**
   - `select count(*) from drizzle.__drizzle_migrations` = 21;
   - the last two hashes are as above;
   - `select count(*) from value_trajectory_point` = 0;
   - no `value_case_version` row has a basis kind or Value Period.
2. **Application health:** `/api/health` → `{"status":"ok","database":"ok"}`. The deployment log shows
   `configuration ok: deployment=internal auth=password storage=database … db-role=least-privilege`.
3. **DB health:** run `npm run db:check-role` with the runtime `DATABASE_URL`; it reports `vo_app` as least-privilege.
4. **Authentication:** sign in with an existing account; a wrong password is refused.
5. **Protected routes:** signed out, `/projects` and an issued-report PDF URL both redirect to sign-in.
6. **Representative legacy project** opens.
7. **Overview:** value position unchanged from before the release. The decision card reads "Latest recorded value
   decision" with "Source: Review #N …". Value Case summary unchanged.
8. **Assurance:** the review list and a finalised review open, with figures unchanged.
9. **Value Case:**
   - the commitment and history are unchanged;
   - the trajectory panel says "Value Basis not classified";
   - Value Changes open.
10. **Reports:** the reports page lists the existing issues.
11. **Historical issued report:**
    - open one issued before the release; its content is as before;
    - download its PDF; it opens, and its sha256 equals `report_issue.document_sha256`.
12. **Trajectory missing state on legacy data:** an explicit unavailable state is shown — never a chart with invented
    values.
13. **No unexpected server errors:** Vercel runtime logs show no 5xx or exceptions during the checks.
14. **Security headers on `/sign-in`:**
    - `content-security-policy` (`default-src 'self'`);
    - `x-frame-options: DENY`;
    - `x-content-type-options: nosniff`;
    - `strict-transport-security`;
    - `referrer-policy: same-origin`.
15. **Production data fingerprints:** rerun `4d9m-fingerprint.sql` after the checks. It matches step 5, except that
    sign-ins add `app_session` rows; audit counts change only if data was edited.

Trajectory acceptance in production uses only data intentionally created later through the governed adoption path (a
Value Change that classifies the basis and phases the plan). Do not create trajectory data just to test.

## Recovery

| Situation                                             | Action                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration fails                                       | One transaction: nothing is applied. Production stays at 0018 and `a5e960d` keeps serving. Do not push. Investigate.                                                  |
| Migration succeeds, fingerprint differs unexpectedly  | Do not push. Hold the database (`a5e960d` stays compatible), report to PMO. If data must be restored, restore from the `pre-4d9m` branch / PITR.                      |
| Migration succeeds, deploy fails (build/Vercel error) | Production keeps serving `a5e960d` on the migrated schema (rehearsed as safe). Fix forward or retry; no database action.                                              |
| Deploy succeeds, health/manual checks fail            | Vercel _Instant Rollback_ to the `a5e960d` deployment. The 0020 schema stays (additive; `a5e960d` is compatible). Do not roll the database back unless data is wrong. |
| Data found wrong after release                        | Restore the `pre-4d9m` branch / PITR (loses changes made since), after PMO decision.                                                                                  |

### Application rollback after the new release has been used

Rehearsed with `a5e960d` on a database where the release had already been used: classified versions, plans and v3
reports present.

- All pages and v1/v2 reports keep working, and stored PDFs (including v3) are served unchanged.
- **Limit:** the old app's on-screen view of an issued v3 report omits the v3 Value Trajectory sections. The stored
  PDF is complete.
- **Limit:** the old app cannot create a Value Change on a trajectory-classified project. The database refuses it
  with `VO_VALUE_BASIS_KIND_CHANGE`, failing closed rather than corrupting data.
- So, after trajectory adoption, roll forward rather than back where possible.

There is no down-migration. Removing 0019/0020 would need its own reviewed plan; it is not needed for application
rollback.
