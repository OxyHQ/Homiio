-- oxy:deploy-phase=pre
-- One row per photo PER REQUEST: Oxy answers the same bytes from the same
-- person with one file, so the same photo may belong to two repairs. Additive;
-- the old table-wide unique on storage_key is dropped in 0040 (post). The table
-- was empty in production on 2026-10-21, so the build is instant.
CREATE UNIQUE INDEX "maintenance_request_attachments_request_storage_key" ON "maintenance_request_attachments" USING btree ("request_id","storage_key");
