// Primary Value Trajectory series identity (Phase 4D.9E), shared by the server legend and the client chart. Colours
// follow the Evolution palette for the same concepts; every series also has its own line style and mark (plan:
// dashed + hollow circle, realised: solid + square, forecast: dotted + filled circle), so colour is never the only cue.
export const TRAJECTORY_SERIES = {
  plan: { label: "Authorised Plan", color: "#2563eb" },
  realised: { label: "Realised", color: "#65a30d" },
  forecast: { label: "Formal Forecast", color: "#0891b2" },
} as const;

/** Alternative Value Trajectories option styles by position in the semantic order (Phase 4D.9F; shared with reports). Distinguished by dash and marker as well as colour. */
export const OPTION_STYLES = [
  { color: "#1d4ed8", dash: undefined, marker: "circle" },
  { color: "#0f766e", dash: "8 4", marker: "diamond" },
  { color: "#7c3aed", dash: "2 4", marker: "triangle" },
  { color: "#b45309", dash: "10 3 2 3", marker: "square" },
  { color: "#334155", dash: "5 3", marker: "circle" },
] as const;
export type OptionMarker = (typeof OPTION_STYLES)[number]["marker"];
