import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { versionAuthority } from "@/domain/value-case";
import { presentRuleMessage } from "@/server/actions/errors";
import { COMMAND_LABELS } from "@/ui/labels";

// Phase 4D.10B consultant terminology: Mobilisation, Value Case Definition, Original Business Case. Technical
// identifiers (routes, enums, command names, report types) are unchanged, and the client reports keep their wording
// (the Re-Qualification Report is a later, versioned renderer change).

const root = path.resolve(import.meta.dirname, "../..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}
/** Consultant-facing application code: pages, UI components and action messages — not the report renderers. */
const consultantFacing = [
  ...files(path.join(root, "src/app")),
  ...files(path.join(root, "src/ui")).filter((f) => !f.includes(`${path.sep}reports${path.sep}`)),
  // errors.ts holds the old wording only as the patterns it re-words.
  ...files(path.join(root, "src/server/actions")).filter((f) => !f.endsWith("errors.ts")),
  path.join(root, "src/server/queries/projects.ts"),
  path.join(root, "src/domain/value-case.ts"),
  path.join(root, "src/domain/assurance-cadence.ts"),
];
const strings = (f: string) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // comments are not UI
    .join("\n");

describe("consultant terminology", () => {
  it("never shows Setup, Re-Qualification or Inherited Business Case (V0) as operating terminology", () => {
    const offenders = consultantFacing.flatMap((f) => {
      const s = strings(f);
      const hits = [
        ...(s.match(/Re-Qualif\w*\b(?! Report)/g) ?? []),
        ...(s.match(/[Ii]nherited Business Case/g) ?? []),
        ...(s.match(/V0 · Inherited|Inherited · V|Record V0|capturing V0/g) ?? []),
        ...(s.match(/>\s*Setup\s*<|"Setup"|Open Setup|in Setup/g) ?? []),
      ];
      return hits.map((h) => `${path.relative(root, f)}: ${h}`);
    });
    expect(offenders).toEqual([]);
  });

  it("names the Original Business Case and the definition draft in version authority", () => {
    expect(versionAuthority("inherited_business_case", "draft", 0)).toBe("Original Business Case (being captured)");
    expect(versionAuthority("inherited_business_case", "recorded", 0)).toBe("Original Business Case");
    expect(versionAuthority("value_case", "draft", 1)).toBe("Draft Value Case (in definition)");
  });

  it("relabels the audit trail but keeps the command identifiers", () => {
    expect(COMMAND_LABELS["valueCase.createInheritedBusinessCase"]).toBe("Original Business Case started");
    expect(COMMAND_LABELS["valueCase.recordInheritedBusinessCase"]).toBe("Original Business Case recorded");
  });

  it("re-words rule messages from commands and database guards without changing the guards", () => {
    expect(presentRuleMessage("The inherited Business Case (V0) has no basis kind or Value Period")).toBe(
      "The Original Business Case has no basis kind or Value Period",
    );
    expect(presentRuleMessage("Only the inherited Business Case (V0) is recorded")).toBe(
      "Only the Original Business Case is recorded",
    );
    expect(presentRuleMessage("Before the Value Case is authorised, add drivers through Re-Qualification")).toBe(
      "Before the Value Case is authorised, add drivers through Value Case Definition",
    );
    expect(
      presentRuleMessage("recording V0 requires valueCase.recordInheritedBusinessCase (got valueCase.updateVersion)"),
    ).toBe(
      "recording the Original Business Case requires valueCase.recordInheritedBusinessCase (got valueCase.updateVersion)",
    );
    // The report keeps its name.
    expect(presentRuleMessage("the Re-Qualification Report covers the Re-Qualified Value Case (V1) only")).toBe(
      "the Re-Qualification Report covers the Value Case (V1) only",
    );
  });
});
