-- Internal / pilot tier: issued report PDFs stored in PostgreSQL (VO_REPORT_STORAGE=database).
--
-- * Insert-only via reports.storeDocument, by the acting consultant.
-- * Content-addressed: the recorded sha256 must be the hash of the stored bytes (checked here).
-- * Update, delete and truncate are rejected. Audit rows omit the PDF bytes.
-- Purely additive: no existing table, function or row changes.

CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON report_document
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row_redacted('content');

CREATE FUNCTION vo_report_document_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'VO_REPORT_IMMUTABLE: stored report documents cannot be changed or deleted';
  END IF;
  cmd := vo_command();
  IF cmd <> 'reports.storeDocument' THEN
    RAISE EXCEPTION 'VO_WRONG_COMMAND: report documents are stored only by reports.storeDocument (got %)', cmd;
  END IF;
  IF NEW.created_by <> vo_actor_id() THEN
    RAISE EXCEPTION 'VO_ACTOR_MISMATCH: created_by must be the acting consultant';
  END IF;
  IF NEW.sha256 <> encode(sha256(NEW.content), 'hex') THEN
    RAISE EXCEPTION 'VO_HASH_MISMATCH: the recorded sha256 is not the hash of the stored document';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_report_document_guard
  BEFORE INSERT OR UPDATE OR DELETE ON report_document
  FOR EACH ROW EXECUTE FUNCTION vo_report_document_guard();

CREATE TRIGGER vo_report_document_no_truncate
  BEFORE TRUNCATE ON report_document
  FOR EACH STATEMENT EXECUTE FUNCTION vo_report_issue_no_truncate();
