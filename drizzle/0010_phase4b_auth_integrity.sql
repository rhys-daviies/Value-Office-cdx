-- Phase 4B integrity: sign-in credentials and sessions; audit hardening for a
-- least-privilege application role.
--
-- * Audit functions become SECURITY DEFINER (owned by the migration role), so the
--   application role needs no INSERT privilege on audit_event and cannot forge
--   audit rows directly. Behaviour is otherwise unchanged.
-- * app_credential / app_session are audited with their secrets redacted.
-- * Credentials change only via user.setPassword / user.disable; sessions are
--   created only by auth.signIn for the acting user, and only ever revoked
--   (auth.signOut, user.disable). Neither table allows deletes.

ALTER FUNCTION vo_audit_row() SECURITY DEFINER SET search_path = public, pg_temp;

-- Same as vo_audit_row, but strips the columns named in the trigger arguments.
CREATE FUNCTION vo_audit_row_redacted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  hidden text[] := TG_ARGV::text[];
BEGIN
  INSERT INTO audit_event (transaction_id, actor_user_id, command, table_name, row_id, action, old_row, new_row)
  VALUES (
    txid_current(),
    vo_actor_id(),
    vo_command(),
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) - hidden END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) - hidden END
  );
  RETURN NULL;
END $$;

CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON app_credential
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row_redacted('password_hash');
CREATE TRIGGER vo_audit AFTER INSERT OR UPDATE OR DELETE ON app_session
  FOR EACH ROW EXECUTE FUNCTION vo_audit_row_redacted('token_hash');

-- ---------------------------------------------------------------------------
-- Credentials

CREATE FUNCTION vo_app_credential_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VO_CREDENTIAL_IMMUTABLE: credentials are disabled, never deleted';
  END IF;
  IF cmd = 'user.setPassword' THEN
    IF TG_OP = 'UPDATE' AND NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['password_hash', 'password_set_at']) THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: user.setPassword may only change the password';
    END IF;
    RETURN NEW;
  END IF;
  IF cmd = 'user.disable' AND TG_OP = 'UPDATE' THEN
    IF OLD.disabled_at IS NOT NULL OR NEW.disabled_at IS NULL
       OR NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['disabled_at']) THEN
      RAISE EXCEPTION 'VO_INVALID_TRANSITION: user.disable only sets disabled_at once';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'VO_WRONG_COMMAND: credentials change only via user.setPassword or user.disable (got %)', cmd;
END $$;

CREATE TRIGGER vo_app_credential_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app_credential
  FOR EACH ROW EXECUTE FUNCTION vo_app_credential_guard();

-- ---------------------------------------------------------------------------
-- Sessions

CREATE FUNCTION vo_app_session_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cmd text := vo_command();
  actor uuid := vo_actor_id();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VO_SESSION_IMMUTABLE: sessions are revoked, never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF cmd <> 'auth.signIn' THEN
      RAISE EXCEPTION 'VO_WRONG_COMMAND: sessions are created only by auth.signIn (got %)', cmd;
    END IF;
    IF NEW.user_id <> actor THEN
      RAISE EXCEPTION 'VO_ACTOR_MISMATCH: a session can only be created for the signing-in consultant';
    END IF;
    IF NEW.revoked_at IS NOT NULL OR NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'VO_INVALID_INPUT: a new session must be unrevoked and unexpired';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: revocation only.
  IF cmd NOT IN ('auth.signOut', 'user.disable') THEN
    RAISE EXCEPTION 'VO_WRONG_COMMAND: sessions are revoked only by auth.signOut or user.disable (got %)', cmd;
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
     OR NOT vo_only_changed(to_jsonb(OLD), to_jsonb(NEW), ARRAY['revoked_at']) THEN
    RAISE EXCEPTION 'VO_INVALID_TRANSITION: a session can only be revoked, once';
  END IF;
  IF cmd = 'auth.signOut' AND OLD.user_id <> actor THEN
    RAISE EXCEPTION 'VO_ACTOR_MISMATCH: consultants can only sign out their own sessions';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER vo_app_session_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app_session
  FOR EACH ROW EXECUTE FUNCTION vo_app_session_guard();
