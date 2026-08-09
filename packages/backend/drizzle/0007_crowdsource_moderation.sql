-- oxy:deploy-phase=pre
--
-- `moderation_reports`, `moderation_outbox`, `moderation_events` and
-- `moderation_enforcements` — the CrowdSource pipeline.
--
-- PHASE: `pre`. Purely additive — four new tables, no drop, no rename and no
-- change to anything earlier migrations created. All four collections are
-- EMPTY in production and `CROWDSOURCE_ENABLED` is absent from both SSM and the
-- live task definition, so nothing has ever written to them.
--
-- Two of these tables take a PRIMARY KEY with NO DEFAULT
-- (`moderation_outbox.id`, `moderation_events.id`) rather than the
-- `generatedId()` every other table uses. That is the mechanism, not an
-- omission: those ids are deterministic and caller-supplied, and minting one
-- would delete the deduplication they exist for. See `db/schema/moderation.ts`.
--
CREATE TABLE "moderation_enforcements" (
	"id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"decision_revision" bigint NOT NULL,
	"action" text NOT NULL,
	"case_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"outcome" text NOT NULL,
	"recommended_action" text,
	"reason" text NOT NULL,
	"mode" text NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp with time zone,
	"skipped_reason" text,
	"previous_state_property_moderation_restricted" boolean,
	"previous_state_review_moderation_status" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "moderation_enforcements_action_check" CHECK ("moderation_enforcements"."action" in ('none', 'restrict', 'restore', 'flag_for_review', 'unflag', 'manual_review')),
	CONSTRAINT "moderation_enforcements_mode_check" CHECK ("moderation_enforcements"."mode" in ('observe', 'manual', 'automatic')),
	CONSTRAINT "moderation_enforcements_previous_review_status_check" CHECK ("moderation_enforcements"."previous_state_review_moderation_status" in ('active', 'under_review', 'removed')),
	CONSTRAINT "moderation_enforcements_decision_revision_check" CHECK ("moderation_enforcements"."decision_revision" >= 1),
	CONSTRAINT "moderation_enforcements_applied_at_check" CHECK ("moderation_enforcements"."applied" = ("moderation_enforcements"."applied_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "moderation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text,
	"case_id" text,
	"payload" jsonb,
	"state" text DEFAULT 'claimed' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"queued_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "moderation_events_state_check" CHECK ("moderation_events"."state" in ('claimed', 'queued', 'ignored')),
	CONSTRAINT "moderation_events_queued_at_check" CHECK (("moderation_events"."state" = 'queued') = ("moderation_events"."queued_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "moderation_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"report_id" text,
	"event_id" text,
	"case_id" text,
	"decision" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "moderation_outbox_kind_check" CHECK ("moderation_outbox"."kind" in ('report.submit', 'decision.apply')),
	CONSTRAINT "moderation_outbox_status_check" CHECK ("moderation_outbox"."status" in ('pending', 'processing', 'processed', 'dead_letter')),
	CONSTRAINT "moderation_outbox_attempts_check" CHECK ("moderation_outbox"."attempts" >= 0),
	CONSTRAINT "moderation_outbox_lease_pair_check" CHECK (("moderation_outbox"."lease_owner" is null) = ("moderation_outbox"."lease_until" is null))
);
--> statement-breakpoint
CREATE TABLE "moderation_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reported_type" text NOT NULL,
	"reported_id" text NOT NULL,
	"reporter_oxy_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"local_status" text DEFAULT 'received' NOT NULL,
	"local_status_reason" text,
	"crowd_source_report_id" text,
	"crowd_source_case_id" text,
	"crowd_source_merged" boolean,
	"submitted_at" timestamp with time zone,
	"decision_id" text,
	"decision_revision" bigint,
	"decision_outcome" text,
	"decision_status" text,
	"decided_at" timestamp with time zone,
	"enforced_action" text,
	"enforced_at" timestamp with time zone,
	"content_snapshot_hash" text,
	"last_delivery_error" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "moderation_reports_reported_type_check" CHECK ("moderation_reports"."reported_type" in ('property', 'review', 'eviction_case')),
	CONSTRAINT "moderation_reports_local_status_check" CHECK ("moderation_reports"."local_status" in ('received', 'queued', 'submitted', 'delivery_failed', 'closed')),
	CONSTRAINT "moderation_reports_enforced_action_check" CHECK ("moderation_reports"."enforced_action" in ('none', 'restrict', 'restore', 'flag_for_review', 'unflag', 'manual_review')),
	CONSTRAINT "moderation_reports_decision_revision_check" CHECK ("moderation_reports"."decision_revision" is null or "moderation_reports"."decision_revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "moderation_outbox" ADD CONSTRAINT "moderation_outbox_report_id_moderation_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."moderation_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_enforcements_decision_action_key" ON "moderation_enforcements" USING btree ("decision_id","decision_revision","action");--> statement-breakpoint
CREATE INDEX "moderation_enforcements_subject_created_idx" ON "moderation_enforcements" USING btree ("subject_type","subject_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "moderation_enforcements_case_id_idx" ON "moderation_enforcements" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "moderation_events_case_id_idx" ON "moderation_events" USING btree ("case_id") WHERE "moderation_events"."case_id" is not null;--> statement-breakpoint
CREATE INDEX "moderation_events_expires_at_idx" ON "moderation_events" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "moderation_events_state_received_idx" ON "moderation_events" USING btree ("state","received_at");--> statement-breakpoint
CREATE INDEX "moderation_outbox_due_idx" ON "moderation_outbox" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "moderation_outbox_lease_idx" ON "moderation_outbox" USING btree ("status","lease_until","created_at");--> statement-breakpoint
CREATE INDEX "moderation_outbox_expires_at_idx" ON "moderation_outbox" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_reports_reporter_object_key" ON "moderation_reports" USING btree ("reporter_oxy_user_id","reported_type","reported_id");--> statement-breakpoint
CREATE INDEX "moderation_reports_local_status_created_idx" ON "moderation_reports" USING btree ("local_status","created_at");--> statement-breakpoint
CREATE INDEX "moderation_reports_object_idx" ON "moderation_reports" USING btree ("reported_type","reported_id");--> statement-breakpoint
CREATE INDEX "moderation_reports_case_id_idx" ON "moderation_reports" USING btree ("crowd_source_case_id") WHERE "moderation_reports"."crowd_source_case_id" is not null;