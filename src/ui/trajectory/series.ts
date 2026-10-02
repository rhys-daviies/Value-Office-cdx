// Primary Value Trajectory series identity (Phase 4D.9E), shared by the server legend and the client chart. Colours
// follow the Evolution palette for the same concepts; every series also has its own line style and mark (plan:
// dashed + hollow circle, realised: solid + square, forecast: dotted + filled circle), so colour is never the only cue.
export const TRAJECTORY_SERIES = {
  plan: { label: "Authorised Plan", color: "#2563eb" },
  realised: { label: "Realised", color: "#65a30d" },
  forecast: { label: "Formal Forecast", color: "#0891b2" },
} as const;
