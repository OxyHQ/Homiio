-- oxy:deploy-phase=pre
CREATE TABLE "eviction_team_chat_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"actor_oxy_user_id" text NOT NULL,
	"action" text NOT NULL,
	"subject_oxy_user_id" text,
	"target_account_ids" text[] NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "eviction_team_chat_operations_action_check" CHECK ("eviction_team_chat_operations"."action" in ('open', 'add', 'remove')),
	CONSTRAINT "eviction_team_chat_operations_members_check" CHECK (cardinality("eviction_team_chat_operations"."target_account_ids") between 1 and 256)
);
--> statement-breakpoint
CREATE TABLE "eviction_team_chats" (
	"case_id" text PRIMARY KEY NOT NULL,
	"reference_ciphertext" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eviction_team_chat_operations" ADD CONSTRAINT "eviction_team_chat_operations_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_team_chats" ADD CONSTRAINT "eviction_team_chats_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_team_chat_operations_pending_key" ON "eviction_team_chat_operations" USING btree ("case_id") WHERE not "eviction_team_chat_operations"."finalized";