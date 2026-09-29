-- Phase 3 integrity: management response and Value Change (V2+).
--
-- * Value Case versions V2+ exist only through a Value Change: created, proposed,
--   returned, authorised, rejected or withdrawn in lock-step with it. V1 (the
--   version in force) is superseded only as part of an authorised Value Change.
-- * Value Change: VCO-only authorisation with evidence; reconciles to its stated
--   change amount; authorised/rejected/withdrawn changes are immutable.
-- * Phase 2 refinements: unattributed realised value is editable on draft
--   reviews; finalisation requires every financial driver to have a forecast or
--   an explicit, reasoned Not Assessed.
-- * Leakage assessments follow their review's lifecycle; options freeze once the
--   recommendation is issued; issued recommendations and decisions are immutable.
--
-- Every function below is CREATE OR REPLACE of, or addition to, 0001/0004:
-- existing behaviour is preserved except where extended as described.

-- ---------------------------------------------------------------------------
-- Audit capture for the new tables

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'value_leakage', 'value_leakage_driver', 'leakage_assessment',
    'scenario', 'recommendation', 'decision', 'value_change'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vo_audit_row()',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Value Case version state machine (extends 0001)
--
--   V0:  draft -> recorded
--   V1:  draft <-> proposed -> authorised                (initial VCO authorisation)
--   V2+: draft <-> proposed -> authorised | rejected;    (only via its Value Change)
--        draft/proposed -> withdrawn
--   authorised -> superseded                             (only when a Value Change from it is authorised)

