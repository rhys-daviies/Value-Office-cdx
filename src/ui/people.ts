// Named accountability (Phase 4D.13): an owner is a PERSON; their engagement role says why they are accountable.
// Owner pickers and owner displays read "Person name — Role on this engagement" (the role only when recorded).

/** "Jane Smith — Risk / Leakage Owner"; just the name when no role is recorded. */
export function personWithRole(name: string, role?: string | null): string {
  const r = role?.trim();
  return r ? `${name} — ${r}` : name;
}

/** Select options for an owner picker: the stakeholder's person id, labelled "name — role". */
export function ownerOptions(
  stakeholders: readonly { personId: string; name: string; roleDescription?: string | null }[],
) {
  return stakeholders.map((s) => ({ value: s.personId, label: personWithRole(s.name, s.roleDescription) }));
}
