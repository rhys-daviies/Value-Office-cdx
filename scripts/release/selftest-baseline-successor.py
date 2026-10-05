"""Self-test of baseline-to-baseline reconciliation (R2C): accepted pre-release baseline v1 → reconciled → successor v2.
NON-PRODUCTION ONLY.

One throwaway PostgreSQL 18 cluster (TCP localhost, trust auth) with a server identity (cluster_name, standing in for
Neon's neon.* settings) and a --local-target file pinning it. A 0020 database is migrated and seeded by the PRODUCTION
code (git worktree at b7d0c46); baseline v1 is captured; then a project is created through the real `createProject`
command (client, project, Value Case, 2 key dates — the PROJECT-DREAM shape). Cases:

  A  v1 + legitimate additions: reconcile REPORTS every addition (and writes nothing); pre against v1 still FAILS
  B  PMO-authorised capture --source v1 writes successor v2 (version 2, linked to v1 by sha256); pre against v2 PASSES
  C  v1 byte-identical afterwards
  D  a v1 factual row modified                 → reconcile FAILS
  E  a v1 factual row deleted                  → reconcile FAILS
  F  an unexplained addition (no audit row)    → reconcile FAILS
  G  a FAILED diagnostic as source             → refused
  H  wrong target: source from another target; legacy source vs a proved target; run against another target → refused / FAIL
  I  incompatible source: release baseline, other migration state, bare snapshot, wrong sha256; capture without
     --accepted-by or onto its own source → refused

  python3 scripts/release/selftest-baseline-successor.py [--pgbin /Library/PostgreSQL/18/bin] [--port 5435]"""

import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
CHECK = [sys.executable, f"{HERE}/release-check.py"]
ap = argparse.ArgumentParser()
ap.add_argument("--pgbin", default="/Library/PostgreSQL/18/bin")
ap.add_argument("--port", default="5435")
ap.add_argument("--base", default="b7d0c46", help="production commit that builds the 0020 state")
args = ap.parse_args()

work = tempfile.mkdtemp(prefix="vo-r2c-")
data, wt, files = f"{work}/pg", f"{work}/base", f"{work}/files"
os.makedirs(files)
bin_ = lambda n: os.path.join(args.pgbin, n)
SU = f"postgres://postgres@localhost:{args.port}/neondb"
RT = f"postgres://vo_runtime@localhost:{args.port}/neondb"
results = []

def run(cmd, **kw): return subprocess.run(cmd, capture_output=True, text=True, **kw)
def psql(sql, db="neondb"):
    r = run([bin_("psql"), "-h", "localhost", "-p", args.port, "-U", "postgres", "-d", db, "-qAtc", sql])
    if r.returncode: raise SystemExit(f"setup psql failed: {r.stderr[-300:]}")
    return r.stdout.strip()
def tool(*a):
    r = run([*CHECK, *a], cwd=REPO); return r.returncode, r.stdout + r.stderr
def sha(path): return hashlib.sha256(open(path, "rb").read()).hexdigest()
def expect(name, ok, detail=""):
    results.append((name, ok)); print(f"  {'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail and not ok else ''}", flush=True)
def target(name, cluster):
    path = f"{files}/{name}.json"
    json.dump({"kind": "release-target", "name": "simulated production", "branch_name": "main", "host": "localhost", "port": int(args.port),
               "database": "neondb", "settings": {"cluster_name": cluster}}, open(path, "w"))
    return path
def variant(name, env):
    path = f"{files}/{name}.json"; json.dump(env, open(path, "w")); return path, sha(path)
def restore():
    """Reset neondb to the pristine state (v1 + the legitimate additions) before a destructive case."""
    psql("drop database neondb", "postgres"); psql("create database neondb template pristine", "postgres")