CREATE OR REPLACE FUNCTION vo_value_case_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  actor uuid := vo_actor_id();
  vco uuid;
  basis text;
  driver_count int;
  via_change boolean;
  vc value_change;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'VO_VERSION_INSERT_NOT_DRAFT: value case versions must be created as draft (got %)', NEW.status;
    END IF;
    IF NEW.created_by <> actor THEN
      RAISE EXCEPTION 'VO_ACTOR_MISMATCH: created_by must be the acting consultant';
    END IF;
    IF NEW.kind = 'value_case' AND cmd <> 'valueChange.create' AND EXISTS (
      SELECT 1 FROM value_case_version v
      WHERE v.value_case_id = NEW.value_case_id AND v.status IN ('authorised', 'superseded')
    ) THEN
      RAISE EXCEPTION 'VO_VALUE_CHANGE_REQUIRED: the Value Case is authorised; new versions are created only by a Value Change';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'VO_VERSION_IMMUTABLE: only draft versions can be deleted (version % is %)', OLD.version_number, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status IN ('recorded', 'superseded', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'VO_VERSION_IMMUTABLE: version % is % and cannot be modified', OLD.version_number, OLD.status;
  END IF;

  IF OLD.status = 'authorised' THEN
    IF NEW.status = 'superseded' THEN
      IF cmd = 'valueChange.authorise'
         AND vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'superseded_at'])
         AND EXISTS (SELECT 1 FROM value_change c WHERE c.from_version_id = OLD.id AND c.status = 'authorised') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'VO_VALUE_CHANGE_REQUIRED: an authorised version is superseded only when a Value Change from it is authorised';
    END IF;
    RAISE EXCEPTION 'VO_VERSION_IMMUTABLE: version % is authorised and cannot be modified', OLD.version_number;
  END IF;

  -- Versions after the first authorised one are governed by their Value Change.
  via_change := EXISTS (
    SELECT 1 FROM value_case_version v
    WHERE v.value_case_id = NEW.value_case_id AND v.id <> NEW.id AND v.status IN ('authorised', 'superseded')
  );
  IF via_change THEN
    SELECT * INTO vc FROM value_change c WHERE c.to_version_id = NEW.id;
  END IF;

  -- draft -> draft: content edits only
  IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW),
         ARRAY['title', 'summary', 'stated_total_value', 'based_on_version_id']) THEN
      RAISE EXCEPTION 'VO_VERSION_FIELD_IMMUTABLE: only title, summary, stated_total_value and based_on_version_id are editable on a draft version';
    END IF;
    RETURN NEW;
  END IF;

  -- V0: draft -> recorded
  IF OLD.status = 'draft' AND NEW.status = 'recorded' THEN
    IF cmd <> 'valueCase.recordInheritedBusinessCase' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: recording V0 requires valueCase.recordInheritedBusinessCase (got %)', cmd;
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'recorded_at']) THEN
      RAISE EXCEPTION 'VO_VERSION_FIELD_IMMUTABLE: recording V0 may only change status and recorded_at';
    END IF;
    RETURN NEW;
  END IF;

  -- draft -> proposed
  IF OLD.status = 'draft' AND NEW.status = 'proposed' THEN
    IF via_change THEN
      IF cmd <> 'valueChange.propose' OR vc.status IS DISTINCT FROM 'proposed' THEN
        RAISE EXCEPTION 'VO_WRONG_COMMAND: version % is proposed only through its Value Change', NEW.version_number;
      END IF;
    ELSIF cmd <> 'valueCase.proposeVersion' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: proposing requires valueCase.proposeVersion (got %)', cmd;
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'proposed_at', 'proposed_by']) THEN
      RAISE EXCEPTION 'VO_VERSION_FIELD_IMMUTABLE: proposing may only change status and proposal fields';
    END IF;
    SELECT p.value_basis_description INTO basis FROM project p WHERE p.id = NEW.project_id;
    IF basis IS NULL OR length(trim(basis)) = 0 THEN
      RAISE EXCEPTION 'VO_VALUE_BASIS_REQUIRED: the project Value Basis must be defined before a Value Case can be proposed';
    END IF;
    SELECT count(*) INTO driver_count FROM value_driver_version d WHERE d.value_case_version_id = NEW.id;
    IF driver_count = 0 THEN
      RAISE EXCEPTION 'VO_NO_DRIVERS: a Value Case version needs at least one Value Driver before it can be proposed';
    END IF;
    RETURN NEW;
  END IF;

  -- proposed -> draft (returned for revision)
  IF OLD.status = 'proposed' AND NEW.status = 'draft' THEN
    IF via_change THEN
      IF cmd <> 'valueChange.return' OR vc.status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'VO_WRONG_COMMAND: version % is returned to draft only through its Value Change', NEW.version_number;
      END IF;
    ELSIF cmd <> 'valueCase.returnVersionToDraft' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: returning to draft requires valueCase.returnVersionToDraft (got %)', cmd;
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'proposed_at', 'proposed_by']) THEN
      RAISE EXCEPTION 'VO_VERSION_FIELD_IMMUTABLE: returning to draft may only change status and proposal fields';
    END IF;
    RETURN NEW;
  END IF;

  -- proposed -> authorised
  IF OLD.status = 'proposed' AND NEW.status = 'authorised' THEN
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY[
         'status', 'authorised_on', 'authorised_by_person_id', 'authorisation_evidence_id',
         'authorisation_note', 'authorisation_recorded_by', 'authorisation_recorded_at']) THEN
      RAISE EXCEPTION 'VO_VERSION_FIELD_IMMUTABLE: authorisation may only change status and authorisation fields';
    END IF;
    IF via_change THEN
      IF cmd <> 'valueChange.authorise' OR vc.status IS DISTINCT FROM 'authorised' THEN
        RAISE EXCEPTION 'VO_VALUE_CHANGE_REQUIRED: version % can be authorised only by authorising its Value Change', NEW.version_number;
      END IF;
      IF NEW.authorised_by_person_id IS DISTINCT FROM vc.authorised_by_person_id
         OR NEW.authorisation_evidence_id IS DISTINCT FROM vc.authorisation_evidence_id
         OR NEW.authorised_on IS DISTINCT FROM vc.authorised_on THEN
        RAISE EXCEPTION 'VO_AUTHORISATION_MISMATCH: the version must carry its Value Change''s authorisation';
      END IF;
    ELSE
      IF cmd <> 'valueCase.authoriseInitialVersion' THEN
        RAISE EXCEPTION 'VO_WRONG_COMMAND: authorisation requires valueCase.authoriseInitialVersion (got %)', cmd;
      END IF;
    END IF;
    SELECT c.vco_person_id INTO vco FROM value_case c WHERE c.id = NEW.value_case_id;
    IF vco IS NULL THEN
      RAISE EXCEPTION 'VO_VCO_REQUIRED: the Value Case has no Value Case Owner';
    END IF;
    IF NEW.authorised_by_person_id IS DISTINCT FROM vco THEN
      RAISE EXCEPTION 'VO_NOT_VCO: only the Value Case Owner can authorise the Value Case';
    END IF;
    IF NEW.authorisation_recorded_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'VO_ACTOR_MISMATCH: authorisation_recorded_by must be the acting consultant';
    END IF;
    IF NEW.authorised_on > current_date THEN
      RAISE EXCEPTION 'VO_FUTURE_AUTHORISATION: authorisation date cannot be in the future';
    END IF;
    SELECT p.value_basis_description INTO basis FROM project p WHERE p.id = NEW.project_id;
    IF basis IS NULL OR length(trim(basis)) = 0 THEN
      RAISE EXCEPTION 'VO_VALUE_BASIS_REQUIRED: the project Value Basis must be defined before authorisation';
    END IF;
    RETURN NEW;
  END IF;

  -- Value Change closed without authorisation
  IF NEW.status IN ('rejected', 'withdrawn') THEN
    IF NOT via_change
       OR (NEW.status = 'rejected' AND (OLD.status <> 'proposed' OR cmd <> 'valueChange.reject'))
       OR (NEW.status = 'withdrawn' AND cmd <> 'valueChange.withdraw')
       OR vc.status IS DISTINCT FROM NEW.status::text::value_change_status THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: version % is % only through its Value Change', NEW.version_number, NEW.status;
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status']) THEN
      RAISE EXCEPTION 'VO_VERSION_FIELD_IMMUTABLE: closing may only change status';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'VO_INVALID_TRANSITION: % -> % is not a permitted version transition', OLD.status, NEW.status;
