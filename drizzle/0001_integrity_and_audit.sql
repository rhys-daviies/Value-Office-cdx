-- Value Office: integrity, immutability and audit foundation.
--
-- 1. Command context: every mutation of an authoritative table must run inside a
--    named command that has set `vo.actor_id` and `vo.command` (transaction-local).
-- 2. Audit: one generic AFTER trigger writes an append-only audit_event row per
--    row change, attributable to actor + command + transaction + timestamp.
-- 3. Immutability & state machine for Value Case versions and their contents.
--
-- Command names referenced here must match src/server/commands/names.ts.

-- ---------------------------------------------------------------------------
-- 1. Command context

CREATE FUNCTION vo_actor_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v text := current_setting('vo.actor_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'VO_NO_COMMAND_CONTEXT: mutations must run inside a named command (vo.actor_id not set)';
  END IF;
  RETURN v::uuid;
END $$;

CREATE FUNCTION vo_command() RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v text := current_setting('vo.command', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'VO_NO_COMMAND_CONTEXT: mutations must run inside a named command (vo.command not set)';
  END IF;
  RETURN v;
END $$;

-- True when OLD and NEW differ only in the listed columns.
CREATE FUNCTION vo_only_changed(old_row jsonb, new_row jsonb, cols text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (old_row - cols) = (new_row - cols)
$$;

-- ---------------------------------------------------------------------------
-- 2. Audit

CREATE FUNCTION vo_audit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_event (transaction_id, actor_user_id, command, table_name, row_id, action, old_row, new_row)
  VALUES (
    txid_current(),
    vo_actor_id(),
    vo_command(),
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_user', 'client', 'project', 'key_date', 'person', 'project_stakeholder',
    'document', 'evidence', 'information_request', 'information_request_item',
    'value_case', 'value_case_version', 'value_driver', 'value_driver_version',
    'assumption', 'evidence_link'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vo_audit_row()',
      t
    );
  END LOOP;
END $$;

CREATE FUNCTION vo_audit_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'VO_AUDIT_APPEND_ONLY: audit_event rows cannot be modified or deleted';
END $$;

CREATE TRIGGER vo_audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION vo_audit_event_append_only();

CREATE TRIGGER vo_audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION vo_audit_event_append_only();

-- ---------------------------------------------------------------------------
-- 3a. Value Case version state machine
--
--   V0 (inherited_business_case): draft -> recorded
--   V1 (value_case):              draft <-> proposed -> authorised
--   authorised -> superseded      only via an approved Value Change (not yet implemented)
--
-- recorded / authorised / superseded versions are immutable.

CREATE FUNCTION vo_value_case_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  actor uuid := vo_actor_id();
  vco uuid;
  basis text;
  driver_count int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'VO_VERSION_INSERT_NOT_DRAFT: value case versions must be created as draft (got %)', NEW.status;
    END IF;
    IF NEW.created_by <> actor THEN
      RAISE EXCEPTION 'VO_ACTOR_MISMATCH: created_by must be the acting consultant';
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
  IF OLD.status IN ('recorded', 'authorised', 'superseded') THEN
    IF OLD.status = 'authorised' AND NEW.status = 'superseded' THEN
      RAISE EXCEPTION 'VO_VALUE_CHANGE_REQUIRED: superseding an authorised version requires an approved Value Change (not yet implemented)';
    END IF;
    RAISE EXCEPTION 'VO_VERSION_IMMUTABLE: version % is % and cannot be modified', OLD.version_number, OLD.status;
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
    IF cmd <> 'valueCase.proposeVersion' THEN
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
    IF cmd <> 'valueCase.returnVersionToDraft' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: returning to draft requires valueCase.returnVersionToDraft (got %)', cmd;
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'proposed_at', 'proposed_by']) THEN
      RAISE EXCEPTION 'VO_VERSION_FIELD_IMMUTABLE: returning to draft may only change status and proposal fields';
    END IF;
    RETURN NEW;
  END IF;

  -- proposed -> authorised: the initial (V1) VCO authorisation path
  IF OLD.status = 'proposed' AND NEW.status = 'authorised' THEN
    IF cmd <> 'valueCase.authoriseInitialVersion' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: authorisation requires valueCase.authoriseInitialVersion (got %)', cmd;
    END IF;
    IF NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY[
         'status', 'authorised_on', 'authorised_by_person_id', 'authorisation_evidence_id',
         'authorisation_note', 'authorisation_recorded_by', 'authorisation_recorded_at']) THEN
      RAISE EXCEPTION 'VO_VERSION_FIELD_IMMUTABLE: authorisation may only change status and authorisation fields';
    END IF;
    IF EXISTS (
      SELECT 1 FROM value_case_version v
      WHERE v.value_case_id = NEW.value_case_id AND v.id <> NEW.id
        AND v.status IN ('authorised', 'superseded')
    ) THEN
      RAISE EXCEPTION 'VO_VALUE_CHANGE_REQUIRED: this Value Case already has an authorised version; further versions require an approved Value Change (not yet implemented)';
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

  RAISE EXCEPTION 'VO_INVALID_TRANSITION: % -> % is not a permitted version transition', OLD.status, NEW.status;
END $$;

