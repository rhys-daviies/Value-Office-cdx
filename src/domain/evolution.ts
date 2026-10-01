// Value Case Evolution (Phase 4D.5): ordering of governed events. Pure; no dates are invented.
//
// Two governed histories are merged into one sequence:
//   - Value Case authorisations (V1, V2, …), already ordered by version number;
//   - finalised Assurance Reviews, already ordered by sequence.
// A review always follows the authorisation of the version it was measured against. A review
// measured against an older version (opened before a Value Change was authorised) is placed by
// date: on or before the newer authorisation date it precedes it, after that date it follows it.
// The Original Business Case has no governed date and is always the starting reference point.

export type AuthorisationKey = { versionNumber: number; date: string | null };
export type ReviewKey = { againstVersionNumber: number; date: string };

export type Ordered<A, R> = { kind: "authorisation"; item: A } | { kind: "review"; item: R };

export function orderEvolutionEvents<A extends AuthorisationKey, R extends ReviewKey>(
  authorisations: readonly A[],
  reviews: readonly R[],
): Ordered<A, R>[] {
  const out: Ordered<A, R>[] = [];
  let i = 0;
  let j = 0;
  while (i < authorisations.length || j < reviews.length) {
    const a = authorisations[i];
    const r = reviews[j];
    if (a && (!r || authorisationFirst(a, r))) {
      out.push({ kind: "authorisation", item: a });
      i++;
    } else {
      out.push({ kind: "review", item: r! });
      j++;
    }
  }
  return out;
}

function authorisationFirst(a: AuthorisationKey, r: ReviewKey): boolean {
  // The review was measured against this version (or a later one): the authorisation came first.
  if (r.againstVersionNumber >= a.versionNumber) return true;
  // The review was measured against an older version: place it by its date.
  if (a.date === null) return false;
  return r.date > a.date;
}
