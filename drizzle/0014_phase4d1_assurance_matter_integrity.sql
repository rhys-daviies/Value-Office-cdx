-- Phase 4D.1 integrity: Continuous Assurance matters (value_leakage) and formal snapshots.
--
-- * A matter can be raised outside a review (matter.create, identified_on) and worked on while open:
--   stage (free movement, matter.setStage), Risk / Leakage Owner (matter.setOwner or leakage.update),
--   working assessment (matter.assessWorking only; attributed to the acting consultant at now()),
--   remediation / monitor-until (matter.setRemediation). Resolved = matter.close with a closure note;
--   matter.reopen reopens. Code, origin and creator stay immutable; matters are never deleted.
-- * leakage_assessment keeps its meaning — the matter's formal position in one review — and gains
--   snapshot_* columns written only by assurance.finaliseReview. Finalisation may never invent
--   formal amounts: an unsnapshotted, unassessed matter is snapshotted as not yet quantified (null).
-- * Finalising a review requires a snapshot of every open matter and of every matter assessed in it.
-- Working figures never reach leakage_assessment: no command copies them, and the guards below
-- only let reviews' own assessment command set formal amounts.

-- ---------------------------------------------------------------------------
-- Assurance matter (value_leakage)

CREATE OR REPLACE FUNCTION vo_value_leakage_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  actor uuid := vo_actor_id();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: Value Leakage items are never deleted; close them instead';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by <> actor THEN
      RAISE EXCEPTION 'VO_ACTOR_MISMATCH: created_by must be the acting consultant';
    END IF;
    IF NEW.status <> 'open' OR NEW.closure_note IS NOT NULL THEN
      RAISE EXCEPTION 'VO_INVALID_INPUT: a new Assurance matter is open';
    END IF;
    IF NEW.working_total_amount IS NOT NULL OR NEW.working_unrecoverable_amount IS NOT NULL
       OR NEW.working_assessed_by IS NOT NULL OR NEW.working_assessed_at IS NOT NULL THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: working assessments are recorded only by matter.assessWorking';
    END IF;
    IF NEW.identified_in_review_id IS NULL AND cmd <> 'matter.create' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: matters raised outside a review use matter.create (got %)', cmd;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF (NEW.project_id, NEW.value_case_id, NEW.code, NEW.identified_in_review_id, NEW.identified_on, NEW.created_by)
     IS DISTINCT FROM (OLD.project_id, OLD.value_case_id, OLD.code, OLD.identified_in_review_id, OLD.identified_on, OLD.created_by) THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: a leakage item''s code and origin cannot change';
  END IF;

  -- Lifecycle: resolved = closed with a note (matter.close); reopening is explicit (matter.reopen).
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'closed' THEN
      IF cmd <> 'matter.close' THEN
        RAISE EXCEPTION 'VO_WRONG_COMMAND: close an Assurance matter with matter.close (got %)', cmd;
      END IF;
      IF NEW.closure_note IS NULL OR length(trim(NEW.closure_note)) = 0 THEN
        RAISE EXCEPTION 'VO_CLOSURE_NOTE_REQUIRED: closing an Assurance matter requires a closure note';
      END IF;
    ELSIF cmd <> 'matter.reopen' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: reopen an Assurance matter with matter.reopen (got %)', cmd;
    END IF;
  ELSIF NEW.closure_note IS DISTINCT FROM OLD.closure_note THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: the closure note is recorded when the matter is closed';
  END IF;

  -- Working stage: open matters only, via matter.setStage.
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF cmd <> 'matter.setStage' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: the working stage changes only via matter.setStage (got %)', cmd;
    END IF;
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'VO_MATTER_CLOSED: a closed matter has no working stage';
    END IF;
  END IF;

  -- Working assessment: open matters only, via matter.assessWorking, attributed by the database.
  IF (NEW.working_total_amount, NEW.working_unrecoverable_amount, NEW.working_unrecoverable_rationale)
     IS DISTINCT FROM (OLD.working_total_amount, OLD.working_unrecoverable_amount, OLD.working_unrecoverable_rationale) THEN
    IF cmd <> 'matter.assessWorking' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: working assessments are recorded only by matter.assessWorking (got %)', cmd;
    END IF;
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'VO_MATTER_CLOSED: a closed matter cannot be reassessed';
    END IF;
    IF NEW.working_total_amount IS NULL THEN
      NEW.working_assessed_by := NULL;
      NEW.working_assessed_at := NULL;
    ELSE
      NEW.working_assessed_by := actor;
      NEW.working_assessed_at := now();
    END IF;
  ELSIF (NEW.working_assessed_by, NEW.working_assessed_at) IS DISTINCT FROM (OLD.working_assessed_by, OLD.working_assessed_at) THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: working assessment attribution is set by the database';
  END IF;

  -- Remediation and ownership are working information of open matters.
  IF (NEW.remediation_plan, NEW.monitor_until) IS DISTINCT FROM (OLD.remediation_plan, OLD.monitor_until)
     AND OLD.status <> 'open' THEN
    RAISE EXCEPTION 'VO_MATTER_CLOSED: reopen the matter to change its remediation';
  END IF;
  IF NEW.response_owner_person_id IS DISTINCT FROM OLD.response_owner_person_id AND OLD.status <> 'open' THEN
    RAISE EXCEPTION 'VO_MATTER_CLOSED: reopen the matter to change its Risk / Leakage Owner';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER vo_value_leakage_guard ON value_leakage;