CREATE TRIGGER vo_value_case_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON value_case_version
  FOR EACH ROW EXECUTE FUNCTION vo_value_case_version_guard();

-- ---------------------------------------------------------------------------
-- 3b. Version contents are editable only while the parent version is draft.

CREATE FUNCTION vo_require_draft_version(version_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  s version_status;
  n int;
BEGIN
  SELECT status, version_number INTO s, n FROM value_case_version WHERE id = version_id;
  IF s IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'VO_VERSION_IMMUTABLE: version % is % and its contents cannot be modified', n, s;
  END IF;
END $$;

CREATE FUNCTION vo_value_driver_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM vo_require_draft_version(OLD.value_case_version_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM vo_require_draft_version(NEW.value_case_version_id);
  END IF;
  IF TG_OP = 'UPDATE' AND (
       NEW.value_case_version_id <> OLD.value_case_version_id
    OR NEW.value_driver_id <> OLD.value_driver_id) THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: a driver version cannot move between versions or drivers';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_value_driver_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON value_driver_version
  FOR EACH ROW EXECUTE FUNCTION vo_value_driver_version_guard();

CREATE FUNCTION vo_assumption_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT value_case_version_id INTO v FROM value_driver_version WHERE id = OLD.value_driver_version_id;
    PERFORM vo_require_draft_version(v);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT value_case_version_id INTO v FROM value_driver_version WHERE id = NEW.value_driver_version_id;
    PERFORM vo_require_draft_version(v);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.value_driver_version_id <> OLD.value_driver_version_id THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: an assumption cannot move between driver versions';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_assumption_guard
  BEFORE INSERT OR UPDATE OR DELETE ON assumption
  FOR EACH ROW EXECUTE FUNCTION vo_assumption_guard();

CREATE FUNCTION vo_evidence_link_version(link evidence_link) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT value_case_version_id FROM value_driver_version WHERE id = link.value_driver_version_id),
    (SELECT d.value_case_version_id FROM assumption a
       JOIN value_driver_version d ON d.id = a.value_driver_version_id
      WHERE a.id = link.assumption_id)
  )
$$;

CREATE FUNCTION vo_evidence_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: evidence links cannot be edited; delete and re-create while the version is draft';
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM vo_require_draft_version(vo_evidence_link_version(OLD));
    RETURN OLD;
  END IF;
  PERFORM vo_require_draft_version(vo_evidence_link_version(NEW));
  RETURN NEW;
END $$;

CREATE TRIGGER vo_evidence_link_guard
  BEFORE INSERT OR UPDATE OR DELETE ON evidence_link
  FOR EACH ROW EXECUTE FUNCTION vo_evidence_link_guard();

-- ---------------------------------------------------------------------------
-- 3c. Stable identities and locked references

CREATE FUNCTION vo_value_driver_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: value driver identity (code) cannot be changed';
END $$;

CREATE TRIGGER vo_value_driver_guard
  BEFORE UPDATE ON value_driver
  FOR EACH ROW EXECUTE FUNCTION vo_value_driver_guard();

-- Project Value Basis and currency are locked once any version is proposed or authorised.
CREATE FUNCTION vo_project_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.currency, NEW.value_basis_description, NEW.value_period_start, NEW.value_period_end)
     IS DISTINCT FROM (OLD.currency, OLD.value_basis_description, OLD.value_period_start, OLD.value_period_end)
     AND EXISTS (
       SELECT 1 FROM value_case_version v
       WHERE v.project_id = OLD.id AND v.status IN ('proposed', 'authorised', 'superseded')
     ) THEN
    RAISE EXCEPTION 'VO_VALUE_BASIS_LOCKED: currency and Value Basis cannot change once a Value Case version is proposed or authorised';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_project_guard
  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION vo_project_guard();

-- A document's identity (what it points at) never changes; record a new document instead.
CREATE FUNCTION vo_document_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.project_id, NEW.uri, NEW.storage_key, NEW.sha256, NEW.original_filename, NEW.mime_type, NEW.size_bytes)
     IS DISTINCT FROM
     (OLD.project_id, OLD.uri, OLD.storage_key, OLD.sha256, OLD.original_filename, OLD.mime_type, OLD.size_bytes) THEN
    RAISE EXCEPTION 'VO_FIELD_IMMUTABLE: document location, hash and file metadata cannot change; record a new document';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_document_guard
  BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION vo_document_guard();

-- Evidence relied on by a non-draft version (linked or as authorisation evidence) is frozen.
CREATE FUNCTION vo_evidence_is_locked(evidence_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM value_case_version v
    WHERE v.authorisation_evidence_id = evidence_id AND v.status <> 'draft'
  ) OR EXISTS (
    SELECT 1 FROM evidence_link l
    JOIN value_case_version v ON v.id = vo_evidence_link_version(l)
    WHERE l.evidence_id = evidence_id AND v.status <> 'draft'
  )
$$;

CREATE FUNCTION vo_evidence_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF vo_evidence_is_locked(OLD.id) THEN
    RAISE EXCEPTION 'VO_EVIDENCE_LOCKED: evidence % is relied on by a locked Value Case version; record superseding evidence instead', OLD.code;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER vo_evidence_guard
  BEFORE UPDATE OR DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION vo_evidence_guard();
