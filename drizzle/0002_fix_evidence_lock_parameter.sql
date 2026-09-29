-- Fix: in vo_evidence_is_locked the unqualified parameter `evidence_id` was
-- shadowed by the evidence_link.evidence_id column (SQL-language functions give
-- columns precedence), so `l.evidence_id = evidence_id` compared the column with
-- itself. Any evidence link to any non-draft version therefore locked *all*
-- evidence, in every project. Qualifying the parameter restores the documented
-- rule: evidence is locked only when *it* is relied on by a non-draft version.

CREATE OR REPLACE FUNCTION vo_evidence_is_locked(evidence_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM value_case_version v
    WHERE v.authorisation_evidence_id = vo_evidence_is_locked.evidence_id AND v.status <> 'draft'
  ) OR EXISTS (
    SELECT 1 FROM evidence_link l
    JOIN value_case_version v ON v.id = vo_evidence_link_version(l)
    WHERE l.evidence_id = vo_evidence_is_locked.evidence_id AND v.status <> 'draft'
  )
$$;
