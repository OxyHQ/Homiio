-- oxy:deploy-phase=pre
--
-- `leases` (+ six child tables), `tenant_applications` (+ two),
-- `reservations`, `viewing_requests`, `exchange_requests` and
-- `exchange_reviews` — everything that books a home for a period of time.
--
-- PHASE: `pre`. Purely additive — fourteen new tables, no drop, no rename and
-- no change to anything migrations 0000-0003 created. Every one of these
-- collections is EMPTY in production, so the CHECK constraints they carry
-- (which are far more numerous than the earlier migrations') reject nothing
-- that exists.
--
-- Three GiST indexes over `tstzrange(...)` arrive here, and they need NO new
-- extension: a range GiST index uses the range opclass core Postgres already
-- ships. `postgis` is installed for `addresses.geo` and is unrelated to these.
-- `leases_term_range_gist` is the one to read twice — it uses CLOSED bounds
-- (`'[]'`), unlike the half-open `'[)'` every other range index in this schema
-- uses, because `Lease.findActive` reads `$lte`/`$gte`. See `db/schema/leases.ts`.
--
CREATE TABLE "exchange_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"requester_oxy_user_id" text NOT NULL,
	"host_oxy_user_id" text NOT NULL,
	"mode" text NOT NULL,
	"offered_property_id" text,
	"requested_window_start" timestamp with time zone NOT NULL,
	"requested_window_end" timestamp with time zone NOT NULL,
	"offered_window_start" timestamp with time zone,
	"offered_window_end" timestamp with time zone,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "exchange_requests_mode_check" CHECK ("exchange_requests"."mode" in ('swap', 'host', 'both')),
	CONSTRAINT "exchange_requests_status_check" CHECK ("exchange_requests"."status" in ('pending', 'confirmed', 'declined', 'cancelled', 'completed')),
	CONSTRAINT "exchange_requests_requested_window_order_check" CHECK ("exchange_requests"."requested_window_end" > "exchange_requests"."requested_window_start"),
	CONSTRAINT "exchange_requests_offered_window_check" CHECK ((
        "exchange_requests"."offered_window_start" is null and "exchange_requests"."offered_window_end" is null
      ) or (
        "exchange_requests"."offered_window_start" is not null and "exchange_requests"."offered_window_end" is not null
          and "exchange_requests"."offered_window_end" > "exchange_requests"."offered_window_start"
      )),
	CONSTRAINT "exchange_requests_host_mode_offers_nothing_check" CHECK ("exchange_requests"."mode" <> 'host' or (
        "exchange_requests"."offered_property_id" is null
        and "exchange_requests"."offered_window_start" is null
        and "exchange_requests"."offered_window_end" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "exchange_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"exchange_request_id" text NOT NULL,
	"reviewer_oxy_user_id" text NOT NULL,
	"subject_oxy_user_id" text NOT NULL,
	"rating" double precision NOT NULL,
	"comment" text,
	"categories_communication" double precision,
	"categories_cleanliness" double precision,
	"categories_accuracy" double precision,
	"categories_hospitality" double precision,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "exchange_reviews_rating_check" CHECK ("exchange_reviews"."rating" between 1 and 5),
	CONSTRAINT "exchange_reviews_categories_range_check" CHECK (("exchange_reviews"."categories_communication" is null or "exchange_reviews"."categories_communication" between 1 and 5)
        and ("exchange_reviews"."categories_cleanliness" is null or "exchange_reviews"."categories_cleanliness" between 1 and 5)
        and ("exchange_reviews"."categories_accuracy" is null or "exchange_reviews"."categories_accuracy" between 1 and 5)
        and ("exchange_reviews"."categories_hospitality" is null or "exchange_reviews"."categories_hospitality" between 1 and 5)),
	CONSTRAINT "exchange_reviews_distinct_parties_check" CHECK ("exchange_reviews"."reviewer_oxy_user_id" <> "exchange_reviews"."subject_oxy_user_id")
);
--> statement-breakpoint
CREATE TABLE "lease_co_tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"role" text DEFAULT 'secondary' NOT NULL,
	"signed_date" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "lease_co_tenants_role_check" CHECK ("lease_co_tenants"."role" in ('primary', 'secondary', 'guarantor')),
	CONSTRAINT "lease_co_tenants_status_check" CHECK ("lease_co_tenants"."status" in ('pending', 'signed', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "lease_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"uploaded_by_oxy_user_id" text NOT NULL,
	"uploaded_date" timestamp with time zone NOT NULL,
	CONSTRAINT "lease_documents_type_check" CHECK ("lease_documents"."type" in ('lease_agreement', 'addendum', 'inspection_report', 'insurance', 'other'))
);
--> statement-breakpoint
CREATE TABLE "lease_inspection_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"inspection_id" text NOT NULL,
	"area" text,
	"condition" text,
	"description" text,
	"photos" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "lease_inspection_findings_condition_check" CHECK ("lease_inspection_findings"."condition" in ('excellent', 'good', 'fair', 'poor', 'needs_repair'))
);
--> statement-breakpoint
CREATE TABLE "lease_inspections" (
	"id" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"type" text NOT NULL,
	"scheduled_date" timestamp with time zone NOT NULL,
	"completed_date" timestamp with time zone,
	"inspector" text NOT NULL,
	"notes" text,
	"signed_by_tenant" boolean DEFAULT false NOT NULL,
	"signed_by_landlord" boolean DEFAULT false NOT NULL,
	CONSTRAINT "lease_inspections_type_check" CHECK ("lease_inspections"."type" in ('move_in', 'move_out', 'periodic', 'maintenance'))
);
--> statement-breakpoint
CREATE TABLE "lease_payment_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"amount" double precision NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_date" timestamp with time zone,
	"paid_amount" double precision,
	"payment_method" text,
	"transaction_id" text,
	CONSTRAINT "lease_payment_schedule_type_check" CHECK ("lease_payment_schedule"."type" in ('rent', 'deposit', 'fee', 'utility')),
	CONSTRAINT "lease_payment_schedule_status_check" CHECK ("lease_payment_schedule"."status" in ('pending', 'paid', 'overdue', 'cancelled')),
	CONSTRAINT "lease_payment_schedule_method_check" CHECK ("lease_payment_schedule"."payment_method" in ('cash', 'check', 'bank_transfer', 'credit_card', 'debit_card', 'digital_wallet')),
	CONSTRAINT "lease_payment_schedule_paid_evidence_check" CHECK ((
        "lease_payment_schedule"."status" = 'paid'
          and "lease_payment_schedule"."paid_date" is not null and "lease_payment_schedule"."paid_amount" is not null
      ) or (
        "lease_payment_schedule"."status" <> 'paid'
          and "lease_payment_schedule"."paid_date" is null and "lease_payment_schedule"."paid_amount" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "lease_shared_utility_costs" (
	"id" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"utility" text,
	"split_percentage" double precision,
	CONSTRAINT "lease_shared_utility_costs_utility_check" CHECK ("lease_shared_utility_costs"."utility" in ('electricity', 'gas', 'water', 'trash', 'internet', 'cable', 'heat', 'air_conditioning')),
	CONSTRAINT "lease_shared_utility_costs_split_check" CHECK ("lease_shared_utility_costs"."split_percentage" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"room_id" text,
	"landlord_oxy_user_id" text NOT NULL,
	"tenant_oxy_user_id" text NOT NULL,
	"lease_terms_start_date" timestamp with time zone NOT NULL,
	"lease_terms_end_date" timestamp with time zone NOT NULL,
	"lease_terms_renewal_options" text DEFAULT 'none' NOT NULL,
	"lease_terms_renewal_notice_required" bigint DEFAULT 30 NOT NULL,
	"lease_terms_termination_notice_required" bigint DEFAULT 30 NOT NULL,
	"rent_details_monthly_rent" double precision NOT NULL,
	"rent_details_currency" text DEFAULT 'USD' NOT NULL,
	"rent_details_due_date" bigint DEFAULT 1 NOT NULL,
	"rent_details_late_fee_amount" double precision DEFAULT 0 NOT NULL,
	"rent_details_late_fee_grace_period" bigint DEFAULT 5 NOT NULL,
	"rent_details_security_deposit" double precision DEFAULT 0 NOT NULL,
	"rent_details_pet_deposit" double precision DEFAULT 0 NOT NULL,
	"utilities_included" text[] DEFAULT '{}'::text[] NOT NULL,
	"utilities_tenant_responsible" text[] DEFAULT '{}'::text[] NOT NULL,
	"rules_pets_allowed" boolean DEFAULT false NOT NULL,
	"rules_pets_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"rules_pets_max_number" bigint DEFAULT 0 NOT NULL,
	"rules_pets_restrictions" text[] DEFAULT '{}'::text[] NOT NULL,
	"rules_smoking" boolean DEFAULT false NOT NULL,
	"rules_guests_overnight_allowed" boolean DEFAULT true NOT NULL,
	"rules_guests_overnight_max_consecutive_days" bigint DEFAULT 7 NOT NULL,
	"rules_guests_overnight_max_days_per_month" bigint DEFAULT 14 NOT NULL,
	"rules_guests_parties" boolean DEFAULT false NOT NULL,
	"rules_subletting" boolean DEFAULT false NOT NULL,
	"rules_alterations" boolean DEFAULT false NOT NULL,
	"signatures_landlord_signed" boolean DEFAULT false NOT NULL,
	"signatures_landlord_signed_date" timestamp with time zone,
	"signatures_landlord_digital_signature" text,
	"signatures_tenant_signed" boolean DEFAULT false NOT NULL,
	"signatures_tenant_signed_date" timestamp with time zone,
	"signatures_tenant_digital_signature" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"termination_notice_given_by_oxy_user_id" text,
	"termination_notice_given_date" timestamp with time zone,
	"termination_notice_effective_date" timestamp with time zone,
	"termination_notice_reason" text,
	"termination_notice_acknowledged" boolean DEFAULT false NOT NULL,
	"termination_notice_acknowledged_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "leases_status_check" CHECK ("leases"."status" in ('draft', 'pending_signatures', 'active', 'expired', 'terminated', 'cancelled')),
	CONSTRAINT "leases_renewal_options_check" CHECK ("leases"."lease_terms_renewal_options" in ('none', 'automatic', 'optional')),
	CONSTRAINT "leases_rent_currency_check" CHECK ("leases"."rent_details_currency" in ('USD', 'EUR', 'GBP', 'CAD')),
	CONSTRAINT "leases_utilities_included_check" CHECK ("leases"."utilities_included" <@ array['electricity', 'gas', 'water', 'trash', 'internet', 'cable', 'heat', 'air_conditioning']::text[]),
	CONSTRAINT "leases_utilities_tenant_responsible_check" CHECK ("leases"."utilities_tenant_responsible" <@ array['electricity', 'gas', 'water', 'trash', 'internet', 'cable', 'heat', 'air_conditioning']::text[]),
	CONSTRAINT "leases_rules_pets_types_check" CHECK ("leases"."rules_pets_types" <@ array['dog', 'cat', 'bird', 'fish', 'reptile', 'other']::text[]),
	CONSTRAINT "leases_rent_due_date_check" CHECK ("leases"."rent_details_due_date" between 1 and 31),
	CONSTRAINT "leases_term_order_check" CHECK ("leases"."lease_terms_end_date" > "leases"."lease_terms_start_date")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"guest_oxy_user_id" text NOT NULL,
	"host_oxy_user_id" text NOT NULL,
	"check_in" timestamp with time zone NOT NULL,
	"check_out" timestamp with time zone NOT NULL,
	"guest_count" bigint NOT NULL,
	"nights" bigint NOT NULL,
	"nightly_rate" double precision NOT NULL,
	"subtotal" double precision NOT NULL,
	"cleaning_fee" double precision DEFAULT 0 NOT NULL,
	"service_fee" double precision DEFAULT 0 NOT NULL,
	"taxes" double precision DEFAULT 0 NOT NULL,
	"total" double precision NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"instant_booked" boolean DEFAULT false NOT NULL,
	"cancellation_policy" text NOT NULL,
	"special_requests" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "reservations_status_check" CHECK ("reservations"."status" in ('pending', 'confirmed', 'cancelled', 'completed', 'declined')),
	CONSTRAINT "reservations_cancellation_policy_check" CHECK ("reservations"."cancellation_policy" in ('flexible', 'moderate', 'strict', 'super_strict')),
	CONSTRAINT "reservations_stay_order_check" CHECK ("reservations"."check_out" > "reservations"."check_in"),
	CONSTRAINT "reservations_nights_check" CHECK ("reservations"."nights" >= 1),
	CONSTRAINT "reservations_guest_count_check" CHECK ("reservations"."guest_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "tenant_application_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"filename" text NOT NULL,
	CONSTRAINT "tenant_application_documents_type_check" CHECK ("tenant_application_documents"."type" in ('id', 'income', 'reference', 'other'))
);
--> statement-breakpoint
CREATE TABLE "tenant_application_references" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	CONSTRAINT "tenant_application_references_relationship_check" CHECK ("tenant_application_references"."relationship" in ('landlord', 'employer', 'personal', 'other'))
);
--> statement-breakpoint
CREATE TABLE "tenant_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"applicant_oxy_user_id" text NOT NULL,
	"landlord_oxy_user_id" text NOT NULL,
	"move_in_date" timestamp with time zone NOT NULL,
	"lease_term_months" bigint NOT NULL,
	"monthly_income" double precision NOT NULL,
	"employment_status" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"notes" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "tenant_applications_status_check" CHECK ("tenant_applications"."status" in ('submitted', 'reviewing', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "tenant_applications_employment_status_check" CHECK ("tenant_applications"."employment_status" in ('employed', 'self_employed', 'student', 'retired', 'unemployed', 'other')),
	CONSTRAINT "tenant_applications_decided_at_check" CHECK (("tenant_applications"."status" in ('approved', 'rejected', 'withdrawn'))
        = ("tenant_applications"."decided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "viewing_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"requester_oxy_user_id" text NOT NULL,
	"owner_oxy_user_id" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"cancelled_by" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "viewing_requests_status_check" CHECK ("viewing_requests"."status" in ('pending', 'approved', 'declined', 'cancelled')),
	CONSTRAINT "viewing_requests_cancelled_by_check" CHECK ("viewing_requests"."cancelled_by" in ('requester', 'owner')),
	CONSTRAINT "viewing_requests_cancelled_by_status_check" CHECK (("viewing_requests"."status" = 'cancelled') = ("viewing_requests"."cancelled_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_offered_property_id_properties_id_fk" FOREIGN KEY ("offered_property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_reviews" ADD CONSTRAINT "exchange_reviews_exchange_request_id_exchange_requests_id_fk" FOREIGN KEY ("exchange_request_id") REFERENCES "public"."exchange_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_co_tenants" ADD CONSTRAINT "lease_co_tenants_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_documents" ADD CONSTRAINT "lease_documents_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_inspection_findings" ADD CONSTRAINT "lease_inspection_findings_inspection_id_lease_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."lease_inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_inspections" ADD CONSTRAINT "lease_inspections_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_payment_schedule" ADD CONSTRAINT "lease_payment_schedule_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_shared_utility_costs" ADD CONSTRAINT "lease_shared_utility_costs_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_room_id_properties_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_application_documents" ADD CONSTRAINT "tenant_application_documents_application_id_tenant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tenant_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_application_references" ADD CONSTRAINT "tenant_application_references_application_id_tenant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tenant_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_requests_requested_window_gist" ON "exchange_requests" USING gist (tstzrange("requested_window_start", "requested_window_end"));--> statement-breakpoint
CREATE INDEX "exchange_requests_property_status_idx" ON "exchange_requests" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "exchange_requests_requester_status_created_idx" ON "exchange_requests" USING btree ("requester_oxy_user_id","status","created_at" desc);--> statement-breakpoint
CREATE INDEX "exchange_requests_host_status_created_idx" ON "exchange_requests" USING btree ("host_oxy_user_id","status","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_reviews_request_reviewer_key" ON "exchange_reviews" USING btree ("exchange_request_id","reviewer_oxy_user_id");--> statement-breakpoint
CREATE INDEX "exchange_reviews_subject_created_idx" ON "exchange_reviews" USING btree ("subject_oxy_user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "lease_co_tenants_lease_id_idx" ON "lease_co_tenants" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "lease_documents_lease_id_idx" ON "lease_documents" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "lease_inspection_findings_inspection_id_idx" ON "lease_inspection_findings" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "lease_inspections_lease_id_idx" ON "lease_inspections" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "lease_payment_schedule_lease_due_idx" ON "lease_payment_schedule" USING btree ("lease_id","due_date");--> statement-breakpoint
CREATE INDEX "lease_payment_schedule_due_status_idx" ON "lease_payment_schedule" USING btree ("due_date","status");--> statement-breakpoint
CREATE INDEX "lease_shared_utility_costs_lease_id_idx" ON "lease_shared_utility_costs" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "leases_property_status_idx" ON "leases" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "leases_landlord_status_idx" ON "leases" USING btree ("landlord_oxy_user_id","status");--> statement-breakpoint
CREATE INDEX "leases_tenant_status_idx" ON "leases" USING btree ("tenant_oxy_user_id","status");--> statement-breakpoint
CREATE INDEX "leases_term_range_gist" ON "leases" USING gist (tstzrange("lease_terms_start_date", "lease_terms_end_date", '[]'));--> statement-breakpoint
CREATE INDEX "leases_active_end_date_idx" ON "leases" USING btree ("lease_terms_end_date") WHERE "leases"."status" = 'active';--> statement-breakpoint
CREATE INDEX "reservations_stay_range_gist" ON "reservations" USING gist (tstzrange("check_in", "check_out"));--> statement-breakpoint
CREATE INDEX "reservations_property_check_in_idx" ON "reservations" USING btree ("property_id","check_in");--> statement-breakpoint
CREATE INDEX "reservations_guest_status_idx" ON "reservations" USING btree ("guest_oxy_user_id","status");--> statement-breakpoint
CREATE INDEX "reservations_host_status_created_idx" ON "reservations" USING btree ("host_oxy_user_id","status","created_at" desc);--> statement-breakpoint
CREATE INDEX "tenant_application_documents_application_id_idx" ON "tenant_application_documents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "tenant_application_references_application_id_idx" ON "tenant_application_references" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "tenant_applications_property_status_idx" ON "tenant_applications" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "tenant_applications_applicant_status_idx" ON "tenant_applications" USING btree ("applicant_oxy_user_id","status");--> statement-breakpoint
CREATE INDEX "tenant_applications_landlord_status_submitted_idx" ON "tenant_applications" USING btree ("landlord_oxy_user_id","status","submitted_at" desc);--> statement-breakpoint
CREATE INDEX "viewing_requests_property_scheduled_status_idx" ON "viewing_requests" USING btree ("property_id","scheduled_at","status");--> statement-breakpoint
CREATE INDEX "viewing_requests_owner_scheduled_status_idx" ON "viewing_requests" USING btree ("owner_oxy_user_id","scheduled_at","status");--> statement-breakpoint
CREATE INDEX "viewing_requests_requester_idx" ON "viewing_requests" USING btree ("requester_oxy_user_id");