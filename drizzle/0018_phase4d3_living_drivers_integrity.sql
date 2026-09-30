-- Phase 4D.3 integrity: living and emerging Value Drivers.
--
-- * value_driver_record is the WORKING understanding of a stable driver identity. It is created by
--   driver.createEmerging (a new identity, identified_on) or driver.initialiseRecord (an existing
--   identity, starting from one of its versions), never deleted, and each group of fields changes
--   only through its own command. The working estimate is attributed to the acting consultant.
-- * Nothing here touches value_driver_version, value_position, value_change or any total:
--   vo_version_financial_total() and the Value Position read only governed version content, so a
--   working estimate can never reach Authorised Value, Current Forecast, Value Gap or realised value.
-- * Working assumptions change only through their own commands. Inclusion in a Value Change copies
--   them into the draft version; the two never synchronise afterwards.
-- * A driver identity is created only by valueCase.addValueDriver or driver.createEmerging, and is
--   never deleted while anything still refers to it (living record, versions, positions, evidence,
--   matters, request items, formal snapshots).

CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON value_driver_record
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row();
CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON value_driver_record_assumption
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row();

-- ---------------------------------------------------------------------------
-- Living record

CREATE FUNCTION vo_value_driver_record_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  actor uuid := vo_actor_id();
  allowed text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: living Value Driver records are never deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF cmd NOT IN ('driver.createEmerging', 'driver.initialiseRecord') THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: living driver records are created by driver.createEmerging or driver.initialiseRecord (got %)', cmd;
    END IF;
    IF NEW.created_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'VO_ACTOR_MISMATCH: created_by must be the acting consultant';
    END IF;
    IF cmd = 'driver.createEmerging' AND NEW.identified_on IS NULL THEN
      RAISE EXCEPTION 'VO_INVALID_INPUT: an emerging driver records when it was identified';
    END IF;
    IF cmd = 'driver.initialiseRecord' AND NOT EXISTS (
         SELECT 1 FROM value_driver_version
          WHERE value_case_version_id = NEW.initialised_from_version_id AND value_driver_id = NEW.value_driver_id) THEN
      RAISE EXCEPTION 'VO_INVALID_INPUT: a working record starts from a version that contains this driver';
    END IF;
    IF NEW.working_estimate IS NULL THEN
      NEW.estimate_recorded_by := NULL;
      NEW.estimate_recorded_at := NULL;
    ELSE
      NEW.estimate_recorded_by := actor;
      NEW.estimate_recorded_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: identity, origin and creator never change; each field group has its own command.
  IF NEW.working_estimate IS DISTINCT FROM OLD.working_estimate THEN
    IF NEW.working_estimate IS NULL THEN
      NEW.estimate_recorded_by := NULL;
      NEW.estimate_recorded_at := NULL;
    ELSE
      NEW.estimate_recorded_by := actor;
      NEW.estimate_recorded_at := now();
    END IF;
  END IF;
  allowed := CASE cmd
    WHEN 'driver.updateWorking' THEN ARRAY['name', 'description', 'metric', 'metric_unit', 'baseline_value',
                                           'target_value', 'calculation_rationale', 'notes']
    WHEN 'driver.setAvo' THEN ARRAY['avo_person_id']
    WHEN 'driver.setQualification' THEN ARRAY['qualification_status']
    WHEN 'driver.setEvidenceStatus' THEN ARRAY['evidence_status']
    WHEN 'driver.setEstimate' THEN ARRAY['working_estimate', 'estimate_recorded_by', 'estimate_recorded_at']
    ELSE ARRAY[]::text[]
  END;
  IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), allowed) THEN
    RAISE EXCEPTION 'VO_WRONG_COMMAND: % may not change these living driver fields', cmd;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_value_driver_record_guard
  BEFORE INSERT OR UPDATE OR DELETE ON value_driver_record
  FOR EACH ROW EXECUTE FUNCTION vo_value_driver_record_guard();

-- ---------------------------------------------------------------------------
-- Working assumptions

CREATE FUNCTION vo_value_driver_record_assumption_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  expected text := CASE TG_OP
    WHEN 'INSERT' THEN 'driver.addAssumption'
    WHEN 'UPDATE' THEN 'driver.updateAssumption'
    ELSE 'driver.removeAssumption' END;
BEGIN
  IF cmd <> expected THEN
    RAISE EXCEPTION 'VO_WRONG_COMMAND: working assumptions change only through % (got %)', expected, cmd;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.value_driver_record_id <> OLD.value_driver_record_id THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: a working assumption cannot move between drivers';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_value_driver_record_assumption_guard
  BEFORE INSERT OR UPDATE OR DELETE ON value_driver_record_assumption
  FOR EACH ROW EXECUTE FUNCTION vo_value_driver_record_assumption_guard();

-- ---------------------------------------------------------------------------
-- Driver identity: bounded creation, no deletion while referenced

CREATE FUNCTION vo_value_driver_identity_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF cmd NOT IN ('valueCase.addValueDriver', 'driver.createEmerging') THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: Value Driver identities are created by valueCase.addValueDriver or driver.createEmerging (got %)', cmd;
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM value_driver_record WHERE value_driver_id = OLD.id)
     OR EXISTS (SELECT 1 FROM value_driver_version WHERE value_driver_id = OLD.id)
     OR EXISTS (SELECT 1 FROM value_position WHERE value_driver_id = OLD.id)
     OR EXISTS (SELECT 1 FROM evidence_link WHERE value_driver_id = OLD.id)
     OR EXISTS (SELECT 1 FROM value_leakage_driver WHERE value_driver_id = OLD.id)
     OR EXISTS (SELECT 1 FROM information_request_item WHERE value_driver_id = OLD.id)
     OR EXISTS (SELECT 1 FROM leakage_assessment WHERE OLD.id = ANY (snapshot_driver_ids)) THEN
    RAISE EXCEPTION 'VO_DRIVER_IN_USE: % is still referenced and cannot be deleted', OLD.code;
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER vo_value_driver_identity_guard
  BEFORE INSERT OR DELETE ON value_driver
  FOR EACH ROW EXECUTE FUNCTION vo_value_driver_identity_guard();
