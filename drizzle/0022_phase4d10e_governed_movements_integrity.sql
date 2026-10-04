-- Phase 4D.10E integrity: governed value movements. Any non-zero governed value movement must carry an explicit
-- rationale at its formal governance gate (contract: docs/architecture.md, "Governed value movements").
--
-- * Value Case Definition (V1 proposal). For each driver of the first governed Value Case, movement =
--   contribution(V1 row) − contribution(recorded Original Business Case counterpart), where a non-financial row or
--   an absent counterpart contributes nothing (the existing total semantics). A non-zero movement needs
--   value_driver_version.adjustment_rationale ("why changed", or "why introduced" when there is no counterpart).
--   A financial Original Business Case driver not carried into V1 needs a value_driver_exclusion row ("why not
--   carried forward"). A draft Original Business Case is not a governed baseline.
-- * Value Changes (V2+) are explained by value_change.reason, already required at their proposal; driver-level
--   adjustment rationale is optional there.
-- * Assurance (review finalisation). For each financial driver with a Current Forecast, baseline = the previous
--   finalised review's forecast for that driver (the existing movement basis), else — first review, driver absent
--   from it, or Not Assessed there — the driver's authorised value in the version measured against. A different
--   forecast needs value_position.forecast_rationale. Not Assessed keeps its own CHECK (rationale required).
-- * Prospective only: the gates fire on future draft -> proposed / draft -> finalised transitions. Locked versions
--   and finalised reviews are never re-checked, rewritten or backfilled.
-- * Drafts stay working space: nothing here restricts draft editing.

CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON value_driver_exclusion
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row();

-- ---------------------------------------------------------------------------
-- Not-carried-forward rationale: only by its commands, only on a draft first governed Value Case, only for an
-- Original Business Case driver that is not in that version.

CREATE FUNCTION vo_value_driver_exclusion_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  v value_case_version;
BEGIN
  IF cmd NOT IN ('valueCase.setNotCarriedForward', 'valueCase.clearNotCarriedForward') THEN
    RAISE EXCEPTION 'VO_WRONG_COMMAND: not-carried-forward rationale is written only by its commands (got %)', cmd;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM vo_require_draft_version(OLD.value_case_version_id);
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.value_case_version_id <> OLD.value_case_version_id
                           OR NEW.value_driver_id <> OLD.value_driver_id) THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: a not-carried-forward record cannot move between versions or drivers';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM vo_require_draft_version(NEW.value_case_version_id);
    SELECT * INTO v FROM value_case_version WHERE id = NEW.value_case_version_id;
    IF v.kind <> 'value_case' OR EXISTS (
         SELECT 1 FROM value_case_version
          WHERE value_case_id = v.value_case_id AND status IN ('authorised', 'superseded')) THEN
      RAISE EXCEPTION 'VO_INVALID_TRANSITION: drivers not carried forward are recorded only on the first governed Value Case';
    END IF;
    IF EXISTS (SELECT 1 FROM value_driver_version
                WHERE value_case_version_id = NEW.value_case_version_id AND value_driver_id = NEW.value_driver_id) THEN
      RAISE EXCEPTION 'VO_DRIVER_ALREADY_INCLUDED: the driver is in this version, so it is carried forward';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM value_driver_version dv
                     JOIN value_case_version b ON b.id = dv.value_case_version_id
                    WHERE b.value_case_id = v.value_case_id AND b.kind = 'inherited_business_case'
                      AND dv.value_driver_id = NEW.value_driver_id) THEN
      RAISE EXCEPTION 'VO_NOT_IN_ORIGINAL: only an Original Business Case driver can be recorded as not carried forward';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_value_driver_exclusion_guard
  BEFORE INSERT OR UPDATE OR DELETE ON value_driver_exclusion
  FOR EACH ROW EXECUTE FUNCTION vo_value_driver_exclusion_guard();

-- ---------------------------------------------------------------------------
-- Value Case Definition gate: V1 draft -> proposed. Named to fire after vo_value_case_version_guard, so the
-- existing proposal rules (Value Basis, at least one driver, command) report first.

