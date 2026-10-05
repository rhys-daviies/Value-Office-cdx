-- Phase 4D.10H integrity: Value Case impact of a management decision, and review finalisation vs the recommendation
-- lifecycle (contract: docs/architecture.md, "Value Change determination").
--
-- * After a management decision the consultant determines, once and with a rationale, whether the Authorised Value
--   Case must change: no_value_change_required or value_change_proposed. Insert-only; written only by its command.
--   Neither answer writes to the Value Case, its versions, positions, leakage or the decision.
-- * A Value Change that cites a decision (value_change.decision_id) requires that decision's determination to be
--   value_change_proposed. The determination never creates the Value Change; Value Changes without a decision
--   (existing ad hoc route) are unaffected. Existing Value Changes are never re-checked.
-- * A review cannot be finalised while its recommendation is in internal review or ready to issue (an incomplete
--   governed recommendation process). No recommendation, draft, returned and issued keep the existing behaviour.
-- * Prospective only; nothing is backfilled. Historical decisions without a determination stay valid.
-- * New functions and triggers only; new BEFORE triggers are named to fire after the existing guards.

CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON value_change_determination
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row();

CREATE FUNCTION vo_value_change_determination_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'VO_DETERMINATION_IMMUTABLE: a Value Case impact determination is permanent';
  END IF;
  IF vo_command() IS DISTINCT FROM 'valueChange.determineImpact' THEN
    RAISE EXCEPTION 'VO_WRONG_COMMAND: a Value Case impact determination is recorded only by valueChange.determineImpact (got %)', vo_command();
  END IF;
  IF NEW.created_by IS DISTINCT FROM vo_actor_id() THEN
    RAISE EXCEPTION 'VO_ACTOR_MISMATCH: created_by must be the acting consultant';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_value_change_determination_guard
  BEFORE INSERT OR UPDATE OR DELETE ON value_change_determination
  FOR EACH ROW EXECUTE FUNCTION vo_value_change_determination_guard();

-- A decision-linked Value Change follows a Value Change Proposed determination. Fires after vo_value_change_guard.
CREATE FUNCTION vo_value_change_impact_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d value_change_determination_kind;
BEGIN
  IF NEW.decision_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.decision_id IS NOT DISTINCT FROM OLD.decision_id) THEN
    RETURN NEW;
  END IF;
  SELECT determination INTO d FROM value_change_determination WHERE decision_id = NEW.decision_id;
  IF d IS NULL THEN
    RAISE EXCEPTION 'VO_DETERMINATION_REQUIRED: determine the Value Case impact of the decision (Value Change Proposed) before preparing a Value Change from it';
  END IF;
  IF d <> 'value_change_proposed' THEN
    RAISE EXCEPTION 'VO_NO_VALUE_CHANGE_DETERMINED: this decision was determined to need no Value Change';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_value_change_impact_gate
  BEFORE INSERT OR UPDATE ON value_change
  FOR EACH ROW EXECUTE FUNCTION vo_value_change_impact_gate();

-- Review finalisation: not while the recommendation is in internal review or ready to issue.
CREATE FUNCTION vo_review_recommendation_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'finalised' AND vo_recommendation_in_review(NEW.id) THEN
    RAISE EXCEPTION 'VO_RECOMMENDATION_REVIEW_INCOMPLETE: complete the internal recommendation review (issue it, or return it for revision) before finalising the review';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_review_recommendation_gate
  BEFORE UPDATE ON assurance_review
  FOR EACH ROW EXECUTE FUNCTION vo_review_recommendation_gate();
