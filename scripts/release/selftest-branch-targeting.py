"""Self-test of release TARGET identity (R2B): the wrong-branch failure mode. NON-PRODUCTION ONLY.

Reproduces the aborted R2: a "recovery branch" that is a byte-identical clone of "production". Two throwaway PostgreSQL
18 clusters (TCP localhost, trust auth): P (simulated production, port 5435) is migrated to 0020 and seeded by the
PRODUCTION code (git worktree at b7d0c46); W (simulated recovery branch) is a copy of P's data directory — identical
schema, migration head, roles and factual rows — that differs only in its server identity (the configuration-file
setting a Neon compute carries as neon.branch_id / neon.endpoint_id; here the postmaster-context cluster_name) and its
address. The accepted target file pins P. Cases:

  0  P and W indistinguishable by data: identical factual snapshot, migrations and schema fingerprint
  N1 runner given W (its own address)                              → REFUSED before MIGRATE; W still 0020
  N2 runner given W at P's address (host/port match, server differs) → REFUSED before MIGRATE; W still 0020
  N3 W at P's address + client attempt to spoof the identity setting → REFUSED; W still 0020
  N4 target pins a setting the server does not carry (unidentifiable) → REFUSED
  N5 no override: --rehearse-target without --rehearse refused; a rehearsal target is not a valid production target;
     the committed production target is valid
  R1 release-check reconcile --local-target: P PASSES the identity check, W FAILS it
  P1 runner given P: identity PASSES, operator aborts at the branch checkpoint → nothing applied
  P2 runner given P: branch checkpoint passed, operator declines MIGRATE   → nothing applied
  P3 runner given P: identity → checkpoint → MIGRATE → 0026, identity re-verified; W untouched (0020)

  python3 scripts/release/selftest-branch-targeting.py [--pgbin /Library/PostgreSQL/18/bin] [--port 5435]"""

import argparse, json, os, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import neon_target  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--pgbin", default="/Library/PostgreSQL/18/bin")
ap.add_argument("--port", type=int, default=5435)
ap.add_argument("--base", default="b7d0c46", help="production commit that builds the 0020 state")
args = ap.parse_args()
PP, PW = args.port, args.port + 1

work = tempfile.mkdtemp(prefix="vo-r2b-")
dp, dw, wt, files = f"{work}/prod", f"{work}/recovery", f"{work}/base", f"{work}/files"
os.makedirs(files)
bin_ = lambda n: os.path.join(args.pgbin, n)
URL = lambda port, user="neondb_owner", extra="": f"postgres://{user}@localhost:{port}/neondb{extra}"
results = []

def run(cmd, **kw): return subprocess.run(cmd, capture_output=True, text=True, **kw)
def psql(port, sql, db="neondb"):
    r = run([bin_("psql"), "-h", "localhost", "-p", str(port), "-U", "postgres", "-d", db, "-qAtc", sql])
    if r.returncode: raise SystemExit(f"setup psql failed: {r.stderr[-300:]}")
    return r.stdout.strip()
def start(data, port): run([bin_("pg_ctl"), "-D", data, "-o", f"-p {port} -c unix_socket_directories='' -c listen_addresses=localhost", "-l", f"{data}.log", "-w", "start"], check=True)
def halt(data): run([bin_("pg_ctl"), "-D", data, "stop", "-m", "fast"])
def migrations(port): return int(psql(port, "select count(*) from drizzle.__drizzle_migrations"))
def runner(url, target, stdin):
    r = run([sys.executable, f"{HERE}/migrate-production.py", "--rehearse", url, "--rehearse-target", target], cwd=REPO, input=stdin)
    return r.returncode, r.stdout + r.stderr
def expect(name, ok, detail=""):
    results.append((name, ok)); print(f"  {'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail and not ok else ''}", flush=True)
def target_file(name, **over):
    t = {"kind": neon_target.TARGET_KIND, "name": "simulated production", "branch_name": "main", "host": "localhost",
         "port": PP, "database": "neondb", "settings": {"cluster_name": "vo-prod-sim"}, **over}
    path = f"{files}/{name}.json"; json.dump(t, open(path, "w")); return path
