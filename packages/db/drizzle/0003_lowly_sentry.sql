CREATE TYPE "public"."paymaster_policy_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."paymaster_sponsor_mode" AS ENUM('sponsored', 'self_pay');--> statement-breakpoint
CREATE TYPE "public"."risk_tier" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "paymaster_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"circle_policy_id" text,
	"per_tx_cap_micro_usd" numeric(78,0) NOT NULL,
	"daily_cap_micro_usd" numeric(78,0) NOT NULL,
	"max_operations_per_day" integer,
	"sponsor_mode" "paymaster_sponsor_mode" DEFAULT 'sponsored' NOT NULL,
	"status" "paymaster_policy_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "paymaster_policies_caps_check" CHECK ("paymaster_policies"."per_tx_cap_micro_usd" >= 0 and "paymaster_policies"."daily_cap_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "screens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"recipient_id" uuid NOT NULL,
	"risk_tier" "risk_tier" NOT NULL,
	"evidence" jsonb NOT NULL,
	"screened_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_chain_id_check";--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "chain_id" integer DEFAULT 5042002 NOT NULL;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "dest_chain_id" integer;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "paymaster_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "chain_id" integer DEFAULT 5042002 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "risk_tier" "risk_tier" DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "last_screened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paymaster_policies" ADD CONSTRAINT "paymaster_policies_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screens" ADD CONSTRAINT "screens_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screens_recipient_screened_idx" ON "screens" USING btree ("recipient_id","screened_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_paymaster_policy_id_paymaster_policies_id_fk" FOREIGN KEY ("paymaster_policy_id") REFERENCES "public"."paymaster_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_chain_id_check" CHECK ("wallets"."chain_id" in (5042002, 5042));