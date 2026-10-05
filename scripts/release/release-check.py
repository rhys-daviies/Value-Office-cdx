"""4D.10 production release checks — READ-ONLY against the database. Successor of ~/.cardaxia-4d9m/n1c-check.py for the
0020 → 0026 release (docs/release/4d10-release-procedure.md lists every check and why it changed).

Two accepted references, never confused (R2A, PMO):
  4D.9N freeze                     ~/.cardaxia-4d9m/n1c-freeze.json — historical accepted state at 4D.9N acceptance
                                   (618 factual rows). Never rewritten.
  4D.10 pre-release baseline       ~/.cardaxia-4d9m/4d10-pre-release-baseline.json — accepted production state
                                   immediately before the 4D.10 migration (written only by `capture`, on PASS).
and one derived artefact:
  release baseline                 ~/.cardaxia-4d9m/4d10-release-baseline.json — written only by a fully PASSING `pre`;
                                   the only file `post` accepts.

Modes
  schema     (local only) write the schema fingerprint of a freshly migrated database (schema-0020/0026.txt)
  snapshot   (local only) save a bare factual snapshot — rehearsal fixtures only
  reconcile  trace every factual change since the 4D.9N freeze (attribution, commands, reports); writes nothing.
             With --source FILE --source-sha256 HEX (R2C): since an explicitly selected ACCEPTED 4D.10 pre-release
             baseline instead — pinned by its sha256, strictly loaded (kind, accepted, 0020 state, hashes, schema) and
             proved to come from this production target
  capture    PMO-authorised: reconcile + head/schema/role checks; on PASS only, atomically writes a 4D.10 pre-release
             baseline to --reference (refuses to replace an existing one without --replace). From a --source baseline
             it writes a SUCCESSOR (version source+1, linked to the source by sha256); the source is never modified
  pre        production must be EXACTLY the accepted pre-release state: head 0020, accepted 0020 schema, factual rows
             identical to the 4D.10 pre-release baseline (sign-in activity aside). Only after every check PASSES is the
             release baseline published (atomic rename). A failed run never creates or replaces it; it leaves only a
             `*.FAILED-<time>.json` diagnostic that `post` refuses
  post       production must be EXACTLY the accepted post-release state (head 0026, accepted 0026 schema and grants,
             every baseline row identical over its baseline columns, new columns null, new tables empty, no factual
             rows added, reports byte-identical). Refuses a missing, malformed, unaccepted or mismatched baseline

  evidence   (R2B) read-only inspection of ANOTHER branch of the production project (--endpoint ep-…): the connection
             must be positively NOT production (same Neon project, different branch and endpoint); then every `post`
             check runs against the release baseline. Supplementary evidence only — never a production result

Connection
  default   production vo_runtime from the macOS Keychain (service value-office-prod-vo_runtime), forced to a
            read-only session on the unpooled host, TLS required. Every production run first proves the connection is
            the accepted production target (scripts/release/production-target.json: host, port, database and the
            server's neon.project_id / neon.branch_id / neon.endpoint_id) — a FAIL like any other check (R2B)
  --local URL  localhost-only database for rehearsal validation (never production); --local-target FILE applies the
            same identity check to it

Connection strings and passwords are never printed or written; output is scrubbed."""

import argparse, datetime, hashlib, json, os, re, subprocess, sys
from urllib.parse import quote, urlsplit, urlunsplit

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import neon_target  # noqa: E402
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TOOLS = os.path.expanduser("~/.cardaxia-4d9m")
R = "vo_runtime"
AUTH = ("app_session", "app_user", "app_credential")  # sign-in activity, not factual Value Office data
PRE_HEAD, POST_HEAD = 21, 27  # rows in drizzle.__drizzle_migrations at 0020 and 0026
PRE_TAG, POST_TAG = "0020_phase4d9c_value_trajectory_integrity", "0026_phase4d10h_value_change_determination_integrity"
# Added by 0021–0026 to tables that already hold production rows: must exist post-release and be NULL on every row.
NEW_COLUMNS = [("value_driver_version", "adjustment_rationale"), ("value_position", "value_leakage_id"),
               ("recommendation", "internal_review_status")]
NEW_TABLES = ["value_driver_exclusion", "recommendation_review_event", "value_change_determination"]
DEMO = {"DEMO-TRAJ": None, "DEMO-TRAJ2": "8f635bdf-e0a7-442a-a61a-5fe065e6e77f"}
REF_KIND, REL_KIND = "4d10-pre-release-production-baseline", "4d10-release-baseline"

