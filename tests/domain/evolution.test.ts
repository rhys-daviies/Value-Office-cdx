import { describe, expect, it } from "vitest";

import { orderEvolutionEvents } from "@/domain/evolution";
import { forecastConnectorRuns } from "@/ui/evolution/segments";

// Phase 4D.5: merging authorisations and finalised reviews into one governed order, without dates
// being invented or reviews being reassigned to another version.

const v = (versionNumber: number, date: string | null) => ({ versionNumber, date, id: `V${versionNumber}` });
const r = (sequence: number, againstVersionNumber: number, date: string) => ({
  againstVersionNumber,
  date,
  id: `R${sequence}`,
});
const ids = (events: readonly { item: { id: string } }[]) => events.map((e) => e.item.id);

describe("orderEvolutionEvents", () => {
  it("places reviews after the authorisation of the version they measured", () => {
    const out = orderEvolutionEvents(
      [v(1, "2026-01-15"), v(2, "2026-07-15")],
      [r(1, 1, "2026-03-31"), r(2, 1, "2026-06-30"), r(3, 2, "2026-09-30")],
    );
    expect(ids(out)).toEqual(["V1", "R1", "R2", "V2", "R3"]);
  });

  it("keeps a same-day review measured against the new version after its authorisation", () => {
    expect(ids(orderEvolutionEvents([v(1, "2026-01-01")], [r(1, 1, "2026-01-01")]))).toEqual(["V1", "R1"]);
  });

  it("places a review measured against an older version by its date, never reassigning it", () => {
    // Dated on or before V2's authorisation: precedes it.
    expect(ids(orderEvolutionEvents([v(1, "2026-01-01"), v(2, "2026-05-01")], [r(1, 1, "2026-05-01")]))).toEqual([
      "V1",
      "R1",
      "V2",
    ]);
    // Dated after V2's authorisation (opened before the Value Change, finalised later): follows it.
    const out = orderEvolutionEvents([v(1, "2026-01-01"), v(2, "2026-05-01")], [r(1, 1, "2026-05-20")]);
    expect(ids(out)).toEqual(["V1", "V2", "R1"]);
    expect(out[2]!.kind === "review" && out[2]!.item.againstVersionNumber).toBe(1);
  });

  it("does not invent a date for an authorisation without one", () => {
    expect(ids(orderEvolutionEvents([v(1, "2026-01-01"), v(2, null)], [r(1, 1, "2026-05-20")]))).toEqual([
      "V1",
      "R1",
      "V2",
    ]);
  });

  it("handles no reviews and no authorisations", () => {
    expect(ids(orderEvolutionEvents([v(1, "2026-01-01")], []))).toEqual(["V1"]);
    expect(orderEvolutionEvents([], [])).toEqual([]);
  });
});

describe("forecastConnectorRuns (4D.5 refinement)", () => {
  const p = (key: string, forecast: string | null, againstVersionNumber: number | null) => ({
    key,
    forecast,
    againstVersionNumber,
  });

  it("connects forecasts measured against the same version and breaks when the version changes", () => {
    const events = [
      p("original", null, null),
      p("v1", null, null),
      p("r1", "1400000.00", 1),
      p("r2", "1300000.00", 1),
      p("v2", null, null),
      p("r3", "1200000.00", 2),
    ];
    expect(forecastConnectorRuns(events)).toEqual([["r1", "r2"], ["r3"]]);
  });

  it("skips incomplete forecasts without inventing a connection, and keeps every point", () => {
    expect(forecastConnectorRuns([p("r1", "1.00", 1), p("r2", null, 1), p("r3", "2.00", 1)])).toEqual([["r1", "r3"]]);
    // A later return to an older version starts a new run rather than reconnecting.
    expect(forecastConnectorRuns([p("r1", "1.00", 1), p("r2", "2.00", 2), p("r3", "3.00", 1)])).toEqual([
      ["r1"],
      ["r2"],
      ["r3"],
    ]);
  });
});
