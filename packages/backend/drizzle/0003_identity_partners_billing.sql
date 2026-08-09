-- oxy:deploy-phase=pre
--
-- `profiles` (+ five child tables), `agencies`, `partners`, `commissions` and
-- `billing` (+ one child table) — the identity and referral half of the
-- remaining schema.
--
-- PHASE: `pre`. Additive: ten new tables, plus TWO new FOREIGN KEY constraints
-- on `properties` (`agency_id -> agencies`, `sourced_by_partner_id ->
-- partners`). An added constraint is a narrowing, so it deserves its own
-- sentence rather than the blanket "purely additive" the earlier migrations
-- carry: it is `pre`-safe here because the census measured both columns and
-- neither can be violated. `sourced_by_partner_id` is ABSENT on all 17,644
-- production rows, and `agency_id` will be populated by the same backfill that
-- creates the `agencies` rows it points at, so at the instant this runs both
-- columns are empty. The image currently serving reads none of these tables and
-- writes neither column (both are absent from `CREATABLE_PROPERTY_FIELDS` and
-- `EDITABLE_PROPERTY_FIELDS`).
--
-- The two constraints CLOSE `DEFERRED_FOREIGN_KEYS`, which migration 0001
-- opened. `__tests__/db/foreignKeys.test.ts` would have gone red on this
-- migration otherwise, which is exactly what that ledger is for.
--
CREATE TABLE "agencies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "agencies_normalized_name_not_empty_check" CHECK (length("agencies"."normalized_name") > 0),
	CONSTRAINT "agencies_slug_not_empty_check" CHECK (length("agencies"."slug") > 0)
);
--> statement-breakpoint
CREATE TABLE "billing" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"plus_active" boolean DEFAULT false NOT NULL,
	"plus_since" timestamp with time zone,
	"plus_canceled_at" timestamp with time zone,
	"plus_stripe_subscription_id" text,
	"file_credits" bigint DEFAULT 0 NOT NULL,
	"last_payment_at" timestamp with time zone,
	"founder_supporter" boolean DEFAULT false NOT NULL,
	"founder_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "billing_file_credits_non_negative_check" CHECK ("billing"."file_credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_processed_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"billing_id" text NOT NULL,
	"session_id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"property_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"basis_offering" text NOT NULL,
	"basis_deal_value" double precision NOT NULL,
	"basis_kind" text NOT NULL,
	"basis_rate" double precision,
	"basis_flat" double precision,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "commissions_status_check" CHECK ("commissions"."status" in ('pending', 'approved', 'paid', 'cancelled')),
	CONSTRAINT "commissions_basis_offering_check" CHECK ("commissions"."basis_offering" in ('rent', 'sale', 'exchange')),
	CONSTRAINT "commissions_basis_kind_check" CHECK ("commissions"."basis_kind" in ('percentOfMonthlyRent', 'flat')),
	CONSTRAINT "commissions_basis_components_check" CHECK ((
        "commissions"."basis_kind" = 'percentOfMonthlyRent'
          and "commissions"."basis_rate" is not null and "commissions"."basis_flat" is null
      ) or (
        "commissions"."basis_kind" = 'flat'
          and "commissions"."basis_flat" is not null and "commissions"."basis_rate" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"referral_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"points" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "partners_status_check" CHECK ("partners"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "profile_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"position" double precision NOT NULL,
	CONSTRAINT "profile_chat_messages_role_check" CHECK ("profile_chat_messages"."role" in ('user', 'assistant', 'system'))
);
--> statement-breakpoint
CREATE TABLE "profile_preferred_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"city" text,
	"state" text,
	"radius" double precision
);
--> statement-breakpoint
CREATE TABLE "profile_references" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text,
	"email" text,
	"verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "profile_references_relationship_check" CHECK ("profile_references"."relationship" in ('landlord', 'employer', 'personal', 'other'))
);
--> statement-breakpoint
CREATE TABLE "profile_rental_history" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"address" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"monthly_rent" double precision,
	"reason_for_leaving" text,
	"landlord_contact_name" text,
	"landlord_contact_phone" text,
	"landlord_contact_email" text,
	"verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "profile_rental_history_reason_for_leaving_check" CHECK ("profile_rental_history"."reason_for_leaving" in ('lease_ended', 'bought_home', 'job_relocation', 'family_reasons', 'upgrade', 'other')),
	CONSTRAINT "profile_rental_history_order_check" CHECK ("profile_rental_history"."end_date" is null or "profile_rental_history"."end_date" >= "profile_rental_history"."start_date")
);
--> statement-breakpoint
CREATE TABLE "profile_roommate_history" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"location" text NOT NULL,
	"roommate_count" double precision,
	"reason" text,
	CONSTRAINT "profile_roommate_history_order_check" CHECK ("profile_roommate_history"."end_date" is null or "profile_roommate_history"."end_date" >= "profile_roommate_history"."start_date")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"personal_info_bio" text,
	"personal_info_occupation" text,
	"personal_info_employer" text,
	"personal_info_annual_income" double precision,
	"personal_info_employment_status" text,
	"personal_info_move_in_date" timestamp with time zone,
	"personal_info_lease_duration" text,
	"preferences_property_types" text[],
	"preferences_max_rent" double precision,
	"preferences_price_unit" text,
	"preferences_min_bedrooms" double precision,
	"preferences_min_bathrooms" double precision,
	"preferences_preferred_amenities" text[],
	"preferences_pet_friendly" boolean,
	"preferences_smoking_allowed" boolean,
	"preferences_furnished" boolean,
	"preferences_parking_required" boolean,
	"preferences_accessibility" boolean,
	"verification_identity" boolean,
	"verification_income" boolean,
	"verification_background" boolean,
	"verification_rental_history" boolean,
	"verification_references" boolean,
	"settings_notifications_email" boolean,
	"settings_notifications_push" boolean,
	"settings_notifications_sms" boolean,
	"settings_notifications_property_alerts" boolean,
	"settings_notifications_viewing_reminders" boolean,
	"settings_notifications_lease_updates" boolean,
	"settings_privacy_profile_visibility" text,
	"settings_privacy_show_contact_info" boolean,
	"settings_privacy_show_income" boolean,
	"settings_privacy_show_rental_history" boolean,
	"settings_privacy_show_references" boolean,
	"settings_roommate_enabled" boolean,
	"settings_roommate_preferences_age_range_min" double precision,
	"settings_roommate_preferences_age_range_max" double precision,
	"settings_roommate_preferences_gender" text,
	"settings_roommate_preferences_lifestyle_smoking" text,
	"settings_roommate_preferences_lifestyle_pets" text,
	"settings_roommate_preferences_lifestyle_partying" text,
	"settings_roommate_preferences_lifestyle_cleanliness" text,
	"settings_roommate_preferences_lifestyle_schedule" text,
	"settings_roommate_preferences_budget_min" double precision,
	"settings_roommate_preferences_budget_max" double precision,
	"settings_roommate_preferences_move_in_date" timestamp with time zone,
	"settings_roommate_preferences_lease_duration" text,
	"settings_language" text,
	"settings_timezone" text,
	"settings_currency" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "profiles_personal_info_employment_status_check" CHECK ("profiles"."personal_info_employment_status" in ('employed', 'self_employed', 'student', 'retired', 'unemployed', 'other')),
	CONSTRAINT "profiles_personal_info_lease_duration_check" CHECK ("profiles"."personal_info_lease_duration" in ('monthly', '3_months', '6_months', 'yearly', 'flexible')),
	CONSTRAINT "profiles_preferences_price_unit_check" CHECK ("profiles"."preferences_price_unit" in ('day', 'night', 'week', 'month', 'year')),
	CONSTRAINT "profiles_preferences_property_types_check" CHECK ("profiles"."preferences_property_types" <@ array['apartment', 'house', 'room', 'studio', 'couchsurfing', 'roommates', 'coliving', 'hostel', 'guesthouse', 'campsite', 'boat', 'treehouse', 'yurt', 'other']::text[]),
	CONSTRAINT "profiles_settings_privacy_profile_visibility_check" CHECK ("profiles"."settings_privacy_profile_visibility" in ('public', 'private', 'contacts_only')),
	CONSTRAINT "profiles_settings_roommate_gender_check" CHECK ("profiles"."settings_roommate_preferences_gender" in ('male', 'female', 'any')),
	CONSTRAINT "profiles_settings_roommate_smoking_check" CHECK ("profiles"."settings_roommate_preferences_lifestyle_smoking" in ('yes', 'no', 'prefer_not')),
	CONSTRAINT "profiles_settings_roommate_pets_check" CHECK ("profiles"."settings_roommate_preferences_lifestyle_pets" in ('yes', 'no', 'prefer_not')),
	CONSTRAINT "profiles_settings_roommate_partying_check" CHECK ("profiles"."settings_roommate_preferences_lifestyle_partying" in ('yes', 'no', 'prefer_not')),
	CONSTRAINT "profiles_settings_roommate_cleanliness_check" CHECK ("profiles"."settings_roommate_preferences_lifestyle_cleanliness" in ('very_clean', 'clean', 'average', 'relaxed')),
	CONSTRAINT "profiles_settings_roommate_schedule_check" CHECK ("profiles"."settings_roommate_preferences_lifestyle_schedule" in ('early_bird', 'night_owl', 'flexible')),
	CONSTRAINT "profiles_settings_roommate_lease_duration_check" CHECK ("profiles"."settings_roommate_preferences_lease_duration" in ('monthly', '3_months', '6_months', 'yearly', 'flexible'))
);
--> statement-breakpoint
ALTER TABLE "billing_processed_sessions" ADD CONSTRAINT "billing_processed_sessions_billing_id_billing_id_fk" FOREIGN KEY ("billing_id") REFERENCES "public"."billing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_chat_messages" ADD CONSTRAINT "profile_chat_messages_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_preferred_locations" ADD CONSTRAINT "profile_preferred_locations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_references" ADD CONSTRAINT "profile_references_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_rental_history" ADD CONSTRAINT "profile_rental_history_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_roommate_history" ADD CONSTRAINT "profile_roommate_history_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agencies_normalized_name_key" ON "agencies" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "agencies_slug_key" ON "agencies" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "agencies_name_trgm_idx" ON "agencies" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "billing_oxy_user_id_key" ON "billing" USING btree ("oxy_user_id");--> statement-breakpoint
CREATE INDEX "billing_plus_active_idx" ON "billing" USING btree ("plus_active") WHERE "billing"."plus_active";--> statement-breakpoint
CREATE UNIQUE INDEX "billing_plus_stripe_subscription_id_key" ON "billing" USING btree ("plus_stripe_subscription_id") WHERE "billing"."plus_stripe_subscription_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_processed_sessions_key" ON "billing_processed_sessions" USING btree ("billing_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commissions_property_id_key" ON "commissions" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "commissions_partner_created_idx" ON "commissions" USING btree ("partner_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "commissions_status_idx" ON "commissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_oxy_user_id_key" ON "partners" USING btree ("oxy_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_referral_code_key" ON "partners" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "partners_status_idx" ON "partners" USING btree ("status");--> statement-breakpoint
CREATE INDEX "profile_chat_messages_profile_position_idx" ON "profile_chat_messages" USING btree ("profile_id","position");--> statement-breakpoint
CREATE INDEX "profile_preferred_locations_profile_id_idx" ON "profile_preferred_locations" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_references_profile_id_idx" ON "profile_references" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_rental_history_profile_id_idx" ON "profile_rental_history" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_roommate_history_profile_id_idx" ON "profile_roommate_history" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_oxy_user_id_key" ON "profiles" USING btree ("oxy_user_id");--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_sourced_by_partner_id_partners_id_fk" FOREIGN KEY ("sourced_by_partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;