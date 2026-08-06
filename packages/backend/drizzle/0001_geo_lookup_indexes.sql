-- oxy:deploy-phase=pre
--
-- The four lookup indexes batch 1's ported read paths need, and that migration
-- 0000 could not have known about: it created the tables, this creates the
-- indexes the ported QUERIES turned out to want.
--
-- PHASE: `pre`. Four `CREATE INDEX` statements and nothing else — no drop, no
-- rename, no narrowed constraint — so the image currently serving is unaffected
-- and the one arriving finds them already in place.
--
-- `addresses_street_trgm_idx` — `addressController.searchAddresses` matches
-- `street` with an unanchored, case-insensitive term. Mongo indexed that with
-- nothing at all (an unanchored `/i` regex is a collection scan) and `ILIKE
-- '%…%'` only uses an index with `gin_trgm_ops`, so this is the "add the index
-- Mongo needed and lacked" case rather than a port.
--
-- The three `(<parent_id>, lower(name))` btrees back the SCOPED case-insensitive
-- equality lookups (`getCityByLocation`, `resolveRegionRef`,
-- `getNeighborhoodByName?city=`). They are not duplicates of the unscoped
-- `*_name_lower_idx` indexes 0000 created, which serve the UNSCOPED resolvers in
-- `geoQueryService`, and they are not served by the unique `(parent, name)`
-- indexes either — those are case-SENSITIVE. Names collide across parents by
-- design: "Valencia" is a province in Spain and a state in Venezuela, and
-- "Centro" is a neighborhood in most Spanish-speaking cities on earth.
--
-- All four are ordinary `CREATE INDEX`, i.e. they take an ACCESS EXCLUSIVE lock
-- for the duration of the build. On the current row counts (1,660 cities, 4,521
-- neighborhoods, 211 regions, 11,734 addresses — measured 2026-08-06) that is
-- milliseconds. If any of these tables is materially larger when this runs,
-- rebuild them CONCURRENTLY out of band instead; drizzle's migrator wraps a
-- migration in a transaction and `CREATE INDEX CONCURRENTLY` cannot run inside
-- one.
CREATE INDEX "addresses_street_trgm_idx" ON "addresses" USING gin ("street" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cities_region_name_lower_idx" ON "cities" USING btree ("region_id",lower("name"));--> statement-breakpoint
CREATE INDEX "neighborhoods_city_name_lower_idx" ON "neighborhoods" USING btree ("city_id",lower("name"));--> statement-breakpoint
CREATE INDEX "regions_country_name_lower_idx" ON "regions" USING btree ("country_id",lower("name"));