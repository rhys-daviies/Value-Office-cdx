-- Phase 4A integrity: issued client reports.
--
-- * report_issue is insert-only: an issued report is an immutable snapshot of the
--   report view model plus a reference to its generated PDF. Corrections are a new
--   issue (next issue number), never an edit.
-- * Issue only via command `reports.issue`, by the acting consultant, at now().
-- * The subject must be in an issuable state, and subject_status must record it:
--     information_request   request issued or closed
--     requalification      V1 (value_case), authorised or superseded
--     assurance            review finalised
--     value_change_notice  change proposed or authorised
-- * issue_number is the next number for that subject and type.
--
-- Nothing here alters earlier functions.

CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON report_issue
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row();

CREATE FUNCTION vo_report_issue_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text;
  actor uuid;
  current_status text;
  subject uuid;
  last_number int;
  v value_case_version;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'VO_REPORT_IMMUTABLE: issued reports cannot be changed or deleted; issue a new report instead';
  END IF;

  cmd := vo_command();
  actor := vo_actor_id();
  IF cmd <> 'reports.issue' THEN
    RAISE EXCEPTION 'VO_WRONG_COMMAND: reports can only be issued by reports.issue (got %)', cmd;
  END IF;
  IF NEW.issued_by <> actor THEN
    RAISE EXCEPTION 'VO_ACTOR_MISMATCH: issued_by must be the acting consultant';
  END IF;
  NEW.issued_at := now();

  CASE NEW.type
    WHEN 'information_request' THEN
      subject := NEW.information_request_id;
      SELECT status::text INTO current_status FROM information_request WHERE id = subject FOR SHARE;
      IF current_status NOT IN ('issued', 'closed') THEN
        RAISE EXCEPTION 'VO_REPORT_SUBJECT_INVALID: an Information Request can be issued as a report only once the request is issued (it is %)', current_status;
      END IF;
    WHEN 'requalification' THEN
      subject := NEW.value_case_version_id;
      SELECT * INTO v FROM value_case_version WHERE id = subject FOR SHARE;
      current_status := v.status::text;
      IF v.kind <> 'value_case' OR v.version_number <> 1 THEN
        RAISE EXCEPTION 'VO_REPORT_SUBJECT_INVALID: the Re-Qualification Report covers the Re-Qualified Value Case (V1) only';
      END IF;
      IF current_status NOT IN ('authorised', 'superseded') THEN
        RAISE EXCEPTION 'VO_REPORT_SUBJECT_INVALID: the Re-Qualification Report requires an Authorised Value Case (V1 is %)', current_status;
      END IF;
    WHEN 'assurance' THEN
      subject := NEW.assurance_review_id;
      SELECT status::text INTO current_status FROM assurance_review WHERE id = subject FOR SHARE;
      IF current_status <> 'finalised' THEN
        RAISE EXCEPTION 'VO_REPORT_SUBJECT_INVALID: the Value Assurance Report requires a finalised Assurance Review (it is %)', current_status;
      END IF;
    WHEN 'value_change_notice' THEN
      subject := NEW.value_change_id;
      SELECT status::text INTO current_status FROM value_change WHERE id = subject FOR SHARE;
      IF current_status NOT IN ('proposed', 'authorised') THEN
        RAISE EXCEPTION 'VO_REPORT_SUBJECT_INVALID: a Value Change Notice can be issued only for a proposed or authorised Value Change (it is %)', current_status;
      END IF;
  END CASE;

  IF NEW.subject_status IS DISTINCT FROM current_status THEN
    RAISE EXCEPTION 'VO_REPORT_STALE: the report was prepared for a subject that is %, but it is now %', NEW.subject_status, current_status;
  END IF;

  SELECT max(issue_number) INTO last_number FROM report_issue
  WHERE type = NEW.type
    AND coalesce(information_request_id, value_case_version_id, assurance_review_id, value_change_id) = subject;
  IF NEW.issue_number <> coalesce(last_number, 0) + 1 THEN
    RAISE EXCEPTION 'VO_REPORT_STALE: expected issue number %, got %', coalesce(last_number, 0) + 1, NEW.issue_number;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER vo_report_issue_guard
  BEFORE INSERT OR UPDATE OR DELETE ON report_issue
  FOR EACH ROW EXECUTE FUNCTION vo_report_issue_guard();

CREATE FUNCTION vo_report_issue_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'VO_REPORT_IMMUTABLE: issued reports cannot be truncated';
END $$;

CREATE TRIGGER vo_report_issue_no_truncate
  BEFORE TRUNCATE ON report_issue
  FOR EACH STATEMENT EXECUTE FUNCTION vo_report_issue_no_truncate();
