import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PositionTotals } from "@/domain/assurance";
import { GovernedPosition } from "@/ui/assurance/picture";

// Phase 4D.8A release fix: after a Value Change, the latest formal position may have been measured against
// an older version. Its Value Gap keeps that basis (never recomputed) and the panel says so.

const totals = (authorisedTotal: string): PositionTotals => ({
  financialDriverCount: 2,
  authorisedTotal,
  previousTotal: null,
  forecastAssessed: 2,
  forecastTotal: "1400000.00",
  realisedAssessed: 1,
  realisedAttributedTotal: "100000.00",
  unattributedRealised: null,
  realisedTotal: "100000.00",
  valueGap: "100000.00",
  movement: "-100000.00",
  forecastBlockers: [],
});

const render = (props: Partial<Parameters<typeof GovernedPosition>[0]>) =>
  renderToStaticMarkup(
    createElement(GovernedPosition, {
      authorisedVersion: 2,
      authorisedTotal: "1400000.00",
      totals: totals("1500000.00"),
      reviewSequence: 1,
      againstVersion: 1,
      currency: "USD",
      prefix: "overview",
      ...props,
    }),
  ).replace(/<[^>]+>/g, " ");

describe("GovernedPosition basis", () => {
  it("labels a latest review measured against an older version, keeping its own Value Gap", () => {
    const text = render({});
    expect(text).toContain("Review #1 vs V1");
    expect(text).toContain("Review #1 vs Authorised V1 ($1.5m) · no formal review against V2 yet");
    expect(text).toContain("$0.1m"); // the review's governed gap, not recomputed against V2
  });

  it("is unchanged when the latest review measured the version in force", () => {
    const text = render({ authorisedVersion: 1, authorisedTotal: "1500000.00", againstVersion: 1 });
    expect(text).not.toContain("vs V1");
    expect(text).toContain("Authorised − Forecast · movement");
  });
});
