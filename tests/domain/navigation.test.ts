import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CROSS_LIFECYCLE, LIFECYCLE, NAV_GROUPS, ROUTE_ALIASES, UTILITY } from "@/ui/navigation";

import nextConfig from "../../next.config";

// Phase 4D.10B consultant navigation: the lifecycle in order, the cross-lifecycle capabilities, then utilities.
// Every earlier route stays reachable; Value Changes are reached in context rather than from the navigation.

const app = path.resolve(import.meta.dirname, "../../src/app/projects/[projectId]");
const all = () => NAV_GROUPS.flatMap((g) => g.tabs);
const source = (rel: string) => readFileSync(path.join(app, rel), "utf8");

describe("project navigation", () => {
  it("reads as the consultant lifecycle", () => {
    expect(LIFECYCLE.map((t) => t.label)).toEqual([
      "Overview",
      "Mobilisation",
      "Value Case Definition",
      "Value Case",
      "Assurance",
    ]);
  });

  it("shows Evidence and Information Requests as cross-lifecycle capabilities", () => {
    expect(CROSS_LIFECYCLE.map((t) => t.label)).toEqual(["Evidence", "Information Requests"]);
  });

  it("keeps utilities last", () => {
    expect(UTILITY.map((t) => t.label)).toEqual(["Value Drivers", "Reports", "History"]);
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["lifecycle", "cross-lifecycle", "utility"]);
  });

  it("keeps the existing routes behind the new names", () => {
    const href = (label: string) => all().find((t) => t.label === label)?.href;
    expect(href("Mobilisation")).toBe("/setup");
    expect(href("Value Case Definition")).toBe("/requalification");
  });

  it("no longer offers Value Changes as a navigation destination", () => {
    expect(all().map((t) => t.label)).not.toContain("Value Changes");
    expect(all().map((t) => t.href)).not.toContain("/changes");
  });

  it("links every tab to an existing page, and drops no earlier route (Value Changes stays at /changes)", () => {
    for (const t of all()) expect(existsSync(path.join(app, t.href, "page.tsx")), t.label).toBe(true);
    const before = [
      "",
      "/setup",
      "/information-request",
      "/evidence",
      "/value-case",
      "/requalification",
      "/value-drivers",
      "/assurance",
      "/changes",
      "/reports",
      "/history",
    ];
    for (const href of before) expect(existsSync(path.join(app, href, "page.tsx")), href).toBe(true);
    expect([...all().map((t) => t.href), "/changes"].sort()).toEqual([...before].sort());
  });

  it("keeps Value Changes reachable in context: Value Case, the review's Value Change section, pending changes", () => {
    expect(source("value-case/page.tsx")).toContain('data-testid="value-case-changes-link"');
    expect(source("value-case/page.tsx")).toContain("${base}/changes`");
    const response = readFileSync(path.resolve(app, "../../../ui/assurance/response.tsx"), "utf8");
    expect(response).toMatch(/\/changes\//);
    const summary = readFileSync(path.resolve(app, "../../../ui/value-case/summary.tsx"), "utf8");
    expect(summary).toMatch(/\/changes/);
  });
});

describe("route aliases", () => {
  it("redirect the consultant names to the existing pages, temporarily", async () => {
    expect(ROUTE_ALIASES).toEqual([
      { alias: "/mobilisation", route: "/setup" },
      { alias: "/value-case-definition", route: "/requalification" },
    ]);
    const redirects = await nextConfig.redirects!();
    expect(redirects).toEqual([
      { source: "/projects/:projectId/mobilisation", destination: "/projects/:projectId/setup", permanent: false },
      {
        source: "/projects/:projectId/value-case-definition",
        destination: "/projects/:projectId/requalification",
        permanent: false,
      },
    ]);
    // An alias never shadows a real page.
    for (const { alias } of ROUTE_ALIASES) expect(existsSync(path.join(app, alias))).toBe(false);
  });
});
