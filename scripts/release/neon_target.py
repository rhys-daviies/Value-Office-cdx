"""Release target identity (4D.10R2B): positive proof that a connection reaches the accepted production Neon branch.

Why: in the aborted R2 the runner accepted a connection to the new recovery branch, because a branch is a byte-identical
clone of production (same database name, schema, migration state, PostgreSQL version and roles). Nothing about the
DATA can distinguish them. What does distinguish them:

  1. the HOST: every Neon branch has its own compute endpoint, and the connection hostname carries its ID
     (ep-<name>[-pooler].<region>.aws.neon.tech);
  2. the SERVER's own identity settings: each Neon compute is started with neon.project_id, neon.branch_id and
     neon.endpoint_id in its configuration file (pg_settings source 'configuration file'; neon.project_id and
     neon.branch_id are postmaster-context, neon.endpoint_id superuser-context, so a client cannot override them with
     options=-c, and anything not from the configuration file is refused).

A target file (production: scripts/release/production-target.json, accepted in R2B) names the expected host, port,
database and server settings. Every field must match exactly, or the caller refuses. SQL cannot reveal the branch
NAME (`main`): that link is the human-confirmed part of the target file (Rhys, Neon Console, R2B)."""

import json, os
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
PRODUCTION_TARGET = f"{HERE}/production-target.json"
TARGET_KIND = "release-target"
PRODUCTION_SETTINGS = ("neon.branch_id", "neon.endpoint_id", "neon.project_id")


def load_target(path, production):
    """Load a target file; a production target must pin exactly the three Neon identity settings and a Neon host."""
    t = json.load(open(path))
    need = ("kind", "name", "branch_name", "host", "port", "database", "settings")
    if not isinstance(t, dict) or t.get("kind") != TARGET_KIND or not all(k in t for k in need):
        raise ValueError(f"{os.path.basename(path)} is not a {TARGET_KIND} file")
    if not isinstance(t["settings"], dict) or not t["settings"] or not all(isinstance(v, str) and v for v in t["settings"].values()):
        raise ValueError(f"{os.path.basename(path)} names no server identity settings")
    if production:
        if tuple(sorted(t["settings"])) != PRODUCTION_SETTINGS:
            raise ValueError(f"production target must pin exactly {', '.join(PRODUCTION_SETTINGS)}")
        if not t["host"].startswith(t["settings"]["neon.endpoint_id"] + ".") or "-pooler" in t["host"]:
            raise ValueError("production target host is not the unpooled host of its endpoint")
    return t


def identity_sql(t):
    names = ",".join("'" + n.replace("'", "''") + "'" for n in sorted(t["settings"]))
    # Fully qualified: an unqualified pg_settings could resolve to a same-named object earlier in search_path.
    return (f"select name||'|'||setting||'|'||source from pg_catalog.pg_settings where name in ({names}) "
            f"union all select 'current_database|'||current_database()||'|server' order by 1")


def compare(t, url, q):
    """Return [(field, expected, actual, ok)] for the connection `url` (q runs SQL on it). Never includes credentials."""
    p = urlsplit(url)
    rows = {}
    for line in q(identity_sql(t)).splitlines():
        if line:
            name, setting, source = line.split("|", 2)
            rows[name] = (setting, source)
    out = [("host", t["host"], p.hostname or "", (p.hostname or "") == t["host"]),
           ("port", str(t["port"]), str(p.port or 5432), (p.port or 5432) == int(t["port"])),
           ("database", t["database"], rows.get("current_database", ("?",))[0], rows.get("current_database", ("?",))[0] == t["database"])]
    for name in sorted(t["settings"]):
        setting, source = rows.get(name, ("absent", "-"))
        shown = setting if source == "configuration file" else f"{setting} (source {source}: refused)"
        out.append((name, t["settings"][name], shown, setting == t["settings"][name] and source == "configuration file"))
    return out


def render(t, result):
    w = max(len(r[0]) for r in result)
    lines = [f"  TARGET IDENTITY — expected: {t['name']} (Neon branch `{t['branch_name']}`)",
             f"    {'field'.ljust(w)}  {'expected'.ljust(46)}  actual"]
    lines += [f"    {f.ljust(w)}  {e.ljust(46)}  {a}  {'ok' if ok else '<-- MISMATCH'}" for f, e, a, ok in result]
    return "\n".join(lines)


def matches(result): return all(r[3] for r in result)