ap = argparse.ArgumentParser()
ap.add_argument("mode", choices=["schema", "snapshot", "reconcile", "capture", "pre", "post", "evidence"])
ap.add_argument("--local", help="localhost database URL (rehearsal validation only)")
ap.add_argument("--local-target", help="--local only: target file the localhost database must match")
ap.add_argument("--endpoint", help="evidence only: Neon endpoint ID (ep-…) of the non-production branch to inspect")
ap.add_argument("--freeze", default=f"{TOOLS}/n1c-freeze.json", help="historical 4D.9N freeze (reconcile / capture)")
ap.add_argument("--reference", default=f"{TOOLS}/4d10-pre-release-baseline-v2.json", help="current 4D.10 pre-release baseline (capture writes, pre reads); v2 since R2C")
ap.add_argument("--baseline", default=f"{TOOLS}/4d10-release-baseline.json", help="release baseline (pre publishes, post reads)")
ap.add_argument("--replace", action="store_true", help="allow capture/pre to replace an existing accepted file (after its own PASS)")
ap.add_argument("--source", help="reconcile / capture: an accepted 4D.10 pre-release baseline to reconcile from (instead of the 4D.9N freeze)")
ap.add_argument("--source-sha256", help="required with --source: the PMO-accepted sha256 of that file")
ap.add_argument("--accepted-by", help="capture --source: the PMO acceptance marker recorded in the successor")
ap.add_argument("--project", default="DEMO-TRAJ2", help="reconcile: the only project allowed to have factual additions")
ap.add_argument("--actor", default="Rhys Davies", help="reconcile: the only actor allowed for those additions")
ap.add_argument("--out", help="output file (schema / snapshot modes)")
args = ap.parse_args()

SECRETS, fails = [], []
if args.local_target and not args.local: print("STOP: --local-target applies only with --local"); sys.exit(1)
if bool(args.source) != bool(args.source_sha256) or (args.source and args.mode not in ("reconcile", "capture")):
    print("STOP: --source and --source-sha256 go together, for reconcile / capture only"); sys.exit(1)
if args.source and args.mode == "capture" and (not args.accepted_by or os.path.realpath(args.source) == os.path.realpath(args.reference)):
    print("STOP: capture --source needs --accepted-by and a --reference other than the source (the source is never overwritten)"); sys.exit(1)
if (args.mode == "evidence") != bool(args.endpoint) or (args.endpoint and args.local):
    print("STOP: evidence mode needs --endpoint (production project only), and --endpoint applies only to evidence"); sys.exit(1)
if args.endpoint and not re.fullmatch(r"ep-[a-z]+-[a-z]+-[a-z0-9]+", args.endpoint): print("STOP: --endpoint is not a Neon endpoint ID"); sys.exit(1)
TARGET = neon_target.load_target(args.local_target, production=False) if args.local_target else (None if args.local else neon_target.load_target(neon_target.PRODUCTION_TARGET, production=True))
if args.local:
    lp = urlsplit(args.local)
    if lp.hostname not in ("localhost", "127.0.0.1"):
        print("STOP: --local accepts only a localhost database"); sys.exit(1)
    RO = urlunsplit((lp.scheme, lp.netloc, lp.path, (lp.query + "&" if lp.query else "") +
                     "options=" + quote("-c default_transaction_read_only=on", safe=""), ""))
    SECRETS += [args.local, RO, lp.password or "\0"]
    os.environ["PGSSLMODE"] = "disable"
else:
    os.environ["PGSSLMODE"] = "require"
    kc = subprocess.run(["security", "find-generic-password", "-s", "value-office-prod-vo_runtime", "-w"], capture_output=True, text=True)
    if kc.returncode != 0: print("STOP: Keychain item missing"); sys.exit(1)
    U = kc.stdout.strip(); p = urlsplit(U)
    if p.username != R: print("STOP: Keychain credential is not vo_runtime"); sys.exit(1)
    first, _, rest = (p.hostname or "").partition(".")
    if args.endpoint: first = args.endpoint  # evidence: same credential, the other branch's compute endpoint
    RO = urlunsplit((p.scheme, p.netloc.rsplit("@", 1)[0] + "@" + first.replace("-pooler", "") + "." + rest, p.path,
                     (p.query + "&" if p.query else "") + "options=" + quote("-c default_transaction_read_only=on", safe=""), ""))
    SECRETS += [U, RO, p.password or "\0"]


def scrub(s):
    for v in SECRETS:
        if v: s = s.replace(v, "<redacted>")
    return re.sub(r"postgres(ql)?://\S+", "<redacted>", s)
