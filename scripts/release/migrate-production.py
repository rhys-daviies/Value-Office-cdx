"""4D.10 production migration runner (0020 → 0026). Run by Rhys in his own terminal; never by an agent with the secret.

  python3 scripts/release/migrate-production.py                 production: owner connection string read with a hidden
                                                                prompt (never echoed, stored, logged or written)
  python3 scripts/release/migrate-production.py --rehearse URL  localhost-only rehearsal of this runner

It refuses unless: the checkout is the accepted release (27 migrations, head 0026); the connection is neondb_owner on
the UNPOOLED host with TLS (production); the database is exactly at 0020 with the repository's 0000–0020 hashes.
It then runs the standard `db:migrate` (MIGRATION_DATABASE_URL + VO_APP_DB_ROLE=vo_runtime, which re-applies the
runtime grants) and verifies the head is exactly 0026 with the repository's hashes. The credential exists only in this
process's memory and its child; nothing is written to disk. Output is scrubbed."""

import argparse, getpass, hashlib, json, os, re, subprocess, sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
PRE_HEAD, POST_HEAD = 21, 27
POST_TAG = "0026_phase4d10h_value_change_determination_integrity"

ap = argparse.ArgumentParser()
ap.add_argument("--rehearse", help="localhost database URL (rehearsal of this runner only)")
args = ap.parse_args()

SECRETS = []
def scrub(s):
    for v in SECRETS:
        if v: s = s.replace(v, "<redacted>")
    return re.sub(r"postgres(ql)?://\S+", "<redacted>", s)
def say(s=""): print(scrub(str(s)), flush=True)
def stop(why): say(f"STOP: {why}"); sys.exit(1)

journal = json.load(open(f"{REPO}/drizzle/meta/_journal.json"))
tags = [e["tag"] for e in journal["entries"]]
local = [hashlib.sha256(open(f"{REPO}/drizzle/{t}.sql", "rb").read()).hexdigest() for t in tags]
if len(local) != POST_HEAD or tags[-1] != POST_TAG: stop(f"this checkout is not the accepted release (has {len(local)} migrations, head {tags[-1]})")
status = subprocess.run(["git", "status", "--porcelain"], cwd=REPO, capture_output=True, text=True).stdout.strip()
if status and not args.rehearse: stop("the release checkout has uncommitted changes")
if status: say("  note  rehearsal from an uncommitted checkout (production refuses this)")
head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO, capture_output=True, text=True).stdout.strip()

if args.rehearse:
    url = args.rehearse
    p = urlsplit(url)
    if p.hostname not in ("localhost", "127.0.0.1"): stop("--rehearse accepts only a localhost database")
    env_ssl = "disable"
else:
    url = getpass.getpass("neondb_owner UNPOOLED connection string (hidden, not stored): ").strip()
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

who = q("select current_user||' · db '||current_database()||' · server '||current_setting('server_version')")
say(f"release checkout {head} · connection: {who}")
before = [h for h in q("select hash from drizzle.__drizzle_migrations order by id").splitlines() if h]
if before != local[:PRE_HEAD]: stop(f"the database is not exactly at 0020 ({len(before)} migration rows; hashes {'match' if before == local[:len(before)] else 'differ from'} the repository)")
say(f"  ok    database exactly at 0020 ({len(before)} rows, hashes = repository 0000–0020)")
if not args.rehearse and input("Type MIGRATE to apply 0021–0026 to PRODUCTION now (anything else aborts): ").strip() != "MIGRATE": stop("aborted by operator")

env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL",) and not k.startswith("VO_")}
env.update({"MIGRATION_DATABASE_URL": url, "VO_APP_DB_ROLE": "vo_runtime", "PGSSLMODE": env_ssl})
r = subprocess.run(["npx", "tsx", "scripts/migrate.ts"], cwd=REPO, env=env, capture_output=True, text=True)
say("  migrate: " + " | ".join(scrub(l) for l in (r.stdout + r.stderr).splitlines() if l.strip() and not l.startswith("(node:"))[-400:])
if r.returncode != 0: stop("migration failed — do not retry; follow the STOP procedure (recovery branch, PMO)")

after = [h for h in q("select hash from drizzle.__drizzle_migrations order by id").splitlines() if h]
if after != local: stop(f"post-migration head is not exactly 0026 ({len(after)} rows)")
grants = q("select string_agg(table_name||':'||p, ',' order by table_name) from (select table_name, string_agg(privilege_type, '+' order by privilege_type) p from information_schema.role_table_grants where grantee='vo_runtime' and table_name in ('value_driver_exclusion','recommendation_review_event','value_change_determination') group by 1) x")
say(f"  ok    head exactly 0026 ({len(after)} rows, hashes = repository 0000–0026)")
say(f"  ok    vo_runtime grants on the new tables: {grants or 'NONE'}")
if grants.count("DELETE+INSERT+SELECT+UPDATE") != 3: stop("vo_runtime grants on the new tables are not as expected")
url = p = None; SECRETS.clear()
say("\nRESULT: migrated 0020 → 0026. The owner credential was held only in this process and is now discarded.")
say("Next: run scripts/release/release-check.py post (read-only, vo_runtime).")
