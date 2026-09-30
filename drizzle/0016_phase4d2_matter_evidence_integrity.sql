-- Phase 4D.2 integrity: Continuous Assurance evidence and evidence requests.
--
-- * evidence_link gains two WORKING targets: a living Assurance matter (value_leakage_id) and a
--   stable Value Driver identity (value_driver_id). They are created and removed only by their own
--   commands, never edited, and matter links change only while the matter is open.
-- * Working links are not formal reliance. vo_evidence_is_locked() is deliberately unchanged: it
--   locks evidence only through a non-draft version, a finalised review (link or trigger), an
--   authorised Value Change or a decision. A working link neither locks nor unlocks evidence, and
--   evidence already locked stays locked (vo_evidence_guard is untouched).
-- * Formal review evidence stays deliberate: nothing copies matter links into a review.
-- * Information Requests carry a purpose (mobilisation / assurance). Requests created before 4D.2
--   keep a null purpose (read as Mobilisation) — no backfill, no reinterpretation. New requests
--   must state one; the purpose never changes afterwards.
-- * An item may gather evidence for one Assurance matter, only on an Assurance request, only
--   while the matter is open when the item is raised; the item's matter never changes afterwards.
-- Evidence arriving never moves a matter's stage or working figures: no trigger here touches
-- value_leakage, and fulfilment remains informationRequest.updateItem.

-- ---------------------------------------------------------------------------
-- Evidence links

CREATE OR REPLACE FUNCTION vo_evidence_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  link evidence_link;
  matter_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: evidence links cannot be edited; delete and re-create while the target is draft';
  END IF;
  link := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  -- Working link to a living Assurance matter.
  IF link.value_leakage_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND cmd NOT IN ('matter.linkEvidence', 'matter.documentEvidence') THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: link evidence to an Assurance matter with matter.linkEvidence (got %)', cmd;
    END IF;
    IF TG_OP = 'DELETE' AND cmd <> 'matter.unlinkEvidence' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: remove matter evidence with matter.unlinkEvidence (got %)', cmd;
    END IF;
    SELECT status::text INTO matter_status FROM value_leakage WHERE id = link.value_leakage_id;
    IF matter_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'VO_MATTER_CLOSED: the Assurance matter is closed; reopen it to change its evidence';
    END IF;
    RETURN link;
  END IF;

  -- Working link to a stable Value Driver identity (no version is touched).
  IF link.value_driver_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND cmd NOT IN ('evidence.linkDriver', 'matter.documentEvidence') THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: link evidence to a Value Driver with evidence.linkDriver (got %)', cmd;
    END IF;
    IF TG_OP = 'DELETE' AND cmd <> 'evidence.unlinkDriver' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: remove a Value Driver evidence link with evidence.unlinkDriver (got %)', cmd;
    END IF;
    RETURN link;
  END IF;

  -- Formal targets: unchanged from 0004.
  IF link.assurance_review_id IS NOT NULL THEN
    PERFORM vo_require_draft_review(link.assurance_review_id);
  ELSE
    PERFORM vo_require_draft_version(vo_evidence_link_version(link));
  END IF;
  RETURN link;
END $$;

-- ---------------------------------------------------------------------------
-- Information Request purpose

CREATE FUNCTION vo_information_request_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.purpose IS NULL THEN
    RAISE EXCEPTION 'VO_INVALID_INPUT: a new Information Request needs a purpose (mobilisation or assurance)';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.purpose IS DISTINCT FROM OLD.purpose THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: an Information Request keeps the purpose it was raised for';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_information_request_guard
  BEFORE INSERT OR UPDATE ON information_request
  FOR EACH ROW EXECUTE FUNCTION vo_information_request_guard();

-- ---------------------------------------------------------------------------
-- Information Request items for an Assurance matter

CREATE FUNCTION vo_information_request_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_purpose text;
  matter_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.value_leakage_id IS DISTINCT FROM OLD.value_leakage_id THEN
      RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: a request item keeps the Assurance matter it was raised for';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.value_leakage_id IS NOT NULL THEN
    SELECT purpose::text INTO request_purpose FROM information_request WHERE id = NEW.information_request_id;
    IF request_purpose IS DISTINCT FROM 'assurance' THEN
      RAISE EXCEPTION 'VO_REQUEST_PURPOSE: evidence for an Assurance matter is requested on an Assurance Information Request';
    END IF;
    SELECT status::text INTO matter_status FROM value_leakage WHERE id = NEW.value_leakage_id;
    IF matter_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'VO_MATTER_CLOSED: the Assurance matter is closed; reopen it to request evidence';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_information_request_item_guard
  BEFORE INSERT OR UPDATE ON information_request_item
  FOR EACH ROW EXECUTE FUNCTION vo_information_request_item_guard();
