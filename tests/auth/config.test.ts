import { afterEach, describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import { NextRequest } from "next/server";

import { register } from "@/instrumentation";
import { mayBeAuthenticated } from "@/proxy";
import { ConfigurationError, parseEnv, resetEnvCache } from "@/server/env";

const SECRET = "s".repeat(40);
const S3_SECRET = "super-secret-storage-key-value";
const PROD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:app-db-password@db.example.com/vo",
  VO_SESSION_SECRET: SECRET,
  VO_APP_ORIGIN: "https://value-office.example.com",
  VO_REPORT_STORAGE: "s3",
  VO_S3_BUCKET: "vo-reports",
  VO_S3_REGION: "eu-west-2",
  VO_S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
  VO_S3_SECRET_ACCESS_KEY: S3_SECRET,
  VO_PDF_RUNTIME: "serverless",
} as const;

const problems = (source: Record<string, string | undefined>) => {
  try {
    parseEnv(source);
    return [];
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigurationError);
    return (err as ConfigurationError).problems;
  }
};

describe("environment validation", () => {
  it("accepts a complete production configuration (password auth, private S3, explicit PDF runtime)", () => {
    const e = parseEnv(PROD);
    expect(e).toMatchObject({ VO_AUTH_MODE: "password", VO_REPORT_STORAGE: "s3", VO_PDF_RUNTIME: "serverless" });
  });

  it("production never falls back to a development identity", () => {
    expect(problems({ ...PROD, VO_AUTH_MODE: "dev", VO_DEV_USER_EMAIL: "dev@cardaxia.ai" })).toEqual(
      expect.arrayContaining([
        "VO_AUTH_MODE=dev is not allowed in production",
        "VO_DEV_USER_EMAIL must not be set in production (no development identity fallback)",
      ]),
    );
    // Even without VO_AUTH_MODE, a stray dev identity is refused rather than ignored.
    expect(problems({ ...PROD, VO_DEV_USER_EMAIL: "dev@cardaxia.ai" })).toHaveLength(1);
  });

  it("fails closed on missing or weak production security configuration", () => {
    expect(problems({ ...PROD, VO_SESSION_SECRET: undefined })[0]).toMatch(/VO_SESSION_SECRET is required/);
    expect(problems({ ...PROD, VO_SESSION_SECRET: "short" })[0]).toMatch(/at least 32 characters/);
    expect(problems({ ...PROD, VO_APP_ORIGIN: undefined })).toEqual(["VO_APP_ORIGIN is required in production"]);
    expect(problems({ ...PROD, DATABASE_URL: undefined })[0]).toMatch(/^DATABASE_URL:/);
    expect(problems({ ...PROD, VO_PDF_RUNTIME: undefined })[0]).toMatch(/VO_PDF_RUNTIME must be set/);
    expect(problems({ ...PROD, VO_REPORT_STORAGE: "local" })[0]).toMatch(/VO_REPORT_STORAGE=s3 is required/);
  });

  it("incomplete object-storage configuration fails closed in any environment", () => {
    expect(problems({ ...PROD, VO_S3_SECRET_ACCESS_KEY: undefined, VO_S3_BUCKET: undefined })).toEqual([
      "VO_S3_BUCKET is required when VO_REPORT_STORAGE=s3",
      "VO_S3_SECRET_ACCESS_KEY is required when VO_REPORT_STORAGE=s3",
    ]);
    expect(
      problems({
        NODE_ENV: "development",
        DATABASE_URL: PROD.DATABASE_URL,
        VO_REPORT_STORAGE: "s3",
        VO_DEV_USER_EMAIL: "d@x.io",
      }),
    ).toHaveLength(4);
  });

  it("errors never echo secret values", () => {
    const all = [
      ...problems({ ...PROD, VO_SESSION_SECRET: "short-secret-value" }),
      ...problems({ ...PROD, DATABASE_URL: "not a url with a password hunter2" }),
      ...problems({ ...PROD, VO_S3_ENDPOINT: "nope secret-endpoint" }),
    ].join("\n");
    for (const secret of ["short-secret-value", "hunter2", "secret-endpoint", S3_SECRET, "app-db-password"]) {
      expect(all).not.toContain(secret);
    }
  });

  it("development keeps an explicit local identity path; password mode needs a secret everywhere", () => {
    const dev = parseEnv({ DATABASE_URL: PROD.DATABASE_URL, VO_DEV_USER_EMAIL: "dev@cardaxia.ai" });
    expect(dev).toMatchObject({ NODE_ENV: "development", VO_AUTH_MODE: "dev", VO_REPORT_STORAGE: "local" });
    expect(problems({ DATABASE_URL: PROD.DATABASE_URL })[0]).toMatch(/VO_SESSION_SECRET is required/);
    expect(problems({ DATABASE_URL: PROD.DATABASE_URL, VO_AUTH_MODE: "dev" })).toEqual([
      "VO_AUTH_MODE=dev requires VO_DEV_USER_EMAIL",
    ]);
  });
});

describe("production startup", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });

  it("refuses to start with unsafe authentication configuration", async () => {
    process.env = { ...saved, ...PROD, NEXT_RUNTIME: "nodejs", VO_AUTH_MODE: "dev", VO_DEV_USER_EMAIL: "d@x.io" };
    resetEnvCache();
    await expect(register()).rejects.toThrow(/VO_AUTH_MODE=dev is not allowed in production/);
  });

  it("refuses to start when connected as a superuser or schema owner", async () => {
    // The test database role is the schema owner: exactly what production must refuse.
    process.env = { ...saved, ...PROD, NEXT_RUNTIME: "nodejs", DATABASE_URL: saved.DATABASE_URL };
    delete process.env.VO_DEV_USER_EMAIL;
    delete process.env.VO_AUTH_MODE;
    resetEnvCache();
    await expect(register()).rejects.toThrow(/Unsafe database role.*(superuser|owns Value Office tables)/);
  });
});

describe("security headers", () => {
  it("sets clickjacking, sniffing, referrer and permissions protections on every route", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!.headers;
    const get = (k: string) => all.find((x) => x.key === k)?.value;
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("Referrer-Policy")).toBe("same-origin");
    expect(get("Permissions-Policy")).toContain("camera=()");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("proxy auth-mode resolution", () => {
  const req = (cookie?: string) => new NextRequest("http://localhost/projects", { headers: cookie ? { cookie } : {} });
  it("follows the validated auth mode, including dev mode implied by VO_DEV_USER_EMAIL", () => {
    const dev = parseEnv({ DATABASE_URL: PROD.DATABASE_URL, VO_DEV_USER_EMAIL: "dev@cardaxia.ai" });
    expect(mayBeAuthenticated(req(), dev)).toBe(true);
    const pw = parseEnv({ DATABASE_URL: PROD.DATABASE_URL, VO_SESSION_SECRET: SECRET });
    expect(mayBeAuthenticated(req(), pw)).toBe(false);
    expect(mayBeAuthenticated(req("vo_session=x"), pw)).toBe(true);
    const prod = parseEnv(PROD);
    expect(mayBeAuthenticated(req("vo_session=x"), prod)).toBe(false); // production uses the __Host- cookie
    expect(mayBeAuthenticated(req("__Host-vo_session=x"), prod)).toBe(true);
  });
});
