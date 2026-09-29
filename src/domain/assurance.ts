import { money, sumMoney, toDbMoney } from "./money";
import type { EvidenceStatus, QualificationStatus } from "./statuses";

// Value Position calculations (PMO Phase 2 methodology rules). Pure and
// Decimal-only. Nothing here is stored: gap and movement are always derived.
//
//   Value Gap        = Authorised Value − Current Forecast            (financial drivers)
//   Movement, first  = Current Forecast − Authorised Value
//   Movement, later  = Current Forecast − previous finalised review's Current Forecast
//   Project figures  = sums over financial drivers; non-financial drivers are excluded.
//
// A total is only reported when every financial driver has been assessed —
// otherwise it is null ("incomplete") rather than a misleading partial sum.
// Realised Value is the exception: it is cumulative-to-date and may legitimately
// be assessed for only some drivers, so its sum is reported with a coverage count.
// Project Realised Value = attributed per-driver realised + review-level
// unattributed realised (an explicitly labelled aggregate never assigned to a driver).

export type DriverBasis = {
  valueDriverId: string;
  code: string;
  name: string;
  /** Authorised financial value; null means a non-financial driver. */
  authorisedValue: string | null;
  qualificationStatus: QualificationStatus;
  evidenceStatus: EvidenceStatus;
};

export type PositionValues = {
  valueDriverId: string;
  currentForecast: string | null;
  realisedValue: string | null;
  /** Explicit "Not Assessed" (with rationale) rather than a blank forecast. */
  forecastNotAssessed?: boolean;
};

/** What movement is measured against. */
export type PriorPosition =
  { kind: "authorised" } | { kind: "review"; reviewId: string; sequence: number; positions: readonly PositionValues[] };

export type DriverPositionRow = DriverBasis & {
  financial: boolean;
  hasPosition: boolean;
  forecastNotAssessed: boolean;
  /** Authorised Value (first review) or the previous review's forecast (later reviews). */
  previousForecast: string | null;
  currentForecast: string | null;
  realisedValue: string | null;
  valueGap: string | null;
  movement: string | null;
};

export type PositionTotals = {
  financialDriverCount: number;
  authorisedTotal: string;
  previousTotal: string | null;
  forecastAssessed: number;
  forecastTotal: string | null;
  realisedAssessed: number;
  /** Sum of per-driver realised values (null when none is assessed). */
  realisedAttributedTotal: string | null;
  /** Review-level realised value not attributed to any driver (null when none). */
  unattributedRealised: string | null;
  /** Attributed + unattributed (null when neither exists). */
  realisedTotal: string | null;
  valueGap: string | null;
  movement: string | null;
  /** Financial drivers that prevent a complete project forecast (blank or Not Assessed). */
  forecastBlockers: { code: string; name: string; notAssessed: boolean }[];
};

const diff = (a: string, b: string) => toDbMoney(money(a).minus(money(b)));

export function computeValuePosition(
  drivers: readonly DriverBasis[],
  positions: readonly PositionValues[],
  prior: PriorPosition,
  opts: { unattributedRealised?: string | null } = {},
): { rows: DriverPositionRow[]; totals: PositionTotals } {
  const rows = drivers.map((d): DriverPositionRow => {
    const p = positions.find((x) => x.valueDriverId === d.valueDriverId);
    const financial = d.authorisedValue !== null;
    const currentForecast = p?.currentForecast ?? null;
    const previousForecast =
      prior.kind === "authorised"
        ? d.authorisedValue
        : (prior.positions.find((x) => x.valueDriverId === d.valueDriverId)?.currentForecast ?? null);
    return {
      ...d,
      financial,
      hasPosition: Boolean(p),
      forecastNotAssessed: p?.forecastNotAssessed ?? false,
      previousForecast,
      currentForecast,
      realisedValue: p?.realisedValue ?? null,
      valueGap: financial && currentForecast !== null ? diff(d.authorisedValue!, currentForecast) : null,
      movement:
        financial && currentForecast !== null && previousForecast !== null
          ? diff(currentForecast, previousForecast)
          : null,
    };
  });

  const financialRows = rows.filter((r) => r.financial);
  const allDefined = (pick: (r: DriverPositionRow) => string | null) =>
    financialRows.every((r) => pick(r) !== null) ? toDbMoney(sumMoney(financialRows.map((r) => pick(r)!))) : null;

  const forecastTotal = allDefined((r) => r.currentForecast);
  const authorisedTotal = toDbMoney(sumMoney(financialRows.map((r) => r.authorisedValue!)));
  const realised = financialRows.flatMap((r) => (r.realisedValue === null ? [] : [r.realisedValue]));
  const attributed = realised.length > 0 ? toDbMoney(sumMoney(realised)) : null;
  const unattributed = opts.unattributedRealised ?? null;
  const realisedTotal =
    attributed === null && unattributed === null ? null : toDbMoney(sumMoney([attributed ?? "0", unattributed ?? "0"]));

  return {
    rows,
    totals: {
      financialDriverCount: financialRows.length,
      authorisedTotal,
      previousTotal: allDefined((r) => r.previousForecast),
      forecastAssessed: financialRows.filter((r) => r.currentForecast !== null).length,
      forecastTotal,
      realisedAssessed: realised.length,
      realisedAttributedTotal: attributed,
      unattributedRealised: unattributed,
      realisedTotal,
      valueGap: forecastTotal === null ? null : diff(authorisedTotal, forecastTotal),
      movement: allDefined((r) => r.movement),
      forecastBlockers: financialRows
        .filter((r) => r.currentForecast === null)
        .map((r) => ({ code: r.code, name: r.name, notAssessed: r.forecastNotAssessed })),
    },
  };
}
