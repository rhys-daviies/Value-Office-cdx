import { z } from "zod";

// One validated configuration layer for development, test and production.
//
// Production fails closed: unsafe or incomplete security configuration is refused at
// startup (instrumentation.ts) and on first use. Error messages name the variables and
// the problem, never their values.

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  VO_DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  // Authentication
  /** password: email + password sessions. dev: implicit local identity (never in production). */
  VO_AUTH_MODE: z.enum(["password", "dev"]).optional(),
  VO_DEV_USER_EMAIL: z.email().optional(),
  VO_DEV_USER_NAME: z.string().min(1).optional(),
  /** Keys the session-token hash (HMAC). ≥ 32 characters; rotating it signs everyone out. */
  VO_SESSION_SECRET: z.string().optional(),
  VO_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  /** The public origin, e.g. https://value-office.example.com (used for request-origin checks). */
  VO_APP_ORIGIN: z.url().optional(),

  // Issued report storage
  VO_REPORT_STORAGE: z.enum(["local", "s3"]).default("local"),
  VO_REPORT_STORAGE_DIR: z.string().min(1).optional(),
  VO_S3_BUCKET: z.string().min(1).optional(),
  VO_S3_REGION: z.string().min(1).optional(),
  VO_S3_ENDPOINT: z.url().optional(),
  VO_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  VO_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  VO_S3_FORCE_PATH_STYLE: bool,
  VO_S3_PREFIX: z.string().optional(),

  // PDF rendering
  /** playwright: Playwright's installed Chromium. serverless: @sparticuz/chromium (Vercel / Lambda). */
  VO_PDF_RUNTIME: z.enum(["playwright", "serverless"]).optional(),
  VO_CHROMIUM_EXECUTABLE: z.string().min(1).optional(),
});

export type Env = Omit<z.infer<typeof EnvSchema>, "VO_AUTH_MODE" | "VO_PDF_RUNTIME"> & {
  VO_AUTH_MODE: "password" | "dev";
  VO_PDF_RUNTIME: "playwright" | "serverless";
};

export class ConfigurationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid Value Office configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigurationError";
  }
}

/** Parse and validate a configuration source. Pure; never echoes values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v === "" ? undefined : v]));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message.replace(/received .*/i, "invalid")}`,
      ),
    );
  }
  const e = parsed.data;
  const production = e.NODE_ENV === "production";
  const problems: string[] = [];

  // Auth mode: explicit, or dev only when a dev identity is configured outside production.
  const authMode = e.VO_AUTH_MODE ?? (!production && e.VO_DEV_USER_EMAIL ? "dev" : "password");
  if (production && authMode === "dev") problems.push("VO_AUTH_MODE=dev is not allowed in production");
  if (production && e.VO_DEV_USER_EMAIL) {
    problems.push("VO_DEV_USER_EMAIL must not be set in production (no development identity fallback)");
  }
  if (authMode === "password" && (e.VO_SESSION_SECRET?.length ?? 0) < 32) {
    problems.push("VO_SESSION_SECRET is required for password authentication and must be at least 32 characters");
  }
  if (authMode === "dev" && !e.VO_DEV_USER_EMAIL) problems.push("VO_AUTH_MODE=dev requires VO_DEV_USER_EMAIL");
  if (production && !e.VO_APP_ORIGIN) problems.push("VO_APP_ORIGIN is required in production");

  // Storage: production must use private object storage; s3 mode must be complete.
  if (production && e.VO_REPORT_STORAGE !== "s3") {
    problems.push("VO_REPORT_STORAGE=s3 is required in production (local disk is not durable on serverless hosts)");
  }
  if (e.VO_REPORT_STORAGE === "s3") {
    for (const k of ["VO_S3_BUCKET", "VO_S3_REGION", "VO_S3_ACCESS_KEY_ID", "VO_S3_SECRET_ACCESS_KEY"] as const) {
      if (!e[k]) problems.push(`${k} is required when VO_REPORT_STORAGE=s3`);
    }
  }

  if (production && !e.VO_PDF_RUNTIME) {
    problems.push("VO_PDF_RUNTIME must be set in production (serverless on Vercel, playwright on a Node host)");
  }

  if (problems.length) throw new ConfigurationError(problems);
  return { ...e, VO_AUTH_MODE: authMode, VO_PDF_RUNTIME: e.VO_PDF_RUNTIME ?? "playwright" };
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Tests only: re-read process.env on next use. */
export function resetEnvCache(): void {
  cached = undefined;
}
