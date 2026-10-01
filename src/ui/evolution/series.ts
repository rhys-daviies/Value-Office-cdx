// Value Case Evolution series identity (Phase 4D.5), shared by the server legend and the client chart.
// Palette validated for lightness, chroma, colour-vision separation and contrast; each series also has
// its own mark (diamond, step line, circle, square), so colour is never the only signal.
export const SERIES = {
  original: { label: "Original Business Case", color: "#c2410c" },
  authorised: { label: "Authorised Value", color: "#2563eb" },
  forecast: { label: "Formal Forecast", color: "#0891b2" },
  realised: { label: "Realised Value", color: "#65a30d" },
} as const;
