-- Phase 4D.9C integrity: governed Value Trajectories (contract: docs/architecture.md, "Value Trajectory
-- methodology contract").
--
-- * value_case_version gains a basis kind and Value Period. They are editable only on a draft version, only
--   through valueCase.setVersionBasis (or copied by valueChange.create), and immutable from proposal. Once a
--   governed version is classified, later versions keep the same kind (no silent conversion).
-- * value_trajectory_point rows belong to exactly one parent and are written only by the trajectory commands
--   (plus valueChange.create copying a plan, and options.removeScenario removing an option's points) while that
--   parent is editable: a draft version (never V0), a draft review, or an option before the recommendation is
--   issued. Dates must sit inside the governing Value Period, and forecast / option points after the review date.
--   Only trajectory-capable basis kinds (cumulative_benefit, annual_run_rate) accept points.
-- * Terminal reconciliation, only when points exist: version proposal and authorisation (plan = version total),
--   recommendation issue (each option = its total) and review finalisation (forecast = complete formal forecast
--   total; options re-checked). Lines with no points are always allowed ("Phasing not entered").
-- * Nothing is backfilled and no existing row changes. The version guard below is 0006's, verbatim except the
--   draft whitelist, which admits the three new columns.

CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON value_trajectory_point
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row();

-- ---------------------------------------------------------------------------
-- Version guard (0006) with the draft whitelist extended

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
         ARRAY['title', 'summary', 'stated_total_value', 'based_on_version_id',
               'value_basis_kind', 'value_period_start', 'value_period_end']) THEN
      RAISE EXCEPTION 'VO_VERSION_FIELD_IMMUTABLE: only title, summary, stated_total_value, based_on_version_id and the basis kind / Value Period are editable on a draft version';
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
-- Reconciliation checks (raise when points exist and do not reconcile)

CREATE FUNCTION vo_trajectory_kind_supported(k value_basis_kind) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT k IS NOT NULL AND k IN ('cumulative_benefit', 'annual_run_rate')
$$;

CREATE FUNCTION vo_plan_trajectory_check(version_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v value_case_version;
  end_value numeric;
  total numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM value_trajectory_point p WHERE p.value_case_version_id = version_id) THEN
    RETURN;
  END IF;
  SELECT * INTO v FROM value_case_version WHERE id = version_id;
  IF NOT vo_trajectory_kind_supported(v.value_basis_kind) THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_BASIS: version % has plan points but its Value Basis kind does not support a trajectory', v.version_number;
  END IF;
  IF v.value_period_start IS NULL OR v.value_period_end IS NULL THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_PERIOD_REQUIRED: version % has plan points but no Value Period', v.version_number;
  END IF;
  IF EXISTS (SELECT 1 FROM value_trajectory_point p WHERE p.value_case_version_id = version_id
             AND (p.as_of < v.value_period_start OR p.as_of > v.value_period_end)) THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_DATE: version % has plan points outside its Value Period', v.version_number;
  END IF;
  SELECT p.value INTO end_value FROM value_trajectory_point p
    WHERE p.value_case_version_id = version_id AND p.as_of = v.value_period_end;
  total := vo_version_financial_total(version_id);
  IF end_value IS NULL THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_NOT_RECONCILED: version %''s plan needs a point on the Value Period end (%) equal to the version total %', v.version_number, v.value_period_end, total;
  END IF;
  IF end_value <> total THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_NOT_RECONCILED: version %''s plan ends at % but the version total is %', v.version_number, end_value, total;
  END IF;
END $$;

-- Dates of forecast / option points against the governing version of a review.
CREATE FUNCTION vo_review_trajectory_dates_check(r assurance_review, v value_case_version, what text,
                                                 review_points boolean, scenario uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT vo_trajectory_kind_supported(v.value_basis_kind) THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_BASIS: % points need the measured-against version (V%) to have a trajectory-capable Value Basis kind', what, v.version_number;
  END IF;
  IF v.value_period_start IS NULL OR v.value_period_end IS NULL THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_PERIOD_REQUIRED: % points need a Value Period on V%', what, v.version_number;
  END IF;
  IF EXISTS (SELECT 1 FROM value_trajectory_point p
             WHERE (CASE WHEN review_points THEN p.assurance_review_id = r.id ELSE p.scenario_id = scenario END)
               AND (p.as_of <= r.review_date OR p.as_of < v.value_period_start OR p.as_of > v.value_period_end)) THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_DATE: % points must fall after the review date (%) and within the Value Period of V%', what, r.review_date, v.version_number;
  END IF;
END $$;

CREATE FUNCTION vo_forecast_trajectory_check(review_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r assurance_review;
  v value_case_version;
  end_value numeric;
  total numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM value_trajectory_point p WHERE p.assurance_review_id = review_id) THEN
    RETURN;
  END IF;
  SELECT * INTO r FROM assurance_review WHERE id = review_id;
  SELECT * INTO v FROM value_case_version WHERE id = r.against_version_id;
  PERFORM vo_review_trajectory_dates_check(r, v, 'Formal forecast', true, NULL);
  -- The formal forecast total exists only when every financial driver of the measured version has one
  -- (same rule as the Value Position read model).
  IF EXISTS (
    SELECT 1 FROM value_driver_version d
    WHERE d.value_case_version_id = v.id AND d.financial_value IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM value_position vp
                      WHERE vp.assurance_review_id = r.id AND vp.value_driver_id = d.value_driver_id
                        AND vp.current_forecast IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_FORECAST_INCOMPLETE: the formal forecast is incomplete, so forecast trajectory points cannot be kept; complete the forecast or remove the points';
  END IF;
  SELECT coalesce(sum(vp.current_forecast), 0) INTO total
    FROM value_driver_version d
    JOIN value_position vp ON vp.assurance_review_id = r.id AND vp.value_driver_id = d.value_driver_id
    WHERE d.value_case_version_id = v.id AND d.financial_value IS NOT NULL;
  SELECT p.value INTO end_value FROM value_trajectory_point p
    WHERE p.assurance_review_id = review_id AND p.as_of = v.value_period_end;
  IF end_value IS NULL THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_NOT_RECONCILED: the formal forecast path needs a point on the Value Period end (%) equal to the formal forecast %', v.value_period_end, total;
  END IF;
  IF end_value <> total THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_NOT_RECONCILED: the formal forecast path ends at % but the formal forecast is %', end_value, total;
  END IF;
END $$;

CREATE FUNCTION vo_scenario_trajectory_check(scenario_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  s scenario;
  r assurance_review;
  v value_case_version;
  end_value numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM value_trajectory_point p WHERE p.scenario_id = vo_scenario_trajectory_check.scenario_id) THEN
    RETURN;
  END IF;
  SELECT * INTO s FROM scenario WHERE id = vo_scenario_trajectory_check.scenario_id;
  SELECT * INTO r FROM assurance_review WHERE id = s.assurance_review_id;
  SELECT * INTO v FROM value_case_version WHERE id = r.against_version_id;
  PERFORM vo_review_trajectory_dates_check(r, v, format('Option "%s"', s.label), false, s.id);
  SELECT p.value INTO end_value FROM value_trajectory_point p
    WHERE p.scenario_id = s.id AND p.as_of = v.value_period_end;
  IF end_value IS NULL THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_NOT_RECONCILED: option "%" needs a point on the Value Period end (%) equal to its total %', s.label, v.value_period_end, s.total_value;
  END IF;
  IF end_value <> s.total_value THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_NOT_RECONCILED: option "%" ends at % but its total is %', s.label, end_value, s.total_value;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Version: basis fields, kind continuity, plan reconciliation at proposal and authorisation

CREATE FUNCTION vo_version_trajectory_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  prior value_basis_kind;
  basis_changed boolean;
BEGIN
  basis_changed := TG_OP = 'INSERT'
    OR (NEW.value_basis_kind, NEW.value_period_start, NEW.value_period_end)
       IS DISTINCT FROM (OLD.value_basis_kind, OLD.value_period_start, OLD.value_period_end);

  IF TG_OP = 'INSERT' THEN
    IF (NEW.value_basis_kind IS NOT NULL OR NEW.value_period_start IS NOT NULL OR NEW.value_period_end IS NOT NULL)
       AND cmd <> 'valueChange.create' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: a version''s basis kind and Value Period are set with valueCase.setVersionBasis (got %)', cmd;
    END IF;
  ELSIF basis_changed AND cmd <> 'valueCase.setVersionBasis' THEN
    RAISE EXCEPTION 'VO_WRONG_COMMAND: a version''s basis kind and Value Period change only via valueCase.setVersionBasis (got %)', cmd;
  END IF;

  -- Kind continuity: once a governed version is classified, later versions keep its kind.
  IF basis_changed AND NEW.kind = 'value_case' THEN
    SELECT v.value_basis_kind INTO prior FROM value_case_version v
      WHERE v.value_case_id = NEW.value_case_id AND v.id <> NEW.id
        AND v.status IN ('authorised', 'superseded') AND v.value_basis_kind IS NOT NULL
      ORDER BY v.version_number DESC LIMIT 1;
    IF prior IS NOT NULL AND NEW.value_basis_kind IS DISTINCT FROM prior THEN
      RAISE EXCEPTION 'VO_VALUE_BASIS_KIND_CHANGE: the Value Case is classified as %; a later version cannot change or clear its basis kind', prior;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'proposed' THEN
    PERFORM vo_plan_trajectory_check(NEW.id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'proposed' AND NEW.status = 'authorised' THEN
    PERFORM vo_plan_trajectory_check(NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_version_trajectory_guard
  BEFORE INSERT OR UPDATE ON value_case_version
  FOR EACH ROW EXECUTE FUNCTION vo_version_trajectory_guard();

-- ---------------------------------------------------------------------------
-- Trajectory points: parent editability, command, basis and dates

CREATE FUNCTION vo_value_trajectory_point_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  actor uuid := vo_actor_id();
  p value_trajectory_point;
  v value_case_version;
  r assurance_review;
  s scenario;
  writing boolean := TG_OP <> 'DELETE';
BEGIN
  p := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  IF TG_OP = 'INSERT' AND NEW.created_by IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'VO_ACTOR_MISMATCH: created_by must be the acting consultant';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['value', 'note']) THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: a trajectory point''s parent and date cannot change; remove it and add another';
  END IF;

  IF p.value_case_version_id IS NOT NULL THEN
    -- Authorised plan
    IF (writing AND cmd NOT IN ('trajectory.setPlanPoint', 'valueChange.create'))
       OR (NOT writing AND cmd <> 'trajectory.removePlanPoint') THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: plan points change only via trajectory.setPlanPoint / removePlanPoint (got %)', cmd;
    END IF;
    SELECT * INTO v FROM value_case_version WHERE id = p.value_case_version_id;
    IF v.kind <> 'value_case' THEN
      RAISE EXCEPTION 'VO_TRAJECTORY_INHERITED_CASE: the inherited Business Case (V0) has no trajectory phasing';
    END IF;
    IF v.status <> 'draft' THEN
      RAISE EXCEPTION 'VO_TRAJECTORY_LOCKED: version % is %; its plan changes only through a Value Change', v.version_number, v.status;
    END IF;
    IF writing THEN
      IF NOT vo_trajectory_kind_supported(v.value_basis_kind) THEN
        RAISE EXCEPTION 'VO_TRAJECTORY_BASIS: plan points need a trajectory-capable Value Basis kind (cumulative benefit or annual run-rate) on V%', v.version_number;
      END IF;
      IF v.value_period_start IS NULL OR v.value_period_end IS NULL THEN
        RAISE EXCEPTION 'VO_TRAJECTORY_PERIOD_REQUIRED: set the Value Period of V% before entering plan points', v.version_number;
      END IF;
      IF p.as_of < v.value_period_start OR p.as_of > v.value_period_end THEN
        RAISE EXCEPTION 'VO_TRAJECTORY_DATE: % is outside the Value Period of V% (% to %)', p.as_of, v.version_number, v.value_period_start, v.value_period_end;
      END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF p.assurance_review_id IS NOT NULL THEN
    -- Formal forecast path
    IF (writing AND cmd <> 'trajectory.setForecastPoint') OR (NOT writing AND cmd <> 'trajectory.removeForecastPoint') THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: forecast points change only via trajectory.setForecastPoint / removeForecastPoint (got %)', cmd;
    END IF;
    SELECT * INTO r FROM assurance_review WHERE id = p.assurance_review_id;
  ELSE
    -- Option path
    IF (writing AND cmd <> 'trajectory.setScenarioPoint')
       OR (NOT writing AND cmd NOT IN ('trajectory.removeScenarioPoint', 'options.removeScenario')) THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: option points change only via trajectory.setScenarioPoint / removeScenarioPoint (got %)', cmd;
    END IF;
    SELECT * INTO s FROM scenario WHERE id = p.scenario_id;
    SELECT * INTO r FROM assurance_review WHERE id = s.assurance_review_id;
    IF EXISTS (SELECT 1 FROM recommendation rec WHERE rec.assurance_review_id = r.id AND rec.issued_at IS NOT NULL) THEN
      RAISE EXCEPTION 'VO_RECOMMENDATION_ISSUED: options and their paths are frozen once Cardaxia''s recommendation has been issued';
    END IF;
  END IF;

  IF r.status <> 'draft' THEN
    RAISE EXCEPTION 'VO_TRAJECTORY_LOCKED: Assurance Review % is finalised; its trajectory points are permanent', r.sequence;
  END IF;
  IF writing THEN
    SELECT * INTO v FROM value_case_version WHERE id = r.against_version_id;
    IF NOT vo_trajectory_kind_supported(v.value_basis_kind) THEN
      RAISE EXCEPTION 'VO_TRAJECTORY_BASIS: the measured-against version (V%) has no trajectory-capable Value Basis kind', v.version_number;
    END IF;
    IF v.value_period_start IS NULL OR v.value_period_end IS NULL THEN
      RAISE EXCEPTION 'VO_TRAJECTORY_PERIOD_REQUIRED: the measured-against version (V%) has no Value Period', v.version_number;
    END IF;
    IF p.as_of <= r.review_date OR p.as_of < v.value_period_start OR p.as_of > v.value_period_end THEN
      RAISE EXCEPTION 'VO_TRAJECTORY_DATE: % must fall after the review date (%) and within the Value Period of V% (% to %)', p.as_of, r.review_date, v.version_number, v.value_period_start, v.value_period_end;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_value_trajectory_point_guard
  BEFORE INSERT OR UPDATE OR DELETE ON value_trajectory_point
  FOR EACH ROW EXECUTE FUNCTION vo_value_trajectory_point_guard();

-- ---------------------------------------------------------------------------
-- Gates: recommendation issue (options freeze) and review finalisation

CREATE FUNCTION vo_recommendation_trajectory_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid uuid;
BEGIN
  IF OLD.issued_at IS NULL AND NEW.issued_at IS NOT NULL THEN
    FOR sid IN SELECT id FROM scenario WHERE assurance_review_id = NEW.assurance_review_id LOOP
      PERFORM vo_scenario_trajectory_check(sid);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_recommendation_trajectory_gate
  BEFORE UPDATE ON recommendation
  FOR EACH ROW EXECUTE FUNCTION vo_recommendation_trajectory_gate();

CREATE FUNCTION vo_review_trajectory_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid uuid;
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'finalised' THEN
    PERFORM vo_forecast_trajectory_check(NEW.id);
    FOR sid IN SELECT id FROM scenario WHERE assurance_review_id = NEW.id LOOP
      PERFORM vo_scenario_trajectory_check(sid);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_review_trajectory_gate
  BEFORE UPDATE ON assurance_review
  FOR EACH ROW EXECUTE FUNCTION vo_review_trajectory_gate();
