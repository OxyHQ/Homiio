-- oxy:deploy-phase=post
-- Homiio's own bucket is retired (docs/oxy-files.md): every `images` row names
-- an Oxy file, and no maintenance attachment names a bucket key. `post`
-- because it narrows: an image still running the previous release could write
-- a bucket-only row (a pre-Oxy upload published late) until it is gone.
-- `keys_original` stays: the legacy door's redirect looks a row up by it.
ALTER TABLE "images" DROP CONSTRAINT "images_storage_check";--> statement-breakpoint
ALTER TABLE "maintenance_request_attachments" DROP CONSTRAINT "maintenance_request_attachments_private_key_check";--> statement-breakpoint
ALTER TABLE "images" DROP COLUMN "keys_small";--> statement-breakpoint
ALTER TABLE "images" DROP COLUMN "keys_medium";--> statement-breakpoint
ALTER TABLE "images" DROP COLUMN "keys_large";--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_storage_check" CHECK ("images"."oxy_file_id" is not null and "images"."oxy_file_owner" is not null
          and "images"."oxy_file_status" is not null and "images"."oxy_file_visibility" is not null);--> statement-breakpoint
ALTER TABLE "maintenance_request_attachments" ADD CONSTRAINT "maintenance_request_attachments_private_key_check" CHECK ("maintenance_request_attachments"."storage_key" ~ '^oxy:[A-Za-z0-9_-]{1,128}$');