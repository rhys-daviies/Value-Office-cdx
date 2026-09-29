// Runs once per server instance before any request is handled. On a deployed server
// (NODE_ENV=production), invalid or unsafe configuration stops the server from starting
// (fail closed). Errors name the variables or the problem, never secret values.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/server/env");
  const config = env();
  if (config.NODE_ENV !== "production") return;

  // Production (client-data) tier: the application must not connect as a superuser or schema
  // owner — the integrity model depends on it being unable to bypass triggers.
  // Internal / pilot tier: the provider-managed role (e.g. Neon's neondb_owner) is accepted and
  // the gap is logged. Triggers still fire for owners; the application never disables them.
  const { checkApplicationRole, withClient } = await import("@/server/db/role");
  const role = await withClient(config.DATABASE_URL, checkApplicationRole);
  if (role.problems.length && config.deployment === "production") {
    throw new Error(`Unsafe database role for the Value Office application: ${role.problems.join("; ")}`);
  }
  if (role.problems.length) {
    console.warn(
      `[value-office] INTERNAL / PILOT deployment — not for sensitive client data. Database role accepted without least-privilege restriction: ${role.problems.join("; ")}`,
    );
  }
  console.log(
    `[value-office] configuration ok: deployment=${config.deployment} auth=${config.VO_AUTH_MODE} storage=${config.VO_REPORT_STORAGE} pdf=${config.VO_PDF_RUNTIME} db-role=${role.problems.length ? "provider-managed" : "least-privilege"}`,
  );
}
