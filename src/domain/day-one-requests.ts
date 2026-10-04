// Day-1 Information Request suggestions (Phase 4D.10C). Optional starter items a consultant may select when creating the
// Mobilisation request; each becomes an ordinary, editable Information Request item through the normal command. They
// are not a methodology requirement and nothing about them is stored — change the list here.
export const DAY_ONE_SUGGESTIONS = [
  { key: "business-case", description: "Existing Business Case" },
  { key: "financial-model", description: "Business Case financial model" },
  { key: "benefits-model", description: "Existing benefits / value-driver model" },
  { key: "programme-plan", description: "Programme / project plan" },
  { key: "baseline-evidence", description: "Baseline performance evidence" },
] as const;

export type DayOneSuggestionKey = (typeof DAY_ONE_SUGGESTIONS)[number]["key"];

const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The selected suggestions in list order, ignoring unknown keys and any already on the request. */
export function selectedSuggestions(keys: readonly string[], existingDescriptions: readonly string[] = []): string[] {
  const existing = new Set(existingDescriptions.map(normalise));
  return DAY_ONE_SUGGESTIONS.filter((s) => keys.includes(s.key) && !existing.has(normalise(s.description))).map(
    (s) => s.description,
  );
}

/** Additional free-text items, one per line, blanks and repeats removed. */
export function additionalItems(text: string | undefined, alreadyIncluded: readonly string[] = []): string[] {
  const seen = new Set(alreadyIncluded.map(normalise));
  const out: string[] = [];
  for (const line of (text ?? "").split("\n")) {
    const d = line.trim();
    if (d && !seen.has(normalise(d))) {
      seen.add(normalise(d));
      out.push(d);
    }
  }
  return out;
}

export function remainingSuggestions(existingDescriptions: readonly string[]) {
  const existing = new Set(existingDescriptions.map(normalise));
  return DAY_ONE_SUGGESTIONS.filter((s) => !existing.has(normalise(s.description)));
}