CREATE FUNCTION vo_version_rationale_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  baseline uuid;
  missing text;
BEGIN
  IF NEW.kind <> 'value_case' OR OLD.status <> 'draft' OR NEW.status <> 'proposed' THEN
    RETURN NEW;
  END IF;
  -- V2+ is proposed only through its Value Change, whose reason is required (0006).
  IF EXISTS (SELECT 1 FROM value_case_version
              WHERE value_case_id = NEW.value_case_id AND status IN ('authorised', 'superseded')) THEN
    RETURN NEW;
  END IF;
  SELECT id INTO baseline FROM value_case_version
   WHERE value_case_id = NEW.value_case_id AND kind = 'inherited_business_case' AND status = 'recorded';

  SELECT string_agg(d.code, ', ' ORDER BY d.code) INTO missing
    FROM value_driver_version dv
    JOIN value_driver d ON d.id = dv.value_driver_id
    LEFT JOIN value_driver_version b ON b.value_case_version_id = baseline AND b.value_driver_id = dv.value_driver_id
   WHERE dv.value_case_version_id = NEW.id
     AND coalesce(dv.financial_value, 0) <> coalesce(b.financial_value, 0)
     AND nullif(btrim(coalesce(dv.adjustment_rationale, '')), '') IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'VO_ADJUSTMENT_RATIONALE_REQUIRED: record why the proposed value differs from the Original Business Case (or why it is introduced) for %', missing;
  END IF;

  IF baseline IS NOT NULL THEN
    SELECT string_agg(d.code, ', ' ORDER BY d.code) INTO missing
      FROM value_driver_version b
      JOIN value_driver d ON d.id = b.value_driver_id
     WHERE b.value_case_version_id = baseline
       AND coalesce(b.financial_value, 0) <> 0
       AND NOT EXISTS (SELECT 1 FROM value_driver_version dv
                        WHERE dv.value_case_version_id = NEW.id AND dv.value_driver_id = b.value_driver_id)
       AND NOT EXISTS (SELECT 1 FROM value_driver_exclusion x
                        WHERE x.value_case_version_id = NEW.id AND x.value_driver_id = b.value_driver_id);
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION 'VO_EXCLUSION_RATIONALE_REQUIRED: record why the Original Business Case driver is not carried into V1 for %', missing;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_version_rationale_gate
  BEFORE UPDATE ON value_case_version
  FOR EACH ROW EXECUTE FUNCTION vo_version_rationale_gate();

-- ---------------------------------------------------------------------------
-- Assurance gate: review draft -> finalised. Named to fire after vo_assurance_review_guard (positions complete,
-- forecast coverage) and vo_review_trajectory_gate.

CREATE FUNCTION vo_review_value_rationale_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  missing text;
BEGIN
  IF OLD.status <> 'draft' OR NEW.status <> 'finalised' THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(d.code, ', ' ORDER BY d.code) INTO missing
    FROM value_position p
    JOIN value_driver d ON d.id = p.value_driver_id
    JOIN value_driver_version dv
      ON dv.value_case_version_id = NEW.against_version_id AND dv.value_driver_id = p.value_driver_id
    LEFT JOIN value_position prev
      ON prev.assurance_review_id = NEW.previous_review_id AND prev.value_driver_id = p.value_driver_id
   WHERE p.assurance_review_id = NEW.id
     AND dv.financial_value IS NOT NULL
     AND p.current_forecast IS NOT NULL
     AND p.current_forecast <> coalesce(prev.current_forecast, dv.financial_value)
     AND nullif(btrim(coalesce(p.forecast_rationale, '')), '') IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'VO_FORECAST_RATIONALE_REQUIRED: record why the forecast moved from its formal baseline for %', missing;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_review_value_rationale_gate
  BEFORE UPDATE ON assurance_review
  FOR EACH ROW EXECUTE FUNCTION vo_review_value_rationale_gate();