REFUSED_EARLY = lambda rc, out, w_port: rc != 0 and "Type MIGRATE" not in out and migrations(w_port) == 21

try:
    print(f"work dir {work}")
    run([bin_("initdb"), "-D", dp, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"], check=True)
    open(f"{dp}/postgresql.conf", "a").write("\ncluster_name = 'vo-prod-sim'\n")
    start(dp, PP)
    psql(PP, "create role vo_runtime login", "postgres"); psql(PP, "create role neondb_owner login", "postgres")
    psql(PP, "create database neondb owner neondb_owner", "postgres")
    run(["git", "worktree", "add", "-q", "--detach", wt, args.base], cwd=REPO, check=True)
    os.symlink(f"{REPO}/node_modules", f"{wt}/node_modules")
    env = {**os.environ, "NODE_ENV": "development", "VO_DEV_USER_EMAIL": "selftest@cardaxia.ai", "VO_DEV_USER_NAME": "Selftest Consultant",
           "VO_SESSION_SECRET": "selftest-only-secret-0123456789abcdef0123", "VO_REPORT_STORAGE": "database"}
    for step in (["npx", "tsx", "scripts/migrate.ts"], ["npm", "run", "-s", "db:seed:horizon"]):
        r = run(step, cwd=wt, env={**env, "DATABASE_URL": URL(PP), "VO_APP_DB_ROLE": "vo_runtime"})
        if r.returncode: raise SystemExit(f"setup {step} failed: {(r.stdout + r.stderr)[-400:]}")
    halt(dp)
    shutil.copytree(dp, dw)  # the "branch": a byte-identical copy of production's data directory
    open(f"{dw}/postgresql.conf", "a").write("\ncluster_name = 'vo-recovery-sim'\n")
    start(dp, PP); start(dw, PW)
    print(f"setup: P (0020, seeded by {args.base}) on {PP}; W = byte copy of P on {PW}, differing only in server identity")
    good = target_file("target-production")

    # 0 — indistinguishable by data
    snaps, schemas = [], []
    for port in (PP, PW):
        rt = URL(port, "vo_runtime")
        run([sys.executable, f"{HERE}/release-check.py", "snapshot", "--local", rt, "--out", f"{files}/snap-{port}.json"], cwd=REPO, check=True)
        run([sys.executable, f"{HERE}/release-check.py", "schema", "--local", rt, "--out", f"{files}/schema-{port}.txt"], cwd=REPO, check=True)
        snaps.append(json.load(open(f"{files}/snap-{port}.json")))
        schemas.append([l for l in open(f"{files}/schema-{port}.txt").read().splitlines() if not l.startswith("#")])
    expect(f"0 P and W identical: factual snapshot ({sum(v['count'] for v in snaps[0]['tables'].values())} rows), migrations ({len(snaps[0]['migrations'])}), schema ({len(schemas[0])} facts)",
           snaps[0] == snaps[1] and schemas[0] == schemas[1] and len(snaps[0]["migrations"]) == 21)

    # N1 — wrong branch at its own address
    rc, out = runner(URL(PW), good, "main\nMIGRATE\n")
    expect("N1 runner given the recovery clone (own address) REFUSES before MIGRATE; clone still 0020",
           REFUSED_EARLY(rc, out, PW) and "NOT the accepted production target" in out and "port, cluster_name differ" in out, out[-400:])

    # R1 — release-check applies the same identity check (before any migration)
    project = [x.split("=")[0] for x in snaps[0]["projects"]][0]
    r = run([sys.executable, f"{HERE}/release-check.py", "reconcile", "--local", URL(PP, "vo_runtime"), "--local-target", good,
             "--freeze", f"{files}/snap-{PP}.json", "--project", project, "--actor", "nobody"], cwd=REPO)
    expect("R1 release-check: P PASSES the target identity check", r.returncode == 0 and "PASS  connection is the accepted target simulated production" in r.stdout, r.stdout[-400:])
    r = run([sys.executable, f"{HERE}/release-check.py", "reconcile", "--local", URL(PW, "vo_runtime"), "--local-target", good,
             "--freeze", f"{files}/snap-{PP}.json", "--project", project, "--actor", "nobody"], cwd=REPO)
    expect("R1 release-check: W FAILS the target identity check (and only that)", r.returncode != 0 and "FAIL  connection is the accepted target simulated production" in r.stdout
           and r.stdout.count("  FAIL  ") == 1, r.stdout[-400:])

    # N2/N3 — the clone answers at production's address
    halt(dp); halt(dw); start(dw, PP)
    rc, out = runner(URL(PP), good, "main\nMIGRATE\n")
    expect("N2 clone at production's host/port: server identity differs → REFUSED before MIGRATE; clone still 0020",
           REFUSED_EARLY(rc, out, PP) and "cluster_name differ" in out and "vo-recovery-sim" in out, out[-400:])
    rc, out = runner(URL(PP, extra="?options=-c%20cluster_name%3Dvo-prod-sim"), good, "main\nMIGRATE\n")
    expect("N3 clone at production's address + client spoof of the identity setting → REFUSED; clone still 0020",
           REFUSED_EARLY(rc, out, PP) and "STOP" in out, out[-400:])
    halt(dw); start(dp, PP); start(dw, PW)

    # N4 — the server carries no such identity
    rc, out = runner(URL(PP), target_file("target-unidentifiable", settings={"neon.branch_id": "br-main"}), "main\nMIGRATE\n")
    expect("N4 target identity the server cannot prove (setting absent) → REFUSED before MIGRATE; P still 0020",
           REFUSED_EARLY(rc, out, PP) and "absent" in out, out[-400:])

    # N5 — no override for production
    r = run([sys.executable, f"{HERE}/migrate-production.py", "--rehearse-target", good], cwd=REPO, input="")
    expect("N5 --rehearse-target without --rehearse is refused (no production override)", r.returncode != 0 and "go together" in r.stdout, r.stdout[-200:])
    try: neon_target.load_target(good, production=True); ok = False
    except ValueError: ok = True
    prod = neon_target.load_target(neon_target.PRODUCTION_TARGET, production=True)
    expect("N5 a rehearsal target is not a valid production target; the committed production target is valid (neon.* pinned, unpooled host)",
           ok and sorted(prod["settings"]) == list(neon_target.PRODUCTION_SETTINGS) and prod["branch_name"] == "main")

    # P1–P3 — the accepted target
    rc, out = runner(URL(PP), good, "abort\n")
    expect("P1 correct target: identity PASSES; operator aborts at the branch checkpoint → nothing applied",
           rc != 0 and "ok    target identity: connection positively identified" in out and "branch checkpoint" in out and "Type MIGRATE" not in out and migrations(PP) == 21, out[-400:])
    rc, out = runner(URL(PP), good, "main\nno\n")
    expect("P2 correct target: checkpoint passed, MIGRATE declined → nothing applied",
           rc != 0 and "Type MIGRATE" in out and "aborted by operator" in out and migrations(PP) == 21, out[-400:])
    rc, out = runner(URL(PP), good, "main\nMIGRATE\n")
    expect("P3 correct target: identity → checkpoint → MIGRATE → 0026, identity re-verified after; clone untouched at 0020",
           rc == 0 and "target identity after migrating: connection positively identified" in out and "RESULT: migrated simulated production" in out
           and migrations(PP) == 27 and migrations(PW) == 21, out[-600:])
finally:
    halt(dp); halt(dw)
    if os.path.exists(f"{wt}/node_modules"): os.unlink(f"{wt}/node_modules")
    run(["git", "worktree", "remove", "--force", wt], cwd=REPO); run(["git", "worktree", "prune"], cwd=REPO)
    shutil.rmtree(work, ignore_errors=True)

bad = [n for n, ok in results if not ok]
print(f"\nSELFTEST (branch targeting): {len(results) - len(bad)}/{len(results)} PASS" + (f"; FAILED: {bad}" if bad else ""))
sys.exit(1 if bad else 0)
