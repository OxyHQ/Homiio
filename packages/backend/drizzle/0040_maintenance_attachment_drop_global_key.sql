-- oxy:deploy-phase=post
-- The table-wide unique on storage_key goes once every image runs the code that
-- answers a re-attached photo from the per-request key (0039). Widening only:
-- nothing an old image writes can violate what is left.
DROP INDEX "maintenance_request_attachments_storage_key";