END $$;

-- ---------------------------------------------------------------------------
-- Value Change state machine

CREATE FUNCTION vo_version_financial_total(version_id uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(financial_value), 0) FROM value_driver_version WHERE value_case_version_id = version_id
$$;

CREATE FUNCTION vo_value_change_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  actor uuid := vo_actor_id();
  from_v value_case_version;
  to_v value_case_version;
  vco uuid;
  delta numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: Value Changes are never deleted; withdraw instead';
  END IF;

  SELECT * INTO from_v FROM value_case_version WHERE id = NEW.from_version_id;
  SELECT * INTO to_v FROM value_case_version WHERE id = NEW.to_version_id;

  IF TG_OP = 'INSERT' THEN
    IF cmd <> 'valueChange.create' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: Value Changes are created by valueChange.create (got %)', cmd;
    END IF;
    IF NEW.status <> 'draft' OR NEW.created_by <> actor THEN
      RAISE EXCEPTION 'VO_VALUE_CHANGE_INSERT: a Value Change is created as draft by the acting consultant';
    END IF;
    IF from_v.status <> 'authorised' THEN
      RAISE EXCEPTION 'VO_VERSION_NOT_AUTHORISED: a Value Change must start from the Authorised Value Case in force';
    END IF;
    IF to_v.status <> 'draft' OR to_v.kind <> 'value_case' OR to_v.version_number <= from_v.version_number
       OR to_v.based_on_version_id IS DISTINCT FROM from_v.id THEN
      RAISE EXCEPTION 'VO_VALUE_CHANGE_VERSION: the proposed version must be a new draft copied from the version in force';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status IN ('authorised', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'VO_VALUE_CHANGE_IMMUTABLE: % is % and cannot be modified', OLD.code, OLD.status;
  END IF;
  IF (NEW.project_id, NEW.value_case_id, NEW.from_version_id, NEW.to_version_id, NEW.created_by)
     IS DISTINCT FROM (OLD.project_id, OLD.value_case_id, OLD.from_version_id, OLD.to_version_id, OLD.created_by) THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: a Value Change''s versions cannot be changed';
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY[
         'code', 'reason', 'economic_impact_narrative', 'stated_change_amount', 'assurance_review_id', 'decision_id']) THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: only the code, reason, narrative, stated change and origin are editable on a draft Value Change';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'proposed' THEN
    IF cmd <> 'valueChange.propose' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: proposing requires valueChange.propose (got %)', cmd;
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'proposed_at', 'proposed_by'])
       OR NEW.proposed_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: proposing may only change status and proposal fields (proposed by the acting consultant)';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'proposed' AND NEW.status = 'draft' THEN
    IF cmd <> 'valueChange.return' OR NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'proposed_at', 'proposed_by']) THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: returning requires valueChange.return and may only clear proposal fields';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'proposed' AND NEW.status = 'authorised' THEN
    IF cmd <> 'valueChange.authorise' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: authorisation requires valueChange.authorise (got %)', cmd;
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY[
         'status', 'authorised_on', 'authorised_by_person_id', 'authorisation_evidence_id',
         'authorisation_note', 'authorisation_recorded_by', 'authorisation_recorded_at']) THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: authorisation may only change status and authorisation fields';
    END IF;
    SELECT c.vco_person_id INTO vco FROM value_case c WHERE c.id = NEW.value_case_id;
    IF vco IS NULL THEN
      RAISE EXCEPTION 'VO_VCO_REQUIRED: the Value Case has no Value Case Owner';
    END IF;
    IF NEW.authorised_by_person_id IS DISTINCT FROM vco THEN
      RAISE EXCEPTION 'VO_NOT_VCO: only the Value Case Owner can authorise a Value Change';
    END IF;
    IF NEW.authorisation_recorded_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'VO_ACTOR_MISMATCH: authorisation_recorded_by must be the acting consultant';
    END IF;
    IF NEW.authorised_on > current_date THEN
      RAISE EXCEPTION 'VO_FUTURE_AUTHORISATION: authorisation date cannot be in the future';
    END IF;
    IF from_v.status <> 'authorised' OR to_v.status <> 'proposed' THEN
      RAISE EXCEPTION 'VO_VALUE_CHANGE_STATE: the change must be from the version in force to a proposed version';
    END IF;
    IF NEW.stated_change_amount IS NOT NULL THEN
      delta := vo_version_financial_total(to_v.id) - vo_version_financial_total(from_v.id);
      IF delta <> NEW.stated_change_amount THEN
        RAISE EXCEPTION 'VO_CHANGE_NOT_RECONCILED: V% changes the financial total by % but the Value Change states %; adjust the drivers or the stated change first',
          to_v.version_number, delta, NEW.stated_change_amount;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('rejected', 'withdrawn') THEN
    IF (NEW.status = 'rejected' AND (OLD.status <> 'proposed' OR cmd <> 'valueChange.reject'))
       OR (NEW.status = 'withdrawn' AND cmd <> 'valueChange.withdraw') THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: % -> % is not permitted by command %', OLD.status, NEW.status, cmd;
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'closed_at', 'closed_by', 'closure_note'])
       OR NEW.closed_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: closing may only record status and closure (by the acting consultant)';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'VO_INVALID_TRANSITION: % -> % is not a permitted Value Change transition', OLD.status, NEW.status;