CREATE TRIGGER vo_value_leakage_guard
  BEFORE INSERT OR UPDATE OR DELETE ON value_leakage
  FOR EACH ROW EXECUTE FUNCTION vo_value_leakage_guard();

-- ---------------------------------------------------------------------------
-- Formal assessments and finalisation snapshots (leakage_assessment)

-- The snapshot columns of an assessment row, as one comparable value.
CREATE FUNCTION vo_assessment_snapshot(a leakage_assessment) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'taken_at', a.snapshot_taken_at, 'status', a.snapshot_status, 'stage', a.snapshot_stage,
    'title', a.snapshot_title, 'description', a.snapshot_description, 'owner', a.snapshot_owner_person_id,
    'drivers', a.snapshot_driver_ids, 'assessment', a.snapshot_consultant_assessment,
    'decision_date', a.snapshot_required_decision_date, 'remediation', a.snapshot_remediation_plan,
    'monitor_until', a.snapshot_monitor_until)
$$;

CREATE OR REPLACE FUNCTION vo_leakage_assessment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  snapshot_cols text[] := ARRAY['snapshot_taken_at', 'snapshot_status', 'snapshot_stage', 'snapshot_title',
    'snapshot_description', 'snapshot_owner_person_id', 'snapshot_driver_ids', 'snapshot_consultant_assessment',
    'snapshot_required_decision_date', 'snapshot_remediation_plan', 'snapshot_monitor_until'];
BEGIN
  -- Rows of a finalised review never change (the review is immutable, including its snapshot).
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM vo_require_draft_review(OLD.assurance_review_id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  PERFORM vo_require_draft_review(NEW.assurance_review_id);
  IF TG_OP = 'UPDATE' AND (NEW.value_leakage_id <> OLD.value_leakage_id OR NEW.assurance_review_id <> OLD.assurance_review_id) THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: an assessment cannot move between leakage items or reviews';
  END IF;

  IF cmd = 'assurance.finaliseReview' THEN
    -- Finalisation records the snapshot only: it never sets or changes formal amounts.
    IF TG_OP = 'INSERT' AND (NEW.total_amount IS NOT NULL OR NEW.unrecoverable_amount IS NOT NULL) THEN
      RAISE EXCEPTION 'VO_INVALID_INPUT: finalisation snapshots an unassessed matter as not yet quantified';
    END IF;
    IF TG_OP = 'UPDATE' AND NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), snapshot_cols) THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: finalisation may only record the snapshot';
    END IF;
    IF NEW.snapshot_taken_at IS NULL THEN
      RAISE EXCEPTION 'VO_INVALID_INPUT: finalisation must record the snapshot time';
    END IF;
    RETURN NEW;
  END IF;

  -- Any other command: snapshot columns are untouchable, and a formal assessment states its amounts.
  IF (TG_OP = 'INSERT' AND NEW.snapshot_taken_at IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND vo_assessment_snapshot(OLD) IS DISTINCT FROM vo_assessment_snapshot(NEW)) THEN
    RAISE EXCEPTION 'VO_WRONG_COMMAND: finalisation snapshots are written only by assurance.finaliseReview (got %)', cmd;
  END IF;
  IF NEW.total_amount IS NULL THEN
    RAISE EXCEPTION 'VO_INVALID_INPUT: a formal assessment states the Total Value Leakage';
  END IF;
  IF NEW.unrecoverable_amount > 0 AND NEW.unrecoverable_validated_by IS DISTINCT FROM vo_actor_id()
     AND (TG_OP = 'INSERT' OR NEW.unrecoverable_amount <> OLD.unrecoverable_amount
          OR NEW.unrecoverable_rationale IS DISTINCT FROM OLD.unrecoverable_rationale) THEN
    RAISE EXCEPTION 'VO_ACTOR_MISMATCH: unrecoverable leakage must be validated by the acting consultant';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Assurance Review finalisation requires the matter snapshot (extends 0006)

CREATE OR REPLACE FUNCTION vo_assurance_review_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  actor uuid := vo_actor_id();
  v_status version_status;
  prev assurance_review;
  latest_finalised uuid;
  missing int;
  unassessed int;
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
      IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'finalised_by', 'finalised_at', 'matter_snapshot_at']) THEN
        RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: finalising may only change status and finalisation fields';
      END IF;
      -- Phase 4D.1: the formal review must snapshot every open Assurance matter (quantified or
      -- not) and every matter assessed in it, so later living edits cannot rewrite the position.
      IF NEW.matter_snapshot_at IS NULL THEN
        RAISE EXCEPTION 'VO_MATTER_SNAPSHOT_MISSING: finalisation must snapshot the project''s Assurance matters';
      END IF;
      IF EXISTS (
        SELECT 1 FROM value_leakage m
        WHERE m.project_id = NEW.project_id AND m.status = 'open'
          AND NOT EXISTS (
            SELECT 1 FROM leakage_assessment a
            WHERE a.value_leakage_id = m.id AND a.assurance_review_id = NEW.id AND a.snapshot_taken_at IS NOT NULL
          )
      ) OR EXISTS (
        SELECT 1 FROM leakage_assessment a
        WHERE a.assurance_review_id = NEW.id AND a.snapshot_taken_at IS NULL
      ) THEN
        RAISE EXCEPTION 'VO_MATTER_SNAPSHOT_MISSING: every open Assurance matter, and every matter assessed in this review, must be snapshotted';
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
      -- Every financial driver needs a forecast or an explicit, reasoned "not assessed".
      SELECT count(*) INTO unassessed
      FROM value_driver_version d
      JOIN value_position p ON p.assurance_review_id = NEW.id AND p.value_driver_id = d.value_driver_id
      WHERE d.value_case_version_id = NEW.against_version_id
        AND d.financial_value IS NOT NULL
        AND p.current_forecast IS NULL
        AND NOT p.forecast_not_assessed;
      IF unassessed > 0 THEN
        RAISE EXCEPTION 'VO_FORECAST_MISSING: % financial Value Driver(s) have neither a Current Forecast nor an explicit Not Assessed with rationale', unassessed;
      END IF;
      RETURN NEW;
    END IF;

    -- draft edits
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW),
         ARRAY['review_date', 'trigger', 'trigger_evidence_id', 'what_changed', 'why_it_matters', 'summary',
               'unattributed_realised_value', 'unattributed_realised_rationale']) THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: only the date, trigger, trigger evidence, narratives and unattributed realised value are editable on a draft review';
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
