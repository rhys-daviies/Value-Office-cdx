"""4D.10 production release checks — READ-ONLY. Successor of ~/.cardaxia-4d9m/n1c-check.py for the 0020 → 0026
release (docs/release/4d10-release-procedure.md lists every check and why it changed).

Modes
  schema    (local only) write the schema fingerprint of a freshly migrated database — how schema-0020.txt and
            schema-0026.txt are captured
  snapshot  save a factual snapshot (any state) — used only to create a local freeze for rehearsal validation
  pre       production must be EXACTLY the accepted pre-release state (migration head 0020, accepted 0020 schema,
            factual rows identical to the 4D.9N freeze); saves the release baseline
  post      production must be EXACTLY the accepted post-release state (head 0026, accepted 0026 schema and grants,
            every baseline row identical over its baseline columns, new columns null, new tables empty, no factual
            rows added, reports byte-identical)

Connection
  default   production vo_runtime from the macOS Keychain (service value-office-prod-vo_runtime), forced to a
            read-only session on the unpooled host, TLS required
  --local URL  localhost-only database for rehearsal validation (never production)

Connection strings and passwords are never printed or written; output is scrubbed."""

import argparse, hashlib, json, os, re, subprocess, sys
from urllib.parse import quote, urlsplit, urlunsplit

HERE = os.path.dirname(os.path.abspath(__file__))
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

ap = argparse.ArgumentParser()
ap.add_argument("mode", choices=["schema", "snapshot", "pre", "post"])
ap.add_argument("--local", help="localhost database URL (rehearsal validation only)")
ap.add_argument("--freeze", default=f"{TOOLS}/n1c-freeze.json", help="accepted factual snapshot the pre-check must match")
ap.add_argument("--baseline", default=f"{TOOLS}/4d10-release-baseline.json", help="release baseline written by pre, read by post")
ap.add_argument("--out", help="snapshot output file (snapshot mode)")
args = ap.parse_args()

SECRETS, fails = [], []
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

def common(s):
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

mode = args.mode
if mode == "schema":
    if not args.local or not args.out: say("STOP: schema capture is local-only and needs --out"); sys.exit(1)
    ver = q("select current_setting('server_version')")
    open(args.out, "w").write(f"# Accepted schema fingerprint, captured from a fresh migration on PostgreSQL {ver} (release-check.py schema)\n" + "\n".join(schema_lines()) + "\n")
    say(f"schema fingerprint written: {len(schema_lines())} facts (PostgreSQL {ver})")
    sys.exit(0)
if mode == "snapshot":
    s = snapshot(); json.dump(s, open(args.out, "w"))
    say(f"snapshot saved: {len(s['tables'])} tables, {sum(v['count'] for v in s['tables'].values())} rows, {len(s['migrations'])} migrations")
    sys.exit(0)

if mode == "pre":
    s = snapshot(); local = common(s)
    check(f"production migration head 0020: {len(s['migrations'])} rows, hashes = repository 0000–0020", s["migrations"] == local[:PRE_HEAD])
    schema_check(f"{HERE}/schema-0020.txt", "schema exactly the accepted 0020 schema (incl. vo_runtime grants)")
    if not os.path.exists(args.freeze):
        check(f"accepted factual snapshot available ({os.path.basename(args.freeze)})", False)
    else:
        f = json.load(open(args.freeze))
        check("migration rows identical to the accepted snapshot", s["migrations"] == f["migrations"])
        factual_compare(f, s, "the accepted snapshot")
    json.dump(s, open(args.baseline, "w"))
    say(f"\nrelease baseline saved ({os.path.basename(args.baseline)}): {len(s['tables'])} tables, {sum(v['count'] for v in s['tables'].values())} rows, audit max id {s['audit_max']}")
else:
    b = json.load(open(args.baseline))
    s = snapshot(column_sets=b["cols"]); local = common(s)
    check(f"production migration head 0026: {len(s['migrations'])} rows, hashes = repository 0000–0026", s["migrations"] == local[:POST_HEAD])
    check("the first 21 migration rows are the baseline's (0000–0020 untouched)", s["migrations"][:PRE_HEAD] == b["migrations"])
    say("  info  new migration hashes: " + ", ".join(h[:16] for h in s["migrations"][PRE_HEAD:]))
    schema_check(f"{HERE}/schema-0026.txt", "schema exactly the accepted 0026 schema (incl. vo_runtime grants on the new tables)")
    check(f"tables: baseline {len(b['cols'])} + {len(NEW_TABLES)} new = {len(s['cols'])}", set(s["cols"]) == set(b["cols"]) | set(NEW_TABLES) and not set(b["cols"]) & set(NEW_TABLES))
    empty = {t: s["tables"][t]["count"] for t in NEW_TABLES if t in s["tables"]}
    check(f"new tables empty: {empty}", all(n == 0 for n in empty.values()) and len(empty) == len(NEW_TABLES))
    nonnull = {f"{t}.{c}": (int(q(f"select count(*) from public.{t} where {c} is not null")) if c in s["cols"].get(t, []) or c in columns(t) else "missing")
               for t, c in NEW_COLUMNS}
    check(f"new columns on existing tables NULL on every row: {nonnull}", all(n == 0 for n in nonnull.values()))
    added_cols = {t: [c for c in columns(t) if c not in b["cols"][t]] for t in b["cols"]}
    added_cols = {t: c for t, c in added_cols.items() if c}
    check(f"columns added to existing tables are exactly the accepted three: {added_cols}", added_cols == {t: [c] for t, c in NEW_COLUMNS})
    factual_compare(b, s, "the release baseline")

say(f"\nRESULT ({mode}{', local' if args.local else ''}): {'PASS' if not fails else 'FAIL: ' + '; '.join(fails)}")
sys.exit(0 if not fails else 1)
