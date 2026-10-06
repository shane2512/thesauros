CREATE TABLE "agent_wallet_registry" (
	"owner_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"agent_wallet_address" text NOT NULL,
	"agent_wallet_ref" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_wallet_registry_owner_address_chain_id_pk" PRIMARY KEY("owner_address","chain_id"),
	CONSTRAINT "agent_wallet_registry_agent_wallet_address_unique" UNIQUE("agent_wallet_address")
);
--> statement-breakpoint
-- Append-only: an owner's agent wallet is permanent. Rows are never updated, deleted or truncated.
CREATE OR REPLACE FUNCTION agent_wallet_registry_no_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'agent_wallet_registry is append-only: % is not allowed', TG_OP USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agent_wallet_registry_no_mutation
	BEFORE UPDATE OR DELETE ON "agent_wallet_registry"
	FOR EACH ROW EXECUTE FUNCTION agent_wallet_registry_no_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_wallet_registry_no_truncate
	BEFORE TRUNCATE ON "agent_wallet_registry"
	FOR EACH STATEMENT EXECUTE FUNCTION agent_wallet_registry_no_mutation();
--> statement-breakpoint
-- Backfill from wallets that already have an agent wallet; the oldest wallet per owner and chain wins.
INSERT INTO "agent_wallet_registry" ("owner_address", "chain_id", "agent_wallet_address", "agent_wallet_ref", "created_at")
SELECT DISTINCT ON (u."owner_address", w."chain_id")
	u."owner_address", w."chain_id", w."agent_wallet_address", w."agent_wallet_ref", now()
FROM "wallets" w
JOIN "users" u ON u."id" = w."user_id"
WHERE w."agent_wallet_address" IS NOT NULL AND w."agent_wallet_ref" IS NOT NULL
ORDER BY u."owner_address", w."chain_id", w."created_at"
ON CONFLICT DO NOTHING;