def say(s=""): print(scrub(str(s)), flush=True)
def check(label, ok):
    say(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if not ok: fails.append(label)
def q(sql):
    r = subprocess.run(["psql", RO, "-X", "-v", "ON_ERROR_STOP=1", "-Atq", "-F", "|", "-c", sql], capture_output=True, text=True,
                       env={**os.environ, "PGCONNECT_TIMEOUT": "20"})
    if r.returncode != 0: say(f"STOP: query failed: {scrub(r.stderr.strip()[-200:])}"); sys.exit(1)
    return r.stdout.strip()


# ---------------------------------------------------------------------------------------------------------------
# Schema fingerprint: tables/columns, constraints, indexes, triggers, public functions, enums and vo_runtime grants.
# Compared line-for-line with the accepted expectation (scripts/release/schema-0020.txt / schema-0026.txt, captured
# from a fresh PostgreSQL 18 migration of this repository). Any difference is a STOP.

SCHEMA_SQL = f"""
select 'col|'||table_name||'|'||column_name||'|'||udt_name||'|'||is_nullable||'|'||coalesce(md5(column_default),'-')
  from information_schema.columns where table_schema='public'
union all
select 'con|'||c.relname||'|'||k.conname||'|'||k.contype::text||'|'||md5(pg_get_constraintdef(k.oid))
  from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relnamespace='public'::regnamespace
union all
select 'idx|'||tablename||'|'||indexname||'|'||md5(indexdef) from pg_indexes where schemaname='public'
union all
select 'trg|'||c.relname||'|'||t.tgname||'|'||t.tgenabled::text
  from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace
union all
select 'fn|'||p.proname||'|'||md5(p.prosrc) from pg_proc p where p.pronamespace='public'::regnamespace
union all
select 'enum|'||t.typname||'|'||string_agg(e.enumlabel, ',' order by e.enumsortorder)
  from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname
union all
select 'grant|'||table_schema||'.'||table_name||'|'||string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants where grantee='{R}' group by table_schema, table_name
order by 1
"""

def relations_check(expected, label):
    """Every public table/view in pg_class, regardless of privilege (R2B): information_schema hides relations vo_runtime
    has no grant on, so an unexpected owner-created table without constraints or indexes would otherwise go unseen."""
    got = set(x for x in q("select string_agg(relname, ',' order by relname) from pg_catalog.pg_class where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')").split(",") if x)
    extra, missing = sorted(got - set(expected)), sorted(set(expected) - got)
    check(f"{label}: {len(got)} public tables/views in pg_class (any owner, any privilege) = the expected {len(expected)} (unexpected {extra or 'none'}, missing {missing or 'none'})", not extra and not missing)

def schema_lines(): return [l for l in q(SCHEMA_SQL).splitlines() if l]

def schema_check(expected_file, label):
    exp = [l for l in open(expected_file).read().splitlines() if l and not l.startswith("#")]
    got = schema_lines()
    missing, unexpected = sorted(set(exp) - set(got)), sorted(set(got) - set(exp))
    check(f"{label}: {len(got)} schema facts; missing {len(missing)}, unexpected {len(unexpected)}", not missing and not unexpected)
    for l in missing[:20]: say(f"        missing    {l}")
    for l in unexpected[:20]: say(f"        unexpected {l}")


# ---------------------------------------------------------------------------------------------------------------
# Factual snapshot (same row formula as n1c-check.py, so the 4D.9N freeze stays comparable): per row
# md5(json_build_array(<columns>)) | id | owning project.

def tables():
    return [t for t in q("select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'").split(",") if t]

def columns(t):
    return q(f"select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='{t}'").split(",")

def table_rows(t, cols):
    key = "id" if "id" in cols else ("key" if "key" in cols else None)
    owner = "id" if t == "project" else ("project_id" if "project_id" in cols else None)
    ident = f"coalesce({key}::text,'')" if key else "''"
    own = f"coalesce({owner}::text,'')" if owner else "''"
    lines = q(f"select md5(json_build_array({','.join(cols)})::text)||'|'||{ident}||'|'||{own} from public.{t}")
    return sorted(l.split("|") for l in lines.splitlines() if l)

def snapshot(column_sets=None):
    s = {"tables": {}, "rows": {}, "cols": {}}
    for t in tables():
        # Post-release, baseline tables are hashed over their BASELINE columns: the added nullable columns are checked
        # separately (all NULL), so an unchanged row hashes exactly as before the migration.
        cols = (column_sets or {}).get(t) or columns(t)
        s["cols"][t] = cols
        s["rows"][t] = table_rows(t, cols)
        s["tables"][t] = {"count": len(s["rows"][t]), "md5": hashlib.md5("|".join(sorted(r[0] for r in s["rows"][t])).encode()).hexdigest()}
    s["migrations"] = [h for h in q("select hash from drizzle.__drizzle_migrations order by id").split("\n") if h]
    s["pdfs"] = q("select string_agg(i.type::text||' #'||i.issue_number||' '||i.renderer_version||' '||to_char(i.issued_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')||' sha '||d.sha256||' bytes-ok '||(encode(sha256(d.content),'hex')=d.sha256)::text, E'\\n' order by i.issued_at) from report_issue i join report_document d on d.key=i.document_key and d.sha256=i.document_sha256").splitlines()
    s["missing_pdf"] = q("select count(*) from report_issue i where not exists (select 1 from report_document d where d.key=i.document_key and d.sha256=i.document_sha256)")
    s["audit_max"] = int(q("select coalesce(max(id),0) from audit_event"))
    s["projects"] = [x for x in q("select string_agg(code||'='||id, ',' order by code) from project").split(",") if x]
    return s

def diff_rows(b, s):
    lost, added = {}, {}
    for t in set(b["rows"]) | set(s["rows"]):
        bh = {r[0] for r in b["rows"].get(t, [])}; sh = {r[0] for r in s["rows"].get(t, [])}
        if bh - sh: lost[t] = len(bh - sh)
        new = [r for r in s["rows"].get(t, []) if r[0] not in bh]
        if new: added[t] = new
    return lost, added

def pid(s, code):
    m = [x.split("=", 1)[1] for x in s["projects"] if x.split("=", 1)[0] == code]
    return m[0] if m else None


# ---------------------------------------------------------------------------------------------------------------
# Checks common to both release states.

def repo_hashes():
    journal = json.load(open(f"{REPO}/drizzle/meta/_journal.json"))
    return [e["tag"] for e in journal["entries"]], [hashlib.sha256(open(f"{REPO}/drizzle/{e['tag']}.sql", "rb").read()).hexdigest() for e in journal["entries"]]

def target_identity():
    """Production (and --local-target) runs: the connection must positively BE the accepted target. Evidence runs: it must
    positively NOT be production, while belonging to the same Neon project."""
    if TARGET is None:
        say("  info  local rehearsal: no target identity file (--local-target) — branch identity not checked"); return
    result = neon_target.compare(TARGET, RO, q)
    if args.mode == "evidence":
        got = {f: a for f, _, a, _ in result}
        say("  info  connection identity: " + ", ".join(f"{f}={a}" for f, a in got.items()))
        check(f"evidence target is a branch of the production project ({TARGET['settings']['neon.project_id']}), endpoint {args.endpoint}",
              got["neon.project_id"] == TARGET["settings"]["neon.project_id"] and got["neon.endpoint_id"] == args.endpoint)
        check(f"evidence target is positively NOT production (branch {got['neon.branch_id']} ≠ {TARGET['settings']['neon.branch_id']}, endpoint ≠ {TARGET['settings']['neon.endpoint_id']})",
              got["neon.branch_id"] not in (TARGET["settings"]["neon.branch_id"], "absent") and got["neon.endpoint_id"] != TARGET["settings"]["neon.endpoint_id"])
        return
    for line in neon_target.render(TARGET, result).splitlines(): say(line)
    bad = [f for f, _, _, ok in result if not ok]
    check(f"connection is the accepted target {TARGET['name']} (branch `{TARGET['branch_name']}`): host, port, database and server identity settings{(' — differ: ' + ', '.join(bad)) if bad else ''}", not bad)

def common(s):
    target_identity()
    who = q("select current_user||' · db '||current_database()||' · read-only '||current_setting('transaction_read_only')||' · server '||current_setting('server_version')")
    say(f"connection: {who}")
    check(f"connected as {R} in a read-only session", who.startswith(f"{R} ") and "read-only on" in who)
    ver = int(q("show server_version_num"))
    check(f"server major version 18 (the accepted schema expectations were captured on PostgreSQL 18): {ver}", 180000 <= ver < 190000)
    tags, local = repo_hashes()
    check(f"release repository: {len(local)} migrations, head {tags[-1][:4]} (accepted chain 0000–0026)", len(local) == POST_HEAD and tags[-1] == POST_TAG and tags[PRE_HEAD - 1] == PRE_TAG)
    check(f"stored PDFs: {len(s['pdfs'])}, every PDF's bytes match its sha256; missing {s['missing_pdf']}", all(l.endswith("bytes-ok true") for l in s["pdfs"]) and s["missing_pdf"] == "0")
    attrs = q(f"select rolsuper||','||rolcreaterole||','||rolcreatedb||','||rolreplication||','||rolbypassrls||','||rolcanlogin from pg_roles where rolname='{R}'")
    mem = q(f"with recursive c(oid) as (select oid from pg_roles where rolname='{R}' union select a.roleid from pg_auth_members a join c on a.member=c.oid) select coalesce(string_agg(r.rolname, ','), 'none') from c join pg_roles r on r.oid=c.oid where r.rolname<>'{R}'")
    denied = q(f"""select coalesce(string_agg(t||':'||p, ', '), 'none') from (values ('public.audit_event','INSERT'),('public.audit_event','UPDATE'),('public.audit_event','DELETE'),
      ('public.report_issue','UPDATE'),('public.report_issue','DELETE'),('public.report_document','UPDATE'),('public.report_document','DELETE'),
      ('public.app_session','DELETE'),('public.app_credential','DELETE'),('drizzle.__drizzle_migrations','INSERT'),('drizzle.__drizzle_migrations','UPDATE'),('drizzle.__drizzle_migrations','DELETE')) v(t,p) where has_table_privilege('{R}', t, p)""")
    creates = q(f"select has_database_privilege('{R}', current_database(), 'CREATE') or has_schema_privilege('{R}', 'public', 'CREATE')")
    owned = q(f"select (select count(*) from pg_class where relowner=(select oid from pg_roles where rolname='{R}')) + (select count(*) from pg_namespace where nspowner=(select oid from pg_roles where rolname='{R}'))")
    check(f"{R} least privilege: attrs {attrs} · memberships {mem} · db/public CREATE {creates} · owns {owned} · forbidden privileges held: {denied}",
          attrs == "false,false,false,false,false,true" and mem == "none" and creates == "f" and owned == "0" and denied == "none")
    r = subprocess.run(["npx", "tsx", "scripts/db-check-role.ts"], cwd=REPO, capture_output=True, text=True, env={**{k: v for k, v in os.environ.items() if k != "DATABASE_URL"}, "DATABASE_URL": RO})
    line = [l for l in scrub(r.stdout + r.stderr).splitlines() if "least-privilege" in l or "✗" in l]
    check(f"db:check-role: {line[-1].strip() if line else 'no output'}", r.returncode == 0)
    # As an unprivileged role, vo_runtime sees other roles' sessions with backend_type NULL (hidden), so filtering on
    # backend_type = 'client backend' alone would never see an owner session (a blind spot in n1c-check.py/s2check.py).
    conns = q("select string_agg(usename||'×'||n, ', ' order by usename) from (select usename, count(*) n from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and usename is not null and (backend_type='client backend' or backend_type is null) group by 1) x") or "none"
    check(f"other client connections by role: {conns} (none as neondb_owner or vo_app)", not re.search(r"\b(neondb_owner|vo_app)×", conns))
    if args.local:
        say("  info  local rehearsal: production DEMO-TRAJ / DEMO-TRAJ2 identity checks not applicable")
    else:
        demo = pid(s, "DEMO-TRAJ"); demo2 = pid(s, "DEMO-TRAJ2")
        check(f"DEMO-TRAJ ({(demo or 'missing')[:8]}…) and DEMO-TRAJ2 ({(demo2 or 'missing')[:8]}…) present", demo is not None and demo2 == DEMO["DEMO-TRAJ2"])
    return local


def factual_compare(b, s, label):
    lost, added = diff_rows(b, s)
    lost_f = {t: n for t, n in lost.items() if t not in AUTH}
    check(f"{label}: every factual row present and byte-identical (changed/removed: {lost_f or 'none'})", not lost_f)
    fact = {t: len(v) for t, v in added.items() if t not in AUTH and t != "audit_event"}
    check(f"{label}: no factual rows added (added: {fact or 'none'})", not fact)
    auth = {t: f"-{lost.get(t, 0)}/+{len(added.get(t, []))}" for t in AUTH if lost.get(t) or added.get(t)}
    say(f"  info  auth/session activity since {label} (not factual data): {auth or 'none'}")
    ac = q(f"select coalesce(string_agg(table_name||'/'||action||' x'||n, ', '), 'none') from (select table_name, action, count(*) n from audit_event where id > {b['audit_max']} group by 1,2 order by 1,2) x")
    check(f"audit rows since {label} are sign-in/session only: {ac}", ac == "none" or all(x.split("/")[0] in AUTH for x in ac.split(", ")))
    check(f"issued reports + PDFs (type, number, renderer, issued_at, sha256, byte check) identical to {label}", s["pdfs"] == b["pdfs"])


# ---------------------------------------------------------------------------------------------------------------
# Accepted-file handling: envelopes, atomic publication, strict loading.

def utc_now(): return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def expected_lines(f): return [l for l in open(f).read().splitlines() if l and not l.startswith("#")]

def schema_sha(lines): return hashlib.sha256("\n".join(sorted(lines)).encode()).hexdigest()

SCHEMA_0020_SHA = schema_sha(expected_lines(f"{HERE}/schema-0020.txt"))

def repo_head(): return subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True).stdout.strip()

def target_record():
    """The identity this run proved (production target or --local-target), recorded in every new envelope (R2C)."""
    if TARGET is None: return None
    return {"name": TARGET["name"], "branch_name": TARGET["branch_name"], "host": TARGET["host"], "port": TARGET["port"],
            "database": TARGET["database"], "settings": TARGET["settings"]}

def envelope(kind, s, extra):
    return {"kind": kind, "target": target_record(), "accepted": True, "captured_at": utc_now(), "repo_head": repo_head(),
            "server_version": q("select current_setting('server_version')"), "role": R,
            "migration_rows": len(s["migrations"]), "migration_head_tag": PRE_TAG, "schema_0020_sha256": SCHEMA_0020_SHA,
            "factual_rows": sum(v["count"] for k, v in s["tables"].items() if k not in AUTH and k != "audit_event"),
            "projects": s["projects"], "pdfs": s["pdfs"], "audit_max": s["audit_max"], "snapshot": s, **extra}

def atomic_write(path, obj):
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w") as fh:
        json.dump(obj, fh); fh.flush(); os.fsync(fh.fileno())
    os.replace(tmp, path)

def write_failed(path, kind, s, why):
    diag = f"{path}.FAILED-{utc_now().replace(':', '')}.json"
    json.dump({"kind": f"{kind}-FAILED-candidate", "accepted": False, "captured_at": utc_now(), "failures": why, "snapshot": s}, open(diag, "w"))
    say(f"\n  info  FAILED candidate kept for diagnosis only (never accepted): {os.path.basename(diag)}")

def load_accepted(path, kind, local):
    """The only way an accepted file is read: anything not exactly an accepted 0020-state file of this kind is refused."""
    def refuse(why): say(f"STOP: {os.path.basename(path)} refused — {why}"); sys.exit(1)
    if not os.path.exists(path): refuse("missing")
    try: env = json.load(open(path))
    except Exception: refuse("malformed (not JSON)")
    if not isinstance(env, dict) or env.get("kind") != kind: refuse(f"not a {kind} (kind {env.get('kind') if isinstance(env, dict) else type(env).__name__})")
    if env.get("accepted") is not True: refuse("not accepted")
    s = env.get("snapshot")
    if not isinstance(s, dict) or not all(k in s for k in ("tables", "rows", "cols", "migrations", "pdfs", "audit_max", "projects")): refuse("malformed snapshot")
    if env.get("migration_rows") != PRE_HEAD or env.get("migration_head_tag") != PRE_TAG or len(s["migrations"]) != PRE_HEAD: refuse("not a migration-0020 state")
    if s["migrations"] != local[:PRE_HEAD]: refuse("its migration hashes are not this repository's 0000–0020")
    if env.get("schema_0020_sha256") != SCHEMA_0020_SHA: refuse("captured against a different accepted 0020 schema")
    say(f"  info  {kind}: captured {env['captured_at']} at repo {env['repo_head'][:7]}, {env['factual_rows']} factual rows, audit max {env['audit_max']}")
    return env


def file_sha(path): return hashlib.sha256(open(path, "rb").read()).hexdigest()

def check_envelope_target(env, path):
    """An envelope that records its target must name exactly the target this run proved (R2C)."""
    if env.get("target") is not None and env["target"] != target_record():
        say(f"STOP: {os.path.basename(path)} refused — captured from a different target ({(env['target'] or {}).get('settings')})"); sys.exit(1)

def load_source(local):
    """--source: an explicitly selected accepted 4D.10 pre-release baseline; anything unproved is a STOP."""
    def refuse(why): say(f"STOP: source {os.path.basename(args.source)} refused — {why}"); sys.exit(1)
    if not os.path.exists(args.source): refuse("missing")
    try: got = file_sha(args.source)
    except OSError: refuse("unreadable")
    if got != args.source_sha256.lower(): refuse(f"sha256 {got[:16]}… is not the accepted {args.source_sha256[:16]}…")
    env = load_accepted(args.source, REF_KIND, local)  # kind, accepted, snapshot shape, 0020 state, hashes, schema
    if env.get("target") is not None:
        if TARGET is None: refuse("it records a target but this run proved none (--local-target)")
        check_envelope_target(env, args.source)
        say(f"  info  source target identity = this run's target ({env['target']['settings']})")
    elif args.local:
        if TARGET is not None: refuse("legacy source (no recorded target) cannot be proved against --local-target")
        say("  info  local rehearsal: legacy source without a recorded target accepted (no target identity in play)")
    else:
        # Legacy (pre-R2B) baseline: proved through the connection that captured it. The Keychain item that defines the
        # production connection must not have changed since the capture; this run proved that connection IS the target.
        kc = subprocess.run(["security", "find-generic-password", "-s", "value-office-prod-vo_runtime"], capture_output=True, text=True).stdout
        m = re.search(r'"mdat"<timedate>=\S+\s+"(\d{14})Z', kc)
        mdat = datetime.datetime.strptime(m.group(1), "%Y%m%d%H%M%S").strftime("%Y-%m-%dT%H:%M:%SZ") if m else None
        if not mdat or not mdat < env["captured_at"]: refuse(f"legacy source; the production connection item changed at {mdat or 'unknown'}, not before the capture {env['captured_at']}")
        say(f"  info  legacy source (no recorded target): captured {env['captured_at']} through the production Keychain connection, unchanged since {mdat}, which this run positively identified as the target")
    if env["audit_max"] > int(q("select coalesce(max(id),0) from audit_event")): refuse("its audit max is beyond production's (not an earlier state)")
    say(f"  info  reconciliation source: {os.path.basename(args.source)} (sha256 {got[:16]}…, version {env.get('version', 1)}, captured {env['captured_at']}, audit max {env['audit_max']})")
    return env, got


# ---------------------------------------------------------------------------------------------------------------
# Reconciliation of changes since the 4D.9N freeze (R2A): every factual addition on one project, by one actor, through
# application commands; no frozen row changed or deleted; no report issued or changed.

def reconcile(f, s, since="the freeze"):
    lost, added = diff_rows(f, s)
    lost_f = {t: n for t, n in lost.items() if t not in AUTH}
    check(f"no factual row of {since} modified or deleted (changed/removed: {lost_f or 'none'})", not lost_f)
    proj = pid(s, args.project)
    check(f"project {args.project} exists ({(proj or 'missing')[:8]}…)", proj is not None)
    fact = {t: v for t, v in added.items() if t not in AUTH and t != "audit_event"}
    # A client row has no project_id: it belongs to the project only if it is that project's own client (R2C).
    own_client = q(f"select coalesce(client_id::text,'') from project where id='{proj}'") if proj else ""
    foreign = {t: sum(1 for r in v if r[2] != proj and not (t == "client" and r[1] == own_client)) for t, v in fact.items()}
    foreign = {t: n for t, n in foreign.items() if n}
    check(f"every factual addition belongs to {args.project} (other projects / unowned: {foreign or 'none'})", not foreign)
    check(f"no report issued or changed (report_issue {s['tables']['report_issue']['count']} vs {f['tables']['report_issue']['count']}, report_document {s['tables']['report_document']['count']} vs {f['tables']['report_document']['count']}; inventory identical)",
          s["tables"]["report_issue"]["count"] == f["tables"]["report_issue"]["count"] and s["tables"]["report_document"]["count"] == f["tables"]["report_document"]["count"] and s["pdfs"] == f["pdfs"])
    audit = [l.split("|") for l in q(f"select a.table_name, a.action, coalesce(a.row_id::text,''), coalesce(a.command,''), coalesce(u.display_name,''), to_char(a.occurred_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') from audit_event a left join app_user u on u.id=a.actor_user_id where a.id > {f['audit_max']} order by a.id").splitlines() if l]
    inserted = {(a[0], a[2]) for a in audit if a[1] == "INSERT"}
    untraced = [f"{t}:{r[1][:8]}" for t, v in fact.items() for r in v if (t, r[1]) not in inserted]
    check(f"every factual addition traces to an INSERT by an application command since {since} (untraced: {untraced or 'none'})", not untraced)
    bad_cmd = [f"{a[0]}/{a[1]}" for a in audit if not a[3]]
    check(f"every audit row since {since} names its command (missing: {bad_cmd or 'none'})", not bad_cmd)
    actors = sorted({a[4] for a in audit})
    check(f"every audit row since {since} is by {args.actor} (actors: {actors or 'none'})", actors in ([], [args.actor]))
    touched = [f"{a[0]}/{a[1]}:{a[2][:8]}" for a in audit if a[0] not in AUTH and (a[0], a[2]) not in inserted]
    check(f"every factual UPDATE/DELETE since {since} touches only rows created since {since} (earlier rows touched: {touched or 'none'})", not touched)
    say(f"  info  {len(audit)} audit rows since {since} (audit id > {f['audit_max']}), {audit[0][5] if audit else '-'}Z → {audit[-1][5] if audit else '-'}Z")
    for t, v in sorted(fact.items()):
        for r in v:
            cmds = [a[3] for a in audit if a[0] == t and a[2] == r[1]]
            say(f"  info  + {t} {r[1][:8]}… ({args.project}): {', '.join(cmds)}")
    gone = sorted({f"{a[0]}:{a[2][:8]}" for a in audit if a[1] == "DELETE" and a[0] not in AUTH})
    if gone: say(f"  info  rows created then deleted since {since} (application-managed): {', '.join(gone)}")
    auth = {t: f"-{lost.get(t, 0)}/+{len(added.get(t, []))}" for t in AUTH if lost.get(t) or added.get(t)}
    say(f"  info  sign-in/session activity (not factual): {auth or 'none'}")
    return fact


# ---------------------------------------------------------------------------------------------------------------

mode = args.mode
if mode == "schema":
    if not args.local or not args.out: say("STOP: schema capture is local-only and needs --out"); sys.exit(1)
    ver = q("select current_setting('server_version')")
    open(args.out, "w").write(f"# Accepted schema fingerprint, captured from a fresh migration on PostgreSQL {ver} (release-check.py schema)\n" + "\n".join(schema_lines()) + "\n")
    say(f"schema fingerprint written: {len(schema_lines())} facts (PostgreSQL {ver})")
    sys.exit(0)
if mode == "snapshot":
    if not args.local or not args.out: say("STOP: bare snapshots are local-only (rehearsal fixtures) and need --out"); sys.exit(1)
    s = snapshot(); json.dump(s, open(args.out, "w"))
    say(f"snapshot saved: {len(s['tables'])} tables, {sum(v['count'] for v in s['tables'].values())} rows, {len(s['migrations'])} migrations")
    sys.exit(0)

if mode in ("reconcile", "capture"):
    if mode == "capture" and os.path.exists(args.reference) and not args.replace:
        say(f"STOP: {os.path.basename(args.reference)} already exists; an accepted pre-release baseline is replaced only with --replace"); sys.exit(1)
    s = snapshot(); local = common(s)
    check(f"production migration head 0020: {len(s['migrations'])} rows, hashes = repository 0000–0020", s["migrations"] == local[:PRE_HEAD])
    schema_check(f"{HERE}/schema-0020.txt", "schema exactly the accepted 0020 schema (incl. vo_runtime grants)")
    src = None
    if args.source:
        src, src_sha = load_source(local)
        f, since = src["snapshot"], f"source baseline v{src.get('version', 1)}"
        relations_check(f["cols"], f"relations of the {since}")
        check(f"migration rows identical to the {since}", s["migrations"] == f["migrations"])
        fact = reconcile(f, s, since)
    elif not os.path.exists(args.freeze): check(f"historical 4D.9N freeze available ({os.path.basename(args.freeze)})", False); fact = {}
    else:
        f = json.load(open(args.freeze))
        relations_check(f["cols"], "relations of the 4D.9N freeze")
        check("migration rows identical to the 4D.9N freeze", s["migrations"] == f["migrations"])
        fact = reconcile(f, s)
    if mode == "capture":
        if fails:
            say("\n  info  capture FAILED: no pre-release baseline written")
        elif src:
            drafts = [x for x in q("select string_agg(id::text, ',' order by id) from assurance_review where status='draft'").split(",") if x]
            md5 = {r[1]: r[0] for r in s["rows"]["assurance_review"]}
            env = envelope(REF_KIND, s, {"version": src.get("version", 1) + 1, "accepted_by": args.accepted_by,
                                         "source": {"file": os.path.basename(args.source), "sha256": src_sha, "kind": src["kind"], "version": src.get("version", 1),
                                                    "captured_at": src["captured_at"], "audit_max": src["audit_max"], "factual_rows": src["factual_rows"]},
                                         "source_additions": {t: [r[1] for r in v] for t, v in fact.items()}, "reconciled_project": f"{args.project}={pid(s, args.project)}",
                                         "open_draft_reviews": [f"{d}={md5.get(d)}" for d in drafts]})
        else:
            env = envelope(REF_KIND, s, {"freeze_audit_max": f["audit_max"], "post_freeze_additions": {t: len(v) for t, v in fact.items()},
                                         "accepted_by": "PMO (4D.10R2A)"})
        if not fails:
            atomic_write(args.reference, env)
            say(f"\n4D.10 pre-release production baseline{' v' + str(env['version']) if 'version' in env else ''} written ({os.path.basename(args.reference)}): captured {env['captured_at']}, {env['factual_rows']} factual rows, audit max {env['audit_max']}")
