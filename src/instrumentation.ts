// Runs once per server instance before any request is handled. In production, invalid or
// unsafe configuration stops the server from starting (fail closed). Errors name the
// variables or the problem, never secret values.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/server/env");
  const config = env();
  if (config.NODE_ENV !== "production") return;

  // The application must not connect as a superuser or schema owner: the integrity model
  // (audit, immutability, command enforcement) depends on it being unable to bypass triggers.
  const { checkApplicationRole, withClient } = await import("@/server/db/role");
  const role = await withClient(config.DATABASE_URL, checkApplicationRole);
  if (role.problems.length) {
    throw new Error(`Unsafe database role for the Value Office application: ${role.problems.join("; ")}`);
  }
  console.log(
    `[value-office] configuration ok: auth=${config.VO_AUTH_MODE} storage=${config.VO_REPORT_STORAGE} pdf=${config.VO_PDF_RUNTIME} db-role=least-privilege`,
  );
}
