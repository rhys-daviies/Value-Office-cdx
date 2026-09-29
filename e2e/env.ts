import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL must be set (see .env.example)");
  return url;
}

// Test-only credentials for the e2e consultant (never used outside the e2e database).
export const E2E_CONSULTANT = {
  email: "e2e.consultant@cardaxia.ai",
  name: "E2E Consultant",
  password: "e2e-only-password-not-a-secret",
};
export const E2E_SESSION_SECRET = "e2e-only-session-secret-0123456789abcdef";
export const E2E_AUTH_STATE = "e2e/.auth/consultant.json";