END $$;

CREATE TRIGGER vo_value_change_guard
  BEFORE INSERT OR UPDATE OR DELETE ON value_change
  FOR EACH ROW EXECUTE FUNCTION vo_value_change_guard();

-- ---------------------------------------------------------------------------
-- Assurance Review (extends 0004): unattributed realised value; forecast coverage

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


-- ---------------------------------------------------------------------------
-- Leakage assessments follow their review; unrecoverable needs the acting consultant's validation.

CREATE FUNCTION vo_leakage_assessment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM vo_require_draft_review(OLD.assurance_review_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM vo_require_draft_review(NEW.assurance_review_id);
    IF TG_OP = 'UPDATE' AND (NEW.value_leakage_id <> OLD.value_leakage_id OR NEW.assurance_review_id <> OLD.assurance_review_id) THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: an assessment cannot move between leakage items or reviews';
    END IF;
    IF NEW.unrecoverable_amount > 0 AND NEW.unrecoverable_validated_by IS DISTINCT FROM vo_actor_id()
       AND (TG_OP = 'INSERT' OR NEW.unrecoverable_amount <> OLD.unrecoverable_amount
            OR NEW.unrecoverable_rationale IS DISTINCT FROM OLD.unrecoverable_rationale) THEN
      RAISE EXCEPTION 'VO_ACTOR_MISMATCH: unrecoverable leakage must be validated by the acting consultant';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_leakage_assessment_guard
  BEFORE INSERT OR UPDATE OR DELETE ON leakage_assessment
  FOR EACH ROW EXECUTE FUNCTION vo_leakage_assessment_guard();

CREATE FUNCTION vo_value_leakage_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: Value Leakage items are never deleted; close them instead';
  END IF;
  IF (NEW.project_id, NEW.value_case_id, NEW.code, NEW.identified_in_review_id, NEW.created_by)
     IS DISTINCT FROM (OLD.project_id, OLD.value_case_id, OLD.code, OLD.identified_in_review_id, OLD.created_by) THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: a leakage item''s code and origin cannot change';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_value_leakage_guard
  BEFORE UPDATE OR DELETE ON value_leakage
  FOR EACH ROW EXECUTE FUNCTION vo_value_leakage_guard();

-- ---------------------------------------------------------------------------
-- Options, recommendation, decision

CREATE FUNCTION vo_recommendation_issued(review_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM recommendation r
    WHERE r.assurance_review_id = vo_recommendation_issued.review_id AND r.issued_at IS NOT NULL
  )
$$;

CREATE FUNCTION vo_scenario_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  review uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.assurance_review_id ELSE NEW.assurance_review_id END;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.assurance_review_id <> OLD.assurance_review_id THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: a scenario cannot move between reviews';
  END IF;
  PERFORM vo_require_draft_review(review);
  IF vo_recommendation_issued(review) THEN
    RAISE EXCEPTION 'VO_RECOMMENDATION_ISSUED: options are frozen once Cardaxia''s recommendation has been issued';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_scenario_guard
  BEFORE INSERT OR UPDATE OR DELETE ON scenario
  FOR EACH ROW EXECUTE FUNCTION vo_scenario_guard();

CREATE FUNCTION vo_recommendation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  k scenario_kind;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.issued_at IS NOT NULL THEN
      RAISE EXCEPTION 'VO_RECOMMENDATION_ISSUED: an issued recommendation is permanent';
    END IF;
    PERFORM vo_require_draft_review(OLD.assurance_review_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.issued_at IS NOT NULL THEN
    RAISE EXCEPTION 'VO_RECOMMENDATION_ISSUED: an issued recommendation is permanent and is never rewritten';
  END IF;
  PERFORM vo_require_draft_review(NEW.assurance_review_id);
  IF TG_OP = 'INSERT' AND (NEW.created_by <> vo_actor_id() OR NEW.issued_at IS NOT NULL) THEN
    RAISE EXCEPTION 'VO_RECOMMENDATION_INSERT: a recommendation is created unissued by the acting consultant';
  END IF;
  SELECT kind INTO k FROM scenario WHERE id = NEW.scenario_id;
  IF k IS DISTINCT FROM 'recommended' THEN
    RAISE EXCEPTION 'VO_RECOMMENDATION_SCENARIO: the recommendation must reference the review''s recommended scenario';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.issued_at IS NOT NULL THEN
    IF vo_command() <> 'options.issueRecommendation' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: issuing requires options.issueRecommendation';
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['issued_at', 'issued_by']) OR NEW.issued_by <> vo_actor_id() THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: issuing may only record who issued it and when';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_recommendation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON recommendation
  FOR EACH ROW EXECUTE FUNCTION vo_recommendation_guard();

CREATE FUNCTION vo_decision_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'VO_DECISION_IMMUTABLE: a recorded client decision is permanent';
  END IF;
  IF NEW.recorded_by <> vo_actor_id() THEN
    RAISE EXCEPTION 'VO_ACTOR_MISMATCH: recorded_by must be the acting consultant';
  END IF;
  IF NOT vo_recommendation_issued(NEW.assurance_review_id) THEN
    RAISE EXCEPTION 'VO_RECOMMENDATION_REQUIRED: record the client decision after Cardaxia''s recommendation has been issued';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_decision_guard
  BEFORE INSERT OR UPDATE OR DELETE ON decision
  FOR EACH ROW EXECUTE FUNCTION vo_decision_guard();

-- ---------------------------------------------------------------------------
-- Evidence relied on by an authorised Value Change or a recorded decision is frozen too.

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
  ) OR EXISTS (
    SELECT 1 FROM value_change c
    WHERE c.authorisation_evidence_id = vo_evidence_is_locked.evidence_id AND c.status = 'authorised'
  ) OR EXISTS (
    SELECT 1 FROM decision d WHERE d.supporting_evidence_id = vo_evidence_is_locked.evidence_id
  )
$$;
