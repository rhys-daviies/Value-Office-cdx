"""Self-test of release-check.py's accepted-file handling (R2A). NON-PRODUCTION ONLY.

Builds a throwaway PostgreSQL 18 cluster (temporary directory, TCP localhost only, trust auth), a 0020 database migrated
and seeded by the PRODUCTION code (git worktree at b7d0c46), copies for destructive cases, and runs:

  A  valid 0020 state           capture + pre PASS; canonical release baseline published (accepted envelope)
  B  factual mismatch           pre FAIL; canonical not created / not replaced; only a FAILED diagnostic
  C  schema mismatch            pre FAIL; canonical not created / not replaced
  D  owner session              pre FAIL; canonical not created / not replaced
  E  post, no baseline          refused
  F  post, failed/unaccepted/malformed/foreign baseline   refused
  G  accepted baseline + 0026   post PASS
  +  capture refuses to replace an existing pre-release baseline without --replace

  python3 scripts/release/selftest-release-check.py [--pgbin /Library/PostgreSQL/18/bin] [--port 5435]"""

import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
CHECK = [sys.executable, f"{HERE}/release-check.py"]
ap = argparse.ArgumentParser()
ap.add_argument("--pgbin", default="/Library/PostgreSQL/18/bin")
ap.add_argument("--port", default="5435")
ap.add_argument("--base", default="b7d0c46", help="production commit that builds the 0020 state")
args = ap.parse_args()

work = tempfile.mkdtemp(prefix="vo-r2a-")
data, wt, files = f"{work}/pg", f"{work}/base", f"{work}/files"
os.makedirs(files)
bin_ = lambda n: os.path.join(args.pgbin, n)
SU = lambda db: f"postgres://postgres@localhost:{args.port}/{db}"
RT = lambda db: f"postgres://vo_runtime@localhost:{args.port}/{db}"
results = []

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)
def psql(db, sql, user="postgres"):
    r = run([bin_("psql"), "-h", "localhost", "-p", args.port, "-U", user, "-d", db, "-qAtc", sql])
    if r.returncode: raise SystemExit(f"setup psql failed: {r.stderr[-300:]}")
    return r.stdout.strip()
def check_tool(*a):
    r = run([*CHECK, *a], cwd=REPO)
    return r.returncode, r.stdout + r.stderr
def sha(path): return hashlib.sha256(open(path, "rb").read()).hexdigest() if os.path.exists(path) else None
def expect(name, ok, detail=""):
    results.append((name, ok)); print(f"  {'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail and not ok else ''}", flush=True)

