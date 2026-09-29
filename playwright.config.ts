import { defineConfig, devices } from "@playwright/test";

import { e2eDatabaseUrl } from "./e2e/env";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Journeys mutate shared state (one server, one database): run serially.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  expect: { timeout: 10_000 },
  timeout: 120_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 1000 } } }],
  webServer: {
    // A dedicated dev server against the dedicated e2e database (never the dev database).
    command: `npx next dev --port ${PORT}`,
    // /status renders even before globalSetup has created the e2e database
    // (Playwright starts the web server first), so it is a safe readiness probe.
    url: `http://localhost:${PORT}/status`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      VO_DEV_USER_EMAIL: "e2e.consultant@cardaxia.ai",
      VO_DEV_USER_NAME: "E2E Consultant",
      VO_REPORT_STORAGE_DIR: "test-results/e2e-report-storage",
    },
  },
});
