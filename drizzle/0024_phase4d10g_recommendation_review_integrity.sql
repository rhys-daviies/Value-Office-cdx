-- Phase 4D.10G integrity: internal Cardaxia review of a recommendation before it is issued to management
-- (contract: docs/architecture.md, "Recommendation internal review").
--
--   draft (null) --submit--> in_internal_review --approve--> ready_to_issue --issue--> issued (issued_at)
--   returned     --submit--> in_internal_review
--   in_internal_review | ready_to_issue --return (feedback required)--> returned
--
-- * The reviewer is internal Cardaxia, not the client VCO. The acting user of each step is recorded; the pilot's auth
--   model cannot yet separate author and reviewer, so no separation of duties is enforced.
-- * Every review step writes an insert-only recommendation_review_event in the same transaction as the state change,
--   so all return feedback across cycles is kept.
-- * While in_internal_review or ready_to_issue the recommendation, its options and their option paths are read-only.
--   This is not the permanent freeze: returning makes them editable again. Issue remains the permanent freeze.
-- * Prospective only: recommendations issued before this phase keep internal_review_status null and stay valid; an
--   unissued recommendation (null = draft) must pass internal review before it is issued. Nothing is backfilled.
-- * Every function and trigger here is new; no existing guard is replaced. New BEFORE triggers are named to fire after
--   the existing guards on the same table (alphabetical order), so existing errors report first.

CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON recommendation_review_event
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row();

-- ---------------------------------------------------------------------------
-- Review history: insert-only, by its commands, valid from the recommendation's current state.

CREATE FUNCTION vo_recommendation_review_event_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  rec recommendation;
  st text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'VO_REVIEW_HISTORY_IMMUTABLE: internal review history is permanent';
  END IF;
  IF NEW.created_by IS DISTINCT FROM vo_actor_id() THEN
    RAISE EXCEPTION 'VO_ACTOR_MISMATCH: created_by must be the acting user';
  END IF;
  IF NOT ((NEW.kind = 'submitted' AND cmd = 'options.submitRecommendation')
       OR (NEW.kind = 'returned' AND cmd = 'options.returnRecommendation')
       OR (NEW.kind = 'approved' AND cmd = 'options.approveRecommendation')) THEN
    RAISE EXCEPTION 'VO_WRONG_COMMAND: internal review history is written only by its commands (got %)', cmd;
  END IF;
  SELECT * INTO rec FROM recommendation WHERE id = NEW.recommendation_id;
  IF rec.issued_at IS NOT NULL THEN
    RAISE EXCEPTION 'VO_RECOMMENDATION_ISSUED: an issued recommendation is permanent';
  END IF;
  PERFORM vo_require_draft_review(rec.assurance_review_id);
  -- Compared as text with draft for null: a null status must never make the check itself null.
  st := coalesce(rec.internal_review_status::text, 'draft');
  IF NOT ((NEW.kind = 'submitted' AND st IN ('draft', 'returned'))
       OR (NEW.kind = 'returned' AND st IN ('in_internal_review', 'ready_to_issue'))
       OR (NEW.kind = 'approved' AND st = 'in_internal_review')) THEN
    RAISE EXCEPTION 'VO_INVALID_TRANSITION: cannot record % while the recommendation is %', NEW.kind, st;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_recommendation_review_event_guard
  BEFORE INSERT OR UPDATE OR DELETE ON recommendation_review_event
  FOR EACH ROW EXECUTE FUNCTION vo_recommendation_review_event_guard();

-- ---------------------------------------------------------------------------
-- Recommendation: transitions, issue gate and read-only review states. Fires after vo_recommendation_guard (which
-- keeps rejecting any change to an issued recommendation) and before vo_recommendation_trajectory_gate.

CREATE FUNCTION vo_recommendation_review_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  expected text;
  expected_cmd text;
  old_st text;
  sid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.internal_review_status IS NOT NULL THEN
      RAISE EXCEPTION 'VO_RECOMMENDATION_INSERT: a recommendation starts as a draft';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF coalesce(OLD.internal_review_status::text, 'draft') IN ('in_internal_review', 'ready_to_issue') THEN
      RAISE EXCEPTION 'VO_RECOMMENDATION_IN_REVIEW: return the recommendation for revision before removing it';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.internal_review_status IS DISTINCT FROM OLD.internal_review_status THEN
    expected := CASE NEW.internal_review_status
      WHEN 'in_internal_review' THEN 'submitted'
      WHEN 'returned' THEN 'returned'
      WHEN 'ready_to_issue' THEN 'approved'
    END;
    IF expected IS NULL THEN
      RAISE EXCEPTION 'VO_INVALID_TRANSITION: a recommendation never goes back to draft; return it for revision instead';
    END IF;
    expected_cmd := CASE expected
      WHEN 'submitted' THEN 'options.submitRecommendation'
      WHEN 'returned' THEN 'options.returnRecommendation'
      ELSE 'options.approveRecommendation'
    END;
    IF cmd IS DISTINCT FROM expected_cmd THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: internal review state changes only through its commands (got %)', cmd;
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['internal_review_status']) THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: an internal review step changes only the review state';
    END IF;
    old_st := coalesce(OLD.internal_review_status::text, 'draft');
    IF NOT ((NEW.internal_review_status = 'in_internal_review' AND old_st IN ('draft', 'returned'))
         OR (NEW.internal_review_status = 'returned' AND old_st IN ('in_internal_review', 'ready_to_issue'))
         OR (NEW.internal_review_status = 'ready_to_issue' AND old_st = 'in_internal_review')) THEN
      RAISE EXCEPTION 'VO_INVALID_TRANSITION: % cannot move to %', old_st, NEW.internal_review_status;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM recommendation_review_event e
                    WHERE e.recommendation_id = NEW.id AND e.kind::text = expected
                      AND e.created_at = now() AND e.created_by = vo_actor_id()) THEN
      RAISE EXCEPTION 'VO_REVIEW_EVENT_REQUIRED: each internal review step is recorded in its history';
    END IF;
    -- Submission: the options must already meet the economics that issue will require (paths reconcile to totals).
    IF NEW.internal_review_status = 'in_internal_review' THEN
      FOR sid IN SELECT id FROM scenario WHERE assurance_review_id = NEW.assurance_review_id LOOP
        PERFORM vo_scenario_trajectory_check(sid);
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.issued_at IS NULL AND NEW.issued_at IS NOT NULL THEN
    IF OLD.internal_review_status IS DISTINCT FROM 'ready_to_issue' THEN
      RAISE EXCEPTION 'VO_INTERNAL_REVIEW_REQUIRED: complete Internal Cardaxia Review (Ready to Issue) before issuing to management';
    END IF;
    RETURN NEW;
  END IF;

  IF coalesce(OLD.internal_review_status::text, 'draft') IN ('in_internal_review', 'ready_to_issue') THEN
    RAISE EXCEPTION 'VO_RECOMMENDATION_IN_REVIEW: the recommendation is read-only while in internal review or ready to issue; return it for revision to change it';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_recommendation_review_guard
  BEFORE INSERT OR UPDATE OR DELETE ON recommendation
  FOR EACH ROW EXECUTE FUNCTION vo_recommendation_review_guard();

-- ---------------------------------------------------------------------------
-- Options and option paths are read-only while the recommendation is in review or ready to issue.

CREATE FUNCTION vo_recommendation_in_review(review_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM recommendation r
    WHERE r.assurance_review_id = vo_recommendation_in_review.review_id
      AND r.issued_at IS NULL
      AND r.internal_review_status IN ('in_internal_review', 'ready_to_issue')
  )
$$;

CREATE FUNCTION vo_scenario_review_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF vo_recommendation_in_review(CASE WHEN TG_OP = 'DELETE' THEN OLD.assurance_review_id ELSE NEW.assurance_review_id END) THEN
    RAISE EXCEPTION 'VO_RECOMMENDATION_IN_REVIEW: options are read-only while the recommendation is in internal review or ready to issue; return it for revision to change them';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_scenario_review_gate
  BEFORE INSERT OR UPDATE OR DELETE ON scenario
  FOR EACH ROW EXECUTE FUNCTION vo_scenario_review_gate();

CREATE FUNCTION vo_value_trajectory_point_review_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.scenario_id ELSE NEW.scenario_id END;
BEGIN
  IF sid IS NOT NULL AND vo_recommendation_in_review((SELECT assurance_review_id FROM scenario WHERE id = sid)) THEN
    RAISE EXCEPTION 'VO_RECOMMENDATION_IN_REVIEW: option paths are read-only while the recommendation is in internal review or ready to issue; return it for revision to change them';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_value_trajectory_point_review_gate
  BEFORE INSERT OR UPDATE OR DELETE ON value_trajectory_point
  FOR EACH ROW EXECUTE FUNCTION vo_value_trajectory_point_review_gate();