elif mode == "pre":
    if os.path.exists(args.baseline) and not args.replace:
        say(f"STOP: {os.path.basename(args.baseline)} already exists; it is replaced only with --replace (after this run PASSES)"); sys.exit(1)
    s = snapshot(); local = common(s)
    ref = load_accepted(args.reference, REF_KIND, local); check_envelope_target(ref, args.reference)
    check(f"production migration head 0020: {len(s['migrations'])} rows, hashes = repository 0000–0020", s["migrations"] == local[:PRE_HEAD])
    schema_check(f"{HERE}/schema-0020.txt", "schema exactly the accepted 0020 schema (incl. vo_runtime grants)")
    relations_check(ref["snapshot"]["cols"], "relations of the 4D.10 pre-release baseline")
    check("migration rows identical to the 4D.10 pre-release baseline", s["migrations"] == ref["snapshot"]["migrations"])
    factual_compare(ref["snapshot"], s, "the 4D.10 pre-release baseline")
    if fails:
        write_failed(args.baseline, REL_KIND, s, fails)
        say("  info  release baseline NOT published")
    else:
        env = envelope(REL_KIND, s, {"reference_captured_at": ref["captured_at"], "reference_version": ref.get("version", 1),
                                     "reference_sha256": file_sha(args.reference)})
        atomic_write(args.baseline, env)
        say(f"\nrelease baseline published ({os.path.basename(args.baseline)}): {len(s['tables'])} tables, {sum(v['count'] for v in s['tables'].values())} rows, audit max id {s['audit_max']}")
else:  # post, evidence
    if mode == "evidence": say("EVIDENCE ONLY — a non-production branch; this is not a production release result")
    _, local_hashes = repo_hashes()
    b_env = load_accepted(args.baseline, REL_KIND, local_hashes)
    b = b_env["snapshot"]
    s = snapshot(column_sets=b["cols"]); local = common(s)
    if mode == "post": check_envelope_target(b_env, args.baseline)
    check(f"production migration head 0026: {len(s['migrations'])} rows, hashes = repository 0000–0026", s["migrations"] == local[:POST_HEAD])
    check("the first 21 migration rows are the baseline's (0000–0020 untouched)", s["migrations"][:PRE_HEAD] == b["migrations"])
    say("  info  new migration hashes: " + ", ".join(h[:16] for h in s["migrations"][PRE_HEAD:]))
    schema_check(f"{HERE}/schema-0026.txt", "schema exactly the accepted 0026 schema (incl. vo_runtime grants on the new tables)")
    check(f"tables: baseline {len(b['cols'])} + {len(NEW_TABLES)} new = {len(s['cols'])}", set(s["cols"]) == set(b["cols"]) | set(NEW_TABLES) and not set(b["cols"]) & set(NEW_TABLES))
    relations_check(set(b["cols"]) | set(NEW_TABLES), "relations: the release baseline's + the 3 new tables")
    empty = {t: s["tables"][t]["count"] for t in NEW_TABLES if t in s["tables"]}
    check(f"new tables empty: {empty}", all(n == 0 for n in empty.values()) and len(empty) == len(NEW_TABLES))
    nonnull = {f"{t}.{c}": (int(q(f"select count(*) from public.{t} where {c} is not null")) if c in s["cols"].get(t, []) or c in columns(t) else "missing")
               for t, c in NEW_COLUMNS}
    check(f"new columns on existing tables NULL on every row: {nonnull}", all(n == 0 for n in nonnull.values()))
    added_cols = {t: [c for c in columns(t) if c not in b["cols"][t]] for t in b["cols"]}
    added_cols = {t: c for t, c in added_cols.items() if c}
    check(f"columns added to existing tables are exactly the accepted three: {added_cols}", added_cols == {t: [c] for t, c in NEW_COLUMNS})
    factual_compare(b, s, "the release baseline")

say(f"\nRESULT ({mode}{', local' if args.local else ''}{', endpoint ' + args.endpoint + ' (NOT production)' if args.endpoint else ''}): {'PASS' if not fails else 'FAIL: ' + '; '.join(fails)}")
sys.exit(0 if not fails else 1)