try:
    print(f"work dir {work}")
    run([bin_("initdb"), "-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"], check=True)
    run([bin_("pg_ctl"), "-D", data, "-o", f"-p {args.port} -c unix_socket_directories='' -c listen_addresses=localhost", "-l", f"{work}/pg.log", "-w", "start"], check=True)
    psql("postgres", "create role vo_runtime login"); psql("postgres", "create role neondb_owner login")
    run(["git", "worktree", "add", "-q", "--detach", wt, args.base], cwd=REPO, check=True)
    os.symlink(f"{REPO}/node_modules", f"{wt}/node_modules")
    env = {**os.environ, "NODE_ENV": "development", "VO_DEV_USER_EMAIL": "selftest@cardaxia.ai", "VO_DEV_USER_NAME": "Selftest Consultant",
           "VO_SESSION_SECRET": "selftest-only-secret-0123456789abcdef0123", "VO_REPORT_STORAGE": "database"}
    psql("postgres", "create database a20")
    for step in (["npx", "tsx", "scripts/migrate.ts"], ["npm", "run", "-s", "db:seed:horizon"]):
        r = run(step, cwd=wt, env={**env, "DATABASE_URL": SU("a20"), "VO_APP_DB_ROLE": "vo_runtime"})
        if r.returncode: raise SystemExit(f"setup {step} failed: {(r.stdout + r.stderr)[-400:]}")
    for c in ("b_fact", "c_schema", "d_owner"): psql("postgres", f"create database {c} template a20")
    print("setup: 0020 database seeded by the production code; copies b_fact, c_schema, d_owner")

    freeze, ref, base = f"{files}/freeze.json", f"{files}/reference.json", f"{files}/release-baseline.json"
    rc, out = check_tool("snapshot", "--local", RT("a20"), "--out", freeze)
    project = [p.split("=")[0] for p in json.load(open(freeze))["projects"]][0]
    common = ["--freeze", freeze, "--reference", ref, "--project", project, "--actor", "Selftest Consultant"]

    # A — valid 0020 state
    rc, out = check_tool("capture", "--local", RT("a20"), *common)
    expect("A capture on a valid 0020 state PASSES and writes the pre-release baseline", rc == 0 and os.path.exists(ref), out[-300:])
    rc, out = check_tool("capture", "--local", RT("a20"), *common)
    expect("+ capture refuses to replace an existing pre-release baseline without --replace", rc != 0 and "only with --replace" in out, out[-200:])
    rc, out = check_tool("pre", "--local", RT("a20"), "--reference", ref, "--baseline", base)
    env_ok = os.path.exists(base) and json.load(open(base)).get("kind") == "4d10-release-baseline" and json.load(open(base)).get("accepted") is True
    expect("A pre on a valid 0020 state PASSES and publishes an accepted release baseline", rc == 0 and env_ok, out[-300:])
    accepted_sha = sha(base)

    def failing_pre(label, db, setup, reason):
        setup()
        for target, existing in ((f"{files}/{db}-new.json", False), (base, True)):
            before = sha(target)
            rc, out = check_tool("pre", "--local", RT(db), "--reference", ref, "--baseline", target, *(["--replace"] if existing else []))
            diag = [n for n in os.listdir(files) if n.startswith(os.path.basename(target) + ".FAILED-")]
            ok = rc != 0 and sha(target) == before and "release baseline NOT published" in out and diag and reason in out
            expect(f"{label}: pre FAILS and the canonical baseline is {'not replaced' if existing else 'not created'} (FAILED diagnostic only)", bool(ok), out[-300:])

    failing_pre("B factual mismatch", "b_fact", lambda: psql("b_fact", "set session_replication_role = replica; update project set name = name || ' (selftest tamper)' where id = (select id from project limit 1)"),
               "FAIL  the 4D.10 pre-release baseline: every factual row present and byte-identical (changed/removed: {'project': 1})")
    failing_pre("C schema mismatch", "c_schema", lambda: psql("c_schema", "create index selftest_extra_idx on project (name)"),
               "missing 0, unexpected 1")
    holder = subprocess.Popen([bin_("psql"), "-h", "localhost", "-p", args.port, "-U", "neondb_owner", "-d", "d_owner", "-qAtc", "select pg_sleep(600)"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    try: failing_pre("D owner session", "d_owner", lambda: None, "FAIL  other client connections by role: neondb_owner×1")
    finally: holder.terminate()
    expect("A accepted release baseline unchanged by B–D", sha(base) == accepted_sha)

    # E/F — post refuses anything but an accepted 0020-state release baseline
    rc, out = check_tool("post", "--local", RT("a20"), "--baseline", f"{files}/missing.json")
    expect("E post with no baseline is refused", rc != 0 and "missing" in out, out[-200:])
    failed = [n for n in os.listdir(files) if ".FAILED-" in n][0]
    rc, out = check_tool("post", "--local", RT("a20"), "--baseline", f"{files}/{failed}")
    expect("F post with a FAILED candidate is refused", rc != 0 and "refused" in out, out[-200:])
    variants = {
        "unaccepted": lambda e: {**e, "accepted": False},
        "legacy bare snapshot (no envelope)": lambda e: e["snapshot"],
        "pre-release reference instead of release baseline": lambda e: {**e, "kind": "4d10-pre-release-production-baseline"},
        "different accepted schema": lambda e: {**e, "schema_0020_sha256": "0" * 64},
        "different migration state": lambda e: {**e, "migration_rows": 27},
    }
    acc = json.load(open(base))
    for name, mut in variants.items():
        path = f"{files}/variant.json"; json.dump(mut(json.loads(json.dumps(acc))), open(path, "w"))
        rc, out = check_tool("post", "--local", RT("a20"), "--baseline", path)
        expect(f"F post with a {name} baseline is refused", rc != 0 and "refused" in out, out[-200:])
    open(f"{files}/garbage.json", "w").write("{not json")
    rc, out = check_tool("post", "--local", RT("a20"), "--baseline", f"{files}/garbage.json")
    expect("F post with a malformed baseline is refused", rc != 0 and "malformed" in out, out[-200:])

    # G — migrate with the release candidate; post PASSES on the accepted baseline
    r = run(["npx", "tsx", "scripts/migrate.ts"], cwd=REPO, env={**env, "DATABASE_URL": SU("a20"), "VO_APP_DB_ROLE": "vo_runtime"})
    rc, out = check_tool("post", "--local", RT("a20"), "--baseline", base)
    expect("G accepted baseline + 0026 state: post PASSES", r.returncode == 0 and rc == 0, out[-400:])
finally:
    run([bin_("pg_ctl"), "-D", data, "stop", "-m", "fast"])
    if os.path.exists(f"{wt}/node_modules"): os.unlink(f"{wt}/node_modules")
    run(["git", "worktree", "remove", "--force", wt], cwd=REPO); run(["git", "worktree", "prune"], cwd=REPO)
    shutil.rmtree(work, ignore_errors=True)

bad = [n for n, ok in results if not ok]
print(f"\nSELFTEST: {len(results) - len(bad)}/{len(results)} PASS" + (f"; FAILED: {bad}" if bad else ""))
sys.exit(1 if bad else 0)
