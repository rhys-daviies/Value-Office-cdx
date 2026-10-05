"""4D.10 production migration runner (0020 → 0026). Run by Rhys in his own terminal; never by an agent with the secret.

  python3 scripts/release/migrate-production.py                 production: owner connection string read with a hidden
                                                                prompt (never echoed, stored, logged or written)
  python3 scripts/release/migrate-production.py --rehearse URL --rehearse-target FILE
                                                                localhost-only rehearsal of this runner

It refuses unless: the checkout is the accepted release (27 migrations, head 0026, clean); the connection is
neondb_owner on the UNPOOLED host with TLS (production); the connection POSITIVELY IS the accepted production target —
host, port, database and the server's own Neon identity (neon.project_id / neon.branch_id / neon.endpoint_id from its
configuration file) all equal scripts/release/production-target.json (R2B: a recovery branch is a byte-identical clone
of production, so a 0020 database proves nothing about WHICH branch it is); the database is exactly at 0020 with the
repository's 0000–0020 hashes. There is no override for the production target. The operator then confirms the branch
name shown in the Neon Console and types MIGRATE. It runs the standard `db:migrate` (MIGRATION_DATABASE_URL +
VO_APP_DB_ROLE=vo_runtime, which re-applies the runtime grants), re-checks the target identity and verifies the head is
exactly 0026 with the repository's hashes. The credential exists only in this process's memory and its child; nothing
is written to disk. Output is scrubbed."""

import argparse, getpass, hashlib, json, os, re, subprocess, sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import neon_target  # noqa: E402

PRE_HEAD, POST_HEAD = 21, 27
POST_TAG = "0026_phase4d10h_value_change_determination_integrity"

ap = argparse.ArgumentParser()
ap.add_argument("--rehearse", help="localhost database URL (rehearsal of this runner only)")
ap.add_argument("--rehearse-target", help="rehearsal only: the target file the localhost database must match")
args = ap.parse_args()

SECRETS = []
def scrub(s):
    for v in SECRETS:
        if v: s = s.replace(v, "<redacted>")
    return re.sub(r"postgres(ql)?://\S+", "<redacted>", s)
def say(s=""): print(scrub(str(s)), flush=True)
def stop(why): say(f"STOP: {why}"); sys.exit(1)

if bool(args.rehearse) != bool(args.rehearse_target): stop("--rehearse and --rehearse-target go together (production always uses production-target.json)")
journal = json.load(open(f"{REPO}/drizzle/meta/_journal.json"))
tags = [e["tag"] for e in journal["entries"]]
local = [hashlib.sha256(open(f"{REPO}/drizzle/{t}.sql", "rb").read()).hexdigest() for t in tags]
if len(local) != POST_HEAD or tags[-1] != POST_TAG: stop(f"this checkout is not the accepted release (has {len(local)} migrations, head {tags[-1]})")
status = subprocess.run(["git", "status", "--porcelain"], cwd=REPO, capture_output=True, text=True).stdout.strip()
if status and not args.rehearse: stop("the release checkout has uncommitted changes")
if status: say("  note  rehearsal from an uncommitted checkout (production refuses this)")
head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO, capture_output=True, text=True).stdout.strip()
try:
    target = neon_target.load_target(args.rehearse_target or neon_target.PRODUCTION_TARGET, production=not args.rehearse)
except (OSError, ValueError) as e:
    stop(f"target file refused: {e}")

if args.rehearse:
    url = args.rehearse
    p = urlsplit(url)
    if p.hostname not in ("localhost", "127.0.0.1"): stop("--rehearse accepts only a localhost database")
    env_ssl = "disable"
else:
    say(f"Expected target: {target['name']} — Neon branch `{target['branch_name']}`, endpoint {target['settings']['neon.endpoint_id']}")
    url = getpass.getpass("neondb_owner UNPOOLED connection string for branch main (hidden, not stored): ").strip()
    p = urlsplit(url)
    if p.username != "neondb_owner": stop("the connection string is not for neondb_owner")
    if "-pooler" in (p.hostname or ""): stop("use the UNPOOLED host for migrations")
    env_ssl = "require"
