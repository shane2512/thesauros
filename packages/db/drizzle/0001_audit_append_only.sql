-- I6: audit_log is append-only. INSERT and SELECT only; UPDATE/DELETE/TRUNCATE always raise.
CREATE OR REPLACE FUNCTION audit_log_no_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_mutation
	BEFORE UPDATE OR DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION audit_log_no_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
	BEFORE TRUNCATE ON "audit_log"
	FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_mutation();
--> statement-breakpoint
-- Defence in depth for deployments where the app connects as a non-owner role. The migration runs as the
-- table owner (and in tests the app role IS the owner, which bypasses table privileges), so this only
-- removes the default PUBLIC grants; see PROGRESS D-15 for the production role setup.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM PUBLIC;
