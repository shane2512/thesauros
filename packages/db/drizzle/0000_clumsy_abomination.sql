CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('pending', 'submitted', 'confirmed', 'failed', 'timeout', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."mandate_template" AS ENUM('startup', 'dao', 'creator', 'custom');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('inapp', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('execution', 'escalation', 'blocked', 'risk', 'freeze', 'report');--> statement-breakpoint
CREATE TYPE "public"."obligation_status" AS ENUM('scheduled', 'paid', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('draft', 'active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."recipient_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."recurrence" AS ENUM('none', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."spend_permission_status" AS ENUM('pending', 'approved_onchain', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."verdict_decision" AS ENUM('ALLOW', 'ESCALATE', 'DENY');--> statement-breakpoint
CREATE TABLE "agent_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"context_snapshot" jsonb NOT NULL,
	"context_hash" text NOT NULL,
	"screen" jsonb,
	"proposal" jsonb,
	"proposal_hash" text,
	"proposal_source" text NOT NULL,
	"verifier" jsonb,
	"serv_meta" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"proposal_hash" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"signature" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wallet_id" uuid,
	"actor" text NOT NULL,
	"event" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"payload" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"row_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_check" CHECK ("audit_log"."actor" in ('agent', 'owner', 'system'))
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"proposal_hash" text NOT NULL,
	"kind" text NOT NULL,
	"calls_hash" text NOT NULL,
	"user_op_hash" text,
	"tx_hash" text,
	"status" "execution_status" DEFAULT 'pending' NOT NULL,
	"gas_used" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"execution_id" uuid,
	"token" text NOT NULL,
	"amount" numeric(78,0) NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"counterparty_label" text,
	"usd_micro" numeric(78,0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"text" text NOT NULL,
	"template" "mandate_template" NOT NULL,
	"compiled_draft" jsonb,
	"assumptions" jsonb,
	"questions" jsonb,
	"prompt_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb,
	"read_at" timestamp with time zone,
	"channel" "notification_channel" DEFAULT 'inapp' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"amount" numeric(78,0) NOT NULL,
	"due_date" date NOT NULL,
	"recurrence" "recurrence" DEFAULT 'none' NOT NULL,
	"status" "obligation_status" DEFAULT 'scheduled' NOT NULL,
	"paid_execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obligations_amount_check" CHECK ("obligations"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"wallet_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"mandate_id" uuid,
	"body" jsonb NOT NULL,
	"body_hash" text NOT NULL,
	"signature" text,
	"status" "policy_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "policies_wallet_id_version_pk" PRIMARY KEY("wallet_id","version")
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"micro_usd" numeric(78,0) NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet_id" uuid NOT NULL,
	"proposal_hash" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"max_per_tx" numeric(78,0) NOT NULL,
	"schedule" jsonb,
	"added_signature" text,
	"status" "recipient_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipients_max_per_tx_check" CHECK ("recipients"."max_per_tx" >= 0)
);
--> statement-breakpoint
CREATE TABLE "simulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"calls" jsonb NOT NULL,
	"calls_hash" text NOT NULL,
	"ok" boolean NOT NULL,
	"deltas" jsonb,
	"error" text,
	"block_number" numeric(78,0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"permission" jsonb NOT NULL,
	"signature" text NOT NULL,
	"permission_hash" text NOT NULL,
	"status" "spend_permission_status" DEFAULT 'pending' NOT NULL,
	"approved_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_address" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_owner_address_unique" UNIQUE("owner_address")
);
--> statement-breakpoint
CREATE TABLE "vault_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wallet_id" uuid NOT NULL,
	"vault_id" text NOT NULL,
	"share_price" numeric(78,0) NOT NULL,
	"total_assets" numeric(78,0) NOT NULL,
	"position_assets" numeric(78,0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_snapshots_nonneg" CHECK ("vault_snapshots"."share_price" >= 0 and "vault_snapshots"."total_assets" >= 0 and "vault_snapshots"."position_assets" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" text NOT NULL,
	"wallet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"asset_address" text NOT NULL,
	"kind" text DEFAULT 'erc4626' NOT NULL,
	"max_allocation_bps" integer NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"flagged_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vaults_id_wallet_id_pk" PRIMARY KEY("id","wallet_id"),
	CONSTRAINT "vaults_bps_check" CHECK ("vaults"."max_allocation_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"decision" "verdict_decision" NOT NULL,
	"results" jsonb NOT NULL,
	"policy_version" integer NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"treasury_address" text NOT NULL,
	"agent_wallet_address" text,
	"agent_wallet_ref" jsonb,
	"frozen" boolean DEFAULT false NOT NULL,
	"frozen_at" timestamp with time zone,
	"frozen_reason" text,
	"breaker_failures" integer DEFAULT 0 NOT NULL,
	"breaker_open" boolean DEFAULT false NOT NULL,
	"active_policy_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_agent_wallet_address_unique" UNIQUE("agent_wallet_address"),
	CONSTRAINT "wallets_chain_id_check" CHECK ("wallets"."chain_id" in (84532, 8453))
);
--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decision_id_agent_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."agent_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_decision_id_agent_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."agent_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_nonces" ADD CONSTRAINT "receipt_nonces_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_decision_id_agent_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."agent_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_permissions" ADD CONSTRAINT "spend_permissions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_snapshots" ADD CONSTRAINT "vault_snapshots_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_decision_id_agent_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."agent_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_decisions_wallet_created_idx" ON "agent_decisions" USING btree ("wallet_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_wallet_id_idx" ON "audit_log" USING btree ("wallet_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_wallet_proposal_hash_uq" ON "executions" USING btree ("wallet_id","proposal_hash");--> statement-breakpoint
CREATE INDEX "ledger_entries_wallet_created_idx" ON "ledger_entries" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_one_active_per_wallet" ON "policies" USING btree ("wallet_id") WHERE "policies"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "recipients_wallet_address_uq" ON "recipients" USING btree ("wallet_id","address");