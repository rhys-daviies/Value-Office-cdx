// Formal Forecast connectors (Phase 4D.5 refinement, PMO decision in 4D.6): consecutive forecast
// observations are connected only while they were measured against the same Authorised Value Case
// version. A change of version breaks the connector; every point still keeps its own marker.
// Realised Value is cumulative achievement and is not broken by a version change.

export type ForecastObservation = { key: string; forecast: string | null; againstVersionNumber: number | null };

/** Runs of consecutive forecast points measured against one version (keys in event order). */
export function forecastConnectorRuns(points: readonly ForecastObservation[]): string[][] {
  const runs: { version: number; keys: string[] }[] = [];
  for (const p of points) {
    if (p.forecast === null || p.againstVersionNumber === null) continue;
    const last = runs.at(-1);
    if (last && last.version === p.againstVersionNumber) last.keys.push(p.key);
    else runs.push({ version: p.againstVersionNumber, keys: [p.key] });
  }
  return runs.map((r) => r.keys);
}
