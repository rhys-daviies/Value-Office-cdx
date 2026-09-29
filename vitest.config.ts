import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "vitest/config";

// Inline (not imported) so Vite's native config loader needs no extensionless imports.
for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL must be set (see .env.example)");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside the react-server condition; tests are server code.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    env: { DATABASE_URL: testDatabaseUrl, NODE_ENV: "test" },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
