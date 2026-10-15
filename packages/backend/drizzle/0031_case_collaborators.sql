-- oxy:deploy-phase=pre
CREATE TABLE "eviction_case_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text,
	"case_reference" text NOT NULL,
	"actor_oxy_user_id" text NOT NULL,
	"subject_oxy_user_id" text,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "eviction_case_changes_action_check" CHECK ("eviction_case_changes"."action" in ('case_created', 'case_updated', 'case_deleted', 'collaborator_added', 'collaborator_removed', 'team_location_read'))
);
--> statement-breakpoint
CREATE TABLE "eviction_case_collaborators" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"added_by_oxy_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eviction_case_changes" ADD CONSTRAINT "eviction_case_changes_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_case_collaborators" ADD CONSTRAINT "eviction_case_collaborators_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eviction_case_changes_case_idx" ON "eviction_case_changes" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_case_collaborators_case_user_key" ON "eviction_case_collaborators" USING btree ("case_id","oxy_user_id");