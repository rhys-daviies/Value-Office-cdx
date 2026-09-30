import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PRIMARY, SECONDARY } from "@/ui/navigation";

// Phase 4D.4 information architecture: daily work and governed value first; set-up and less
// frequent work secondary. Every earlier route stays reachable.

const pages = path.resolve(import.meta.dirname, "../../src/app/projects/[projectId]");

describe("project navigation", () => {
  it("puts daily work, then governed value, in the primary navigation", () => {
    expect(PRIMARY.map((t) => t.label)).toEqual([
      "Overview",
      "Assurance",
      "Value Drivers",
      "Evidence",
      "Value Case",
      "Value Changes",
      "Reports",
    ]);
  });

  it("keeps set-up and less frequent work in the secondary navigation", () => {
    expect(SECONDARY.map((t) => t.label)).toEqual(["Setup", "Information Requests", "Re-Qualification", "History"]);
  });

  it("links every tab to an existing page, and drops no earlier route", () => {
    for (const t of [...PRIMARY, ...SECONDARY]) {
      expect(existsSync(path.join(pages, t.href, "page.tsx")), t.label).toBe(true);
    }
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
    expect([...PRIMARY, ...SECONDARY].map((t) => t.href).sort()).toEqual([...before].sort());
  });
});
