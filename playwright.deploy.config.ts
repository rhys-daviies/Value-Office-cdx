import { defineConfig, devices } from "@playwright/test";

// Deployment smoke test against a running Value Office (a Vercel deployment, or the
// production-like server CI starts). No web server, no database reset:
//
//   SMOKE_BASE_URL=https://… SMOKE_EMAIL=… SMOKE_PASSWORD=… npm run smoke:deploy
//
// It creates one clearly named smoke-test project per run (audited like any other data).
const baseURL = process.env.SMOKE_BASE_URL;
if (!baseURL) throw new Error("SMOKE_BASE_URL is required");

export default defineConfig({
  testDir: "./smoke",
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 1000 } } }],
});
