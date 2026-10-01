import { SERIES } from "../evolution/series";

// Alternative Value Outcomes marks (Phase 4D.6), shared by the server legend and the client chart.
// References keep their Value Case Evolution colours (same meaning); stored scenario outcomes share one
// neutral colour — roles are carried by shape and words, never by a "good/bad" colour.
export const REFERENCE_COLORS = {
  authorised: SERIES.authorised.color,
  forecast: SERIES.forecast.color,
} as const;

export const OUTCOME_COLOR = "#334155";
