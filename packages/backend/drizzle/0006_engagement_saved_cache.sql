-- oxy:deploy-phase=pre
--
-- `conversations` (+ two child tables), `notifications`, `saved_items`,
-- `saved_searches`, `saved_property_folders` (+ one), `recently_viewed`,
-- `place_pois` (+ one) — what a person keeps, and what the app tells them.
--
-- PHASE: `pre`. Purely additive — eleven new tables, no drop, no rename and no
-- change to anything earlier migrations created. All eleven collections are
-- EMPTY in production.
--
-- `place_pois.expires_at` is the second entry in `db/expiry.ts` after
-- `properties.expires_at`, and `place_pois_expires_at_idx` is the btree its
-- sweep needs — `findUnsupportedExpiryColumns` fails the build without it.
-- `conversations.sharing_expires_at` gets an index too and deliberately gets NO
-- registry entry: that Mongo TTL deletes the whole conversation, so it is named
-- in `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE` instead.
--
CREATE TABLE "conversation_message_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"type" text,
	"name" text,
	"url" text,
	"size" bigint,
	CONSTRAINT "conversation_message_attachments_type_check" CHECK ("conversation_message_attachments"."type" in ('file', 'image', 'document'))
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"position" bigint NOT NULL,
	CONSTRAINT "conversation_messages_role_check" CHECK ("conversation_messages"."role" in ('user', 'assistant', 'system'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"topic" text DEFAULT 'general' NOT NULL,
	"metadata_initial_message" text,
	"metadata_source" text DEFAULT 'manual' NOT NULL,
	"metadata_language" text DEFAULT 'en' NOT NULL,
	"metadata_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"sharing_is_shared" boolean DEFAULT false NOT NULL,
	"sharing_share_token" text,
	"sharing_shared_at" timestamp with time zone,
	"sharing_expires_at" timestamp with time zone,
	"analytics_last_activity" timestamp with time zone NOT NULL,
	"analytics_total_tokens" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "conversations_status_check" CHECK ("conversations"."status" in ('active', 'archived', 'deleted')),
	CONSTRAINT "conversations_topic_check" CHECK ("conversations"."topic" in ('rent', 'repairs', 'lease', 'rights', 'general')),
	CONSTRAINT "conversations_metadata_source_check" CHECK ("conversations"."metadata_source" in ('quick_action', 'example', 'manual', 'url_share')),
	CONSTRAINT "conversations_sharing_coherent_check" CHECK ((
        "conversations"."sharing_is_shared"
          and "conversations"."sharing_share_token" is not null
          and "conversations"."sharing_shared_at" is not null
          and "conversations"."sharing_expires_at" is not null
      ) or (
        not "conversations"."sharing_is_shared"
          and "conversations"."sharing_share_token" is null
          and "conversations"."sharing_shared_at" is null
          and "conversations"."sharing_expires_at" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_oxy_user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"app" text DEFAULT 'homiio' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "notifications_priority_check" CHECK ("notifications"."priority" in ('low', 'medium', 'high', 'urgent'))
);
--> statement-breakpoint
CREATE TABLE "place_poi_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"place_poi_id" text NOT NULL,
	"key" text NOT NULL,
	"present" boolean DEFAULT false NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"nearest_m" double precision,
	CONSTRAINT "place_poi_categories_key_check" CHECK ("place_poi_categories"."key" in ('pharmacy', 'school', 'hospital', 'police', 'fire_station', 'supermarket', 'transit', 'park', 'bank', 'restaurant', 'gym', 'spa')),
	CONSTRAINT "place_poi_categories_count_check" CHECK ("place_poi_categories"."count" >= 0),
	CONSTRAINT "place_poi_categories_coherent_check" CHECK (("place_poi_categories"."present" = ("place_poi_categories"."count" > 0))
        and ("place_poi_categories"."nearest_m" is null or "place_poi_categories"."present"))
);
--> statement-breakpoint
CREATE TABLE "place_pois" (
	"id" text PRIMARY KEY NOT NULL,
	"cell_key" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_m" bigint NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "place_pois_radius_check" CHECK ("place_pois"."radius_m" >= 1),
	CONSTRAINT "place_pois_coordinates_range_check" CHECK ("place_pois"."lat" between -90 and 90 and "place_pois"."lng" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "recently_viewed" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"property_id" text NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_items" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"notes" text,
	"folder_id" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "saved_items_target_type_check" CHECK ("saved_items"."target_type" in ('property'))
);
--> statement-breakpoint
CREATE TABLE "saved_property_folder_items" (
	"id" text PRIMARY KEY NOT NULL,
	"folder_id" text NOT NULL,
	"property_id" text NOT NULL,
	"notes" text,
	"saved_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_property_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#3B82F6' NOT NULL,
	"icon" text DEFAULT 'folder-outline' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notifications_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_message_attachments" ADD CONSTRAINT "conversation_message_attachments_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_poi_categories" ADD CONSTRAINT "place_poi_categories_place_poi_id_place_pois_id_fk" FOREIGN KEY ("place_poi_id") REFERENCES "public"."place_pois"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recently_viewed" ADD CONSTRAINT "recently_viewed_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_target_id_properties_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_folder_id_saved_property_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."saved_property_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_property_folder_items" ADD CONSTRAINT "saved_property_folder_items_folder_id_saved_property_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."saved_property_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_property_folder_items" ADD CONSTRAINT "saved_property_folder_items_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_message_attachments_message_id_idx" ON "conversation_message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_conversation_position_key" ON "conversation_messages" USING btree ("conversation_id","position");--> statement-breakpoint
CREATE INDEX "conversations_oxy_user_created_idx" ON "conversations" USING btree ("oxy_user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "conversations_oxy_user_status_updated_idx" ON "conversations" USING btree ("oxy_user_id","status","updated_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_share_token_key" ON "conversations" USING btree ("sharing_share_token") WHERE "conversations"."sharing_share_token" is not null;--> statement-breakpoint
CREATE INDEX "conversations_sharing_expires_at_idx" ON "conversations" USING btree ("sharing_expires_at") WHERE "conversations"."sharing_expires_at" is not null;--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_oxy_user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("recipient_oxy_user_id","created_at" desc) WHERE not "notifications"."read";--> statement-breakpoint
CREATE INDEX "notifications_recipient_type_created_idx" ON "notifications" USING btree ("recipient_oxy_user_id","type","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "place_poi_categories_poi_key_key" ON "place_poi_categories" USING btree ("place_poi_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "place_pois_cell_key_key" ON "place_pois" USING btree ("cell_key");--> statement-breakpoint
CREATE INDEX "place_pois_expires_at_idx" ON "place_pois" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recently_viewed_owner_property_key" ON "recently_viewed" USING btree ("oxy_user_id","property_id");--> statement-breakpoint
CREATE INDEX "recently_viewed_owner_viewed_at_idx" ON "recently_viewed" USING btree ("oxy_user_id","viewed_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "saved_items_owner_target_key" ON "saved_items" USING btree ("oxy_user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "saved_items_folder_id_idx" ON "saved_items" USING btree ("folder_id") WHERE "saved_items"."folder_id" is not null;--> statement-breakpoint
CREATE INDEX "saved_items_target_idx" ON "saved_items" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_property_folder_items_key" ON "saved_property_folder_items" USING btree ("folder_id","property_id");--> statement-breakpoint
CREATE INDEX "saved_property_folder_items_property_id_idx" ON "saved_property_folder_items" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_property_folders_owner_name_key" ON "saved_property_folders" USING btree ("oxy_user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "saved_searches_owner_name_key" ON "saved_searches" USING btree ("oxy_user_id","name");--> statement-breakpoint
CREATE INDEX "saved_searches_owner_created_idx" ON "saved_searches" USING btree ("oxy_user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "saved_searches_notifications_enabled_idx" ON "saved_searches" USING btree ("oxy_user_id") WHERE "saved_searches"."notifications_enabled";