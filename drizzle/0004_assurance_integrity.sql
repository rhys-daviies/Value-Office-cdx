-- Value Assurance integrity (Phase 2).
--
--   assurance_review: draft -> finalised (immutable). Opened only against the
--   Authorised Value Case version in force; chained to the latest finalised
--   review; finalisation requires a Value Position for every driver in that
--   version. Value positions and review evidence links are editable only while
--   the review is draft. Nothing here touches Value Case versions.
--
-- Command names referenced here must match src/server/commands/names.ts.

-- ---------------------------------------------------------------------------
-- Audit capture for the new tables

CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON assurance_review
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row();
CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON value_position
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row();

-- ---------------------------------------------------------------------------
-- Review state machine

CREATE FUNCTION vo_assurance_review_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  actor uuid := vo_actor_id();
  v_status version_status;
  prev assurance_review;
  latest_finalised uuid;
  missing int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'finalised' THEN
      RAISE EXCEPTION 'VO_REVIEW_IMMUTABLE: finalised Assurance Review #% cannot be deleted', OLD.sequence;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'VO_REVIEW_INSERT_NOT_DRAFT: Assurance Reviews must be created as draft';
    END IF;
    IF NEW.created_by <> actor THEN
      RAISE EXCEPTION 'VO_ACTOR_MISMATCH: created_by must be the acting consultant';
    END IF;
    SELECT status INTO v_status FROM value_case_version WHERE id = NEW.against_version_id;
    IF v_status IS DISTINCT FROM 'authorised' THEN
      RAISE EXCEPTION 'VO_VERSION_NOT_AUTHORISED: an Assurance Review must be opened against the Authorised Value Case version in force (this version is %)', v_status;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'finalised' THEN
      RAISE EXCEPTION 'VO_REVIEW_IMMUTABLE: Assurance Review #% is finalised; corrections require a new review', OLD.sequence;
    END IF;

    IF NEW.status = 'finalised' THEN
      IF cmd <> 'assurance.finaliseReview' THEN
        RAISE EXCEPTION 'VO_WRONG_COMMAND: finalising requires assurance.finaliseReview (got %)', cmd;
      END IF;
      IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'finalised_by', 'finalised_at']) THEN
        RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: finalising may only change status and finalisation fields';
      END IF;
      IF NEW.finalised_by IS DISTINCT FROM actor THEN
        RAISE EXCEPTION 'VO_ACTOR_MISMATCH: finalised_by must be the acting consultant';
      END IF;
      SELECT status INTO v_status FROM value_case_version WHERE id = NEW.against_version_id;
      IF v_status IS DISTINCT FROM 'authorised' THEN
        RAISE EXCEPTION 'VO_VERSION_NOT_AUTHORISED: the version this review measures against is no longer the Authorised Value Case in force';
      END IF;
      SELECT count(*) INTO missing
      FROM value_driver_version d
      WHERE d.value_case_version_id = NEW.against_version_id
        AND NOT EXISTS (
          SELECT 1 FROM value_position p
          WHERE p.assurance_review_id = NEW.id AND p.value_driver_id = d.value_driver_id
        );
      IF missing > 0 THEN
        RAISE EXCEPTION 'VO_POSITIONS_INCOMPLETE: % Value Driver(s) in the authorised version have no Value Position in this review', missing;
      END IF;
      RETURN NEW;
    END IF;

    -- draft edits
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW),
         ARRAY['review_date', 'trigger', 'trigger_evidence_id', 'what_changed', 'why_it_matters', 'summary']) THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: only the date, trigger, trigger evidence and narratives are editable on a draft review';
    END IF;
  END IF;

  -- INSERT, and draft UPDATE: the chain of positions must stay linear and dated.
  IF NEW.previous_review_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM assurance_review r
      WHERE r.project_id = NEW.project_id AND r.status = 'finalised' AND r.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'VO_PREVIOUS_REVIEW_REQUIRED: a finalised review exists; this review must follow the latest finalised position';
    END IF;
  ELSE
    SELECT * INTO prev FROM assurance_review WHERE id = NEW.previous_review_id;
    IF prev.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'VO_PREVIOUS_OTHER_PROJECT: the previous review must belong to the same project';
    END IF;
    IF prev.status <> 'finalised' THEN
      RAISE EXCEPTION 'VO_PREVIOUS_NOT_FINALISED: the previous review must be finalised';
    END IF;
    IF prev.sequence >= NEW.sequence OR prev.review_date > NEW.review_date THEN
      RAISE EXCEPTION 'VO_REVIEW_ORDER: a review must come after its previous review (previous #% dated %)', prev.sequence, prev.review_date;
    END IF;
    IF TG_OP = 'INSERT' THEN
      SELECT r.id INTO latest_finalised FROM assurance_review r
      WHERE r.project_id = NEW.project_id AND r.status = 'finalised'
      ORDER BY r.sequence DESC LIMIT 1;
      IF latest_finalised IS DISTINCT FROM NEW.previous_review_id THEN
        RAISE EXCEPTION 'VO_PREVIOUS_NOT_LATEST: the previous review must be the latest finalised review';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_assurance_review_guard
  BEFORE INSERT OR UPDATE OR DELETE ON assurance_review
  FOR EACH ROW EXECUTE FUNCTION vo_assurance_review_guard();

-- ---------------------------------------------------------------------------
-- Value positions: draft reviews only; driver must be in the review's version.

CREATE FUNCTION vo_require_draft_review(review_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  s assurance_review_status;
  n int;
BEGIN
  SELECT status, sequence INTO s, n FROM assurance_review WHERE id = review_id;
  IF s IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'VO_REVIEW_IMMUTABLE: Assurance Review #% is % and its contents cannot be modified', n, s;
  END IF;
END $$;

CREATE FUNCTION vo_value_position_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM vo_require_draft_review(OLD.assurance_review_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM vo_require_draft_review(NEW.assurance_review_id);
    IF TG_OP = 'UPDATE' AND (NEW.assurance_review_id <> OLD.assurance_review_id OR NEW.value_driver_id <> OLD.value_driver_id) THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: a Value Position cannot move between reviews or drivers';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM value_driver_version d
      JOIN assurance_review r ON r.against_version_id = d.value_case_version_id
      WHERE r.id = NEW.assurance_review_id AND d.value_driver_id = NEW.value_driver_id
    ) THEN
      RAISE EXCEPTION 'VO_DRIVER_NOT_IN_VERSION: this Value Driver is not part of the authorised version the review measures against';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_value_position_guard
  BEFORE INSERT OR UPDATE OR DELETE ON value_position
  FOR EACH ROW EXECUTE FUNCTION vo_value_position_guard();

-- ---------------------------------------------------------------------------
-- Evidence links may now target a review (draft reviews only).

CREATE OR REPLACE FUNCTION vo_evidence_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: evidence links cannot be edited; delete and re-create while the target is draft';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.assurance_review_id IS NOT NULL THEN
      PERFORM vo_require_draft_review(OLD.assurance_review_id);
    ELSE
      PERFORM vo_require_draft_version(vo_evidence_link_version(OLD));
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.assurance_review_id IS NOT NULL THEN
    PERFORM vo_require_draft_review(NEW.assurance_review_id);
  ELSE
    PERFORM vo_require_draft_version(vo_evidence_link_version(NEW));
  END IF;
  RETURN NEW;
END $$;

-- Evidence relied on by a finalised review (linked or as its trigger) is frozen too.
CREATE OR REPLACE FUNCTION vo_evidence_is_locked(evidence_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM value_case_version v
    WHERE v.authorisation_evidence_id = vo_evidence_is_locked.evidence_id AND v.status <> 'draft'
  ) OR EXISTS (
    SELECT 1 FROM evidence_link l
    JOIN value_case_version v ON v.id = vo_evidence_link_version(l)
    WHERE l.evidence_id = vo_evidence_is_locked.evidence_id AND v.status <> 'draft'
  ) OR EXISTS (
    SELECT 1 FROM evidence_link l
    JOIN assurance_review r ON r.id = l.assurance_review_id
    WHERE l.evidence_id = vo_evidence_is_locked.evidence_id AND r.status = 'finalised'
  ) OR EXISTS (
    SELECT 1 FROM assurance_review r
    WHERE r.trigger_evidence_id = vo_evidence_is_locked.evidence_id AND r.status = 'finalised'
  )
$$;