SECRETS += [url, p.password or "\0"]

def q(sql):
    r = subprocess.run(["psql", url, "-X", "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql], capture_output=True, text=True,
                       env={**os.environ, "PGSSLMODE": env_ssl, "PGCONNECT_TIMEOUT": "20"})
    if r.returncode != 0: stop(f"query failed: {scrub(r.stderr.strip()[-200:])}")
    return r.stdout.strip()

def verify_target(when, migrated=False):
    result = neon_target.compare(target, url, q)
    say(neon_target.render(target, result))
    if not neon_target.matches(result):
        stop(f"{when}: this connection is NOT the accepted production target ({', '.join(r[0] for r in result if not r[3])} differ). "
             + ("Do not retry; STOP and report to PMO." if migrated else "Nothing was changed. In the Neon Console select branch main, then Connect."))
    say(f"  ok    {when}: connection positively identified as {target['name']} (branch `{target['branch_name']}`)")

who = q("select current_user||' · db '||current_database()||' · server '||current_setting('server_version')")
say(f"release checkout {head} · connection: {who}")
verify_target("target identity")
before = [h for h in q("select hash from drizzle.__drizzle_migrations order by id").splitlines() if h]
if before != local[:PRE_HEAD]: stop(f"the database is not exactly at 0020 ({len(before)} migration rows; hashes {'match' if before == local[:len(before)] else 'differ from'} the repository)")
say(f"  ok    database exactly at 0020 ({len(before)} rows, hashes = repository 0000–0020)")
say(f"\nCHECKPOINT: the Neon Console Connect dialog you copied from must show branch `{target['branch_name']}`.")
if input(f"Type the branch name shown in that Connect dialog (anything else aborts): ").strip() != target["branch_name"]: stop("aborted by operator at the branch checkpoint")
if input("Type MIGRATE to apply 0021–0026 to PRODUCTION now (anything else aborts): ").strip() != "MIGRATE": stop("aborted by operator")
verify_target("target identity immediately before migrating")

env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL",) and not k.startswith("VO_")}
env.update({"MIGRATION_DATABASE_URL": url, "VO_APP_DB_ROLE": "vo_runtime", "PGSSLMODE": env_ssl})
r = subprocess.run(["npx", "tsx", "scripts/migrate.ts"], cwd=REPO, env=env, capture_output=True, text=True)
say("  migrate: " + " | ".join(scrub(l) for l in (r.stdout + r.stderr).splitlines() if l.strip() and not l.startswith("(node:"))[-400:])
if r.returncode != 0: stop("migration failed — do not retry; follow the STOP procedure (recovery branch, PMO)")

verify_target("target identity after migrating", migrated=True)
after = [h for h in q("select hash from drizzle.__drizzle_migrations order by id").splitlines() if h]
if after != local: stop(f"post-migration head is not exactly 0026 ({len(after)} rows)")
grants = q("select string_agg(table_name||':'||p, ',' order by table_name) from (select table_name, string_agg(privilege_type, '+' order by privilege_type) p from information_schema.role_table_grants where grantee='vo_runtime' and table_name in ('value_driver_exclusion','recommendation_review_event','value_change_determination') group by 1) x")
say(f"  ok    head exactly 0026 ({len(after)} rows, hashes = repository 0000–0026)")
say(f"  ok    vo_runtime grants on the new tables: {grants or 'NONE'}")
if grants.count("DELETE+INSERT+SELECT+UPDATE") != 3: stop("vo_runtime grants on the new tables are not as expected")
url = p = None; SECRETS.clear()
say(f"\nRESULT: migrated {target['name']} (branch `{target['branch_name']}`) 0020 → 0026. The owner credential was held only in this process and is now discarded.")
say("Next: run scripts/release/release-check.py post (read-only, vo_runtime).")