try:
    print(f"work dir {work}")
    run([bin_("initdb"), "-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"], check=True)
    open(f"{data}/postgresql.conf", "a").write("\ncluster_name = 'vo-prod-sim'\n")
    run([bin_("pg_ctl"), "-D", data, "-o", f"-p {args.port} -c unix_socket_directories='' -c listen_addresses=localhost", "-l", f"{work}/pg.log", "-w", "start"], check=True)
    psql("create role vo_runtime login", "postgres"); psql("create database neondb", "postgres")
    run(["git", "worktree", "add", "-q", "--detach", wt, args.base], cwd=REPO, check=True)
    os.symlink(f"{REPO}/node_modules", f"{wt}/node_modules")
    env = {**os.environ, "NODE_ENV": "development", "VO_DEV_USER_EMAIL": "selftest@cardaxia.ai", "VO_DEV_USER_NAME": "Selftest Consultant",
           "VO_SESSION_SECRET": "selftest-only-secret-0123456789abcdef0123", "VO_REPORT_STORAGE": "database", "DATABASE_URL": SU, "VO_APP_DB_ROLE": "vo_runtime"}
    for step in (["npx", "tsx", "scripts/migrate.ts"], ["npm", "run", "-s", "db:seed:horizon"]):
        r = run(step, cwd=wt, env=env)
        if r.returncode: raise SystemExit(f"setup {step} failed: {(r.stdout + r.stderr)[-400:]}")
    T = target("target", "vo-prod-sim")

    # v1: the accepted pre-release baseline (from a bare freeze snapshot, as in R2A)
    freeze, v1, v2 = f"{files}/freeze.json", f"{files}/pre-release-v1.json", f"{files}/pre-release-v2.json"
    tool("snapshot", "--local", RT, "--out", freeze)
    horizon = [p.split("=")[0] for p in json.load(open(freeze))["projects"]][0]
    rc, out = tool("capture", "--local", RT, "--local-target", T, "--freeze", freeze, "--reference", v1, "--project", horizon, "--actor", "Selftest Consultant")
    if rc or not os.path.exists(v1): raise SystemExit(f"setup: v1 capture failed: {out[-400:]}")
    v1_sha = sha(v1)
    print(f"setup: 0020 seeded by {args.base}; v1 captured (sha {v1_sha[:16]}…, target recorded)")

    # legitimate synthetic activity through the real command
    open(f"{wt}/scripts/selftest-create-project.ts", "w").write(
        'import { createProject } from "@/server/commands/project";\nimport { ensureUser } from "@/server/commands/users";\nimport { closeDb } from "@/server/db/client";\n'
        'const actor = await ensureUser(process.env.VO_DEV_USER_EMAIL!, process.env.VO_DEV_USER_NAME!);\n'
        'await createProject(actor, { newClientName: "Selftest Dream client", code: "SELFTEST-DREAM", name: "Selftest Dream", currency: "NZD", kickoffDate: "2026-11-01", goLiveDate: "2027-06-01" });\n'
        'await closeDb();\n')
    r = run(["npx", "tsx", "--conditions=react-server", "scripts/selftest-create-project.ts"], cwd=wt, env=env)
    if r.returncode: raise SystemExit(f"setup: createProject failed: {(r.stdout + r.stderr)[-400:]}")
    psql("create database pristine template neondb", "postgres")
    src = ["--local", RT, "--local-target", T, "--source", v1, "--source-sha256", v1_sha, "--project", "SELFTEST-DREAM", "--actor", "Selftest Consultant"]

    # A — additions are reported, not accepted
    rc, out = tool("reconcile", *src)
    listed = all(f"+ {t} " in out for t in ("client", "project", "value_case", "key_date")) and out.count("+ key_date ") == 2
    expect("A reconcile from v1 PASSES and reports all 5 additions (client, project, value_case, 2 key_date); writes nothing",
           rc == 0 and listed and not os.path.exists(v2), out[-500:])
    rc, out = tool("pre", "--local", RT, "--local-target", T, "--reference", v1, "--baseline", f"{files}/release-a.json")
    expect("A pre against v1 still FAILS on the additions (not silently accepted)",
           rc != 0 and "no factual rows added (added: {" in out and not os.path.exists(f"{files}/release-a.json"), out[-300:])

    # B — successor
    rc, out = tool("capture", *src, "--reference", v2, "--accepted-by", "selftest PMO")
    e2 = json.load(open(v2)) if os.path.exists(v2) else {}
    expect("B capture --source v1 writes successor v2 (version 2, source sha = v1, +5 factual rows, target recorded, acceptance marker)",
           rc == 0 and e2.get("version") == 2 and e2.get("source", {}).get("sha256") == v1_sha and e2.get("accepted_by") == "selftest PMO"
           and e2.get("factual_rows") == json.load(open(v1))["factual_rows"] + 5 and e2.get("target", {}).get("settings") == {"cluster_name": "vo-prod-sim"}
           and sorted(e2.get("source_additions", {})) == ["client", "key_date", "project", "value_case"], out[-400:])
    rc, out = tool("pre", "--local", RT, "--local-target", T, "--reference", v2, "--baseline", f"{files}/release-b.json")
    expect("B pre against v2 PASSES and publishes a release baseline linked to v2",
           rc == 0 and json.load(open(f"{files}/release-b.json")).get("reference_version") == 2, out[-300:])
    rc, out = tool("capture", *src, "--reference", v2, "--accepted-by", "selftest PMO")
    expect("B capture refuses to replace an existing successor without --replace", rc != 0 and "only with --replace" in out, out[-200:])

    # C — v1 immutable
    expect("C v1 byte-identical after reconcile, capture and pre", sha(v1) == v1_sha)

    # D/E/F — detection
    restore(); psql(f"set session_replication_role = replica; update project set name = name || ' (tampered)' where code = '{horizon}'")
    rc, out = tool("reconcile", *src)
    expect("D a modified v1 factual row FAILS reconciliation", rc != 0 and "modified or deleted (changed/removed: {'project': 1})" in out, out[-300:])
    restore(); psql(f"set session_replication_role = replica; delete from client where id = (select client_id from project where code = '{horizon}')")
    rc, out = tool("reconcile", *src)
    expect("E a deleted v1 factual row FAILS reconciliation", rc != 0 and "modified or deleted (changed/removed: {'client': 1})" in out, out[-300:])
    restore(); psql("set session_replication_role = replica; insert into key_date (project_id, kind, label, date) select id, 'other', 'Unexplained', '2027-01-01' from project where code = 'SELFTEST-DREAM'")
    rc, out = tool("reconcile", *src)
    expect("F an unexplained addition (no application audit) FAILS reconciliation", rc != 0 and "untraced: ['key_date:" in out, out[-300:])
    restore()

    # G — FAILED diagnostic
    failed = [n for n in os.listdir(files) if ".FAILED-" in n][0]
    rc, out = tool("reconcile", *src[:4], "--source", f"{files}/{failed}", "--source-sha256", sha(f"{files}/{failed}"), *src[8:])
    expect("G a FAILED diagnostic is refused as source", rc != 0 and "refused — not a 4d10-pre-release-production-baseline" in out, out[-200:])

    def refused(label, path, digest, reason, run_target=T):
        rc, out = tool("reconcile", "--local", RT, "--local-target", run_target, "--source", path, "--source-sha256", digest, *src[8:])
        expect(label, rc != 0 and reason in out, out[-250:])

    # H — target
    e1 = json.load(open(v1))
    p, d = variant("other-target", {**e1, "target": {**e1["target"], "settings": {"cluster_name": "vo-recovery-sim"}}})
    refused("H a source captured from another target is refused", p, d, "captured from a different target")
    p, d = variant("legacy", {k: v for k, v in e1.items() if k != "target"})
    refused("H a legacy source (no recorded target) is refused when a target is proved", p, d, "cannot be proved against --local-target")
    rc, out = tool("reconcile", "--local", RT, "--local-target", target("other", "vo-recovery-sim"), "--source", v1, "--source-sha256", v1_sha, *src[8:])
    expect("H a run against another target FAILS the identity check (and refuses the source)", rc != 0 and "FAIL  connection is the accepted target" in out and "captured from a different target" in out, out[-300:])

    # I — incompatible
    refused("I a release baseline (PRE output) is refused as source", f"{files}/release-b.json", sha(f"{files}/release-b.json"), "not a 4d10-pre-release-production-baseline")
    p, d = variant("state-27", {**e1, "migration_rows": 27})
    refused("I a source in another migration state is refused", p, d, "not a migration-0020 state")
    refused("I a bare snapshot (no envelope) is refused", freeze, sha(freeze), "not a 4d10-pre-release-production-baseline")
    refused("I a source whose sha256 is not the accepted one is refused", v1, "0" * 64, "is not the accepted")
    rc, out = tool("capture", *src, "--reference", f"{files}/v2-other.json")
    expect("I capture --source without --accepted-by is refused", rc != 0 and "needs --accepted-by" in out and not os.path.exists(f"{files}/v2-other.json"), out[-200:])
    rc, out = tool("capture", *src, "--reference", v1, "--accepted-by", "x", "--replace")
    expect("I capture onto its own source is refused (v1 never overwritten)", rc != 0 and "other than the source" in out and sha(v1) == v1_sha, out[-200:])
finally:
    run([bin_("pg_ctl"), "-D", data, "stop", "-m", "fast"])
    if os.path.exists(f"{wt}/node_modules"): os.unlink(f"{wt}/node_modules")
    run(["git", "worktree", "remove", "--force", wt], cwd=REPO); run(["git", "worktree", "prune"], cwd=REPO)
    shutil.rmtree(work, ignore_errors=True)

bad = [n for n, ok in results if not ok]
print(f"\nSELFTEST (baseline successor): {len(results) - len(bad)}/{len(results)} PASS" + (f"; FAILED: {bad}" if bad else ""))
sys.exit(1 if bad else 0)
