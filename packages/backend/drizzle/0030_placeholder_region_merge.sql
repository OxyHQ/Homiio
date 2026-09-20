-- oxy:deploy-phase=pre
--
-- A city that failed to geocode a province is not a second city.
--
-- `upsertGeoChain` falls back to a region literally named `Unknown` when a
-- geocode returns no administrative region, because the three parent references
-- on `addresses` are NOT NULL and dropping a listing is worse than bucketing
-- one. The cost was recorded in ADR 0001 §1.3 and never paid: the bucket
-- manufactures a SECOND city row for a place that already has one under its
-- real region.
--
-- Census of production, 2026-09-20, read through `/api/cities`:
--
--     cities parked in the placeholder region `Unknown`          10
--     …of which have a twin with the same country and slug
--        in a REAL region                                        10   (all of them)
--
-- Berlin, Bremen, Dortmund, Düsseldorf, Frankfurt am Main, Hamburg, Köln,
-- Leipzig, München, Stuttgart. Every large German city in the table.
--
-- ## What it broke
--
-- `placeLookup` answers a token with an ordered candidate LIST and refuses to
-- choose between candidates, because from the outside a duplicate and a homonym
-- are identical (ADR 0002 §12.2). Two Hamburgs is two candidates, so
-- `/api/cities/lookup?city=hamburg` answers `ambiguous` and
-- `services/sindiActions.ts` resolves no location — "muéstrame pisos en
-- Hamburg" produced no action at all. Reported by the user twice.
--
-- Migration 0029 could not fix it and said so: it folds duplicates WITHIN one
-- region, and these two rows are in different regions by construction.
--
-- ## The rule, and where it stops
--
-- A placeholder-region city folds into its twin only when the twin is UNIQUE —
-- exactly one city with the same `country_id` and the same slug in a region
-- that is not the placeholder. That restraint is the whole rule:
--
--   * exactly one  -> it is that place, and the geocoder merely omitted the
--                     province. Fold it.
--   * several      -> we genuinely do not know which. This is ADR 0001 §1.3's
--                     measured `Santiago` case, where two different cities both
--                     landed in the bucket. Folding into the most popular one
--                     would be the homonym bug wearing a repair's clothes, so
--                     the placeholder row stays and stays ambiguous.
--   * none         -> nothing to fold into. It stays.
--
-- `addresses.region_id` is repointed too, which 0029 never had to do: it merged
-- rows inside ONE region, so the column could not disagree. Here the regions
-- differ, and an address left pointing at `Unknown` while its city points at
-- Hamburg is a row whose two parents contradict each other.
--
-- The emptied `Unknown` regions are NOT deleted. A region row is cheap, the
-- fallback still writes to it whenever a geocode omits a province, and deleting
-- one would only mean `upsertRegion` recreates it on the next such listing.

--> statement-breakpoint
-- The placeholder rows that have exactly one real-region twin, and the twin.
CREATE TEMPORARY TABLE _placeholder_city_merge AS
WITH placeholder AS (
  SELECT c.id, c.country_id, c.slug
  FROM cities c
  JOIN regions r ON r.id = c.region_id
  WHERE r.name = 'Unknown'
),
twins AS (
  SELECT
    p.id AS drop_id,
    count(*) AS twin_count,
    (array_agg(real.id ORDER BY real.properties_count DESC, real.created_at ASC, real.id ASC))[1] AS keep_id
  FROM placeholder p
  JOIN cities real
    ON real.country_id = p.country_id
   AND real.slug = p.slug
   AND real.id <> p.id
  JOIN regions rr ON rr.id = real.region_id AND rr.name <> 'Unknown'
  GROUP BY p.id
)
SELECT drop_id, keep_id
FROM twins
WHERE twin_count = 1;
--> statement-breakpoint
-- A neighbourhood of a folded city whose name already exists under the twin.
-- Matched case-INSENSITIVELY, for the same reason 0029 did: leaving two rows
-- for one neighbourhood is the duplicate this migration removes, one level
-- down.
CREATE TEMPORARY TABLE _placeholder_neighborhood_merge AS
SELECT n.id AS drop_id, keep_n.id AS keep_id
FROM _placeholder_city_merge m
JOIN neighborhoods n ON n.city_id = m.drop_id
JOIN LATERAL (
  SELECT kn.id
  FROM neighborhoods kn
  WHERE kn.city_id = m.keep_id AND lower(kn.name) = lower(n.name)
  ORDER BY kn.created_at ASC, kn.id ASC
  LIMIT 1
) keep_n ON true;
--> statement-breakpoint
UPDATE addresses a
SET neighborhood_id = m.keep_id
FROM _placeholder_neighborhood_merge m
WHERE a.neighborhood_id = m.drop_id;
--> statement-breakpoint
UPDATE reviews r
SET neighborhood_id = m.keep_id
FROM _placeholder_neighborhood_merge m
WHERE r.neighborhood_id = m.drop_id;
--> statement-breakpoint
DELETE FROM neighborhoods n
USING _placeholder_neighborhood_merge m
WHERE n.id = m.drop_id;
--> statement-breakpoint
UPDATE neighborhoods n
SET city_id = m.keep_id
FROM _placeholder_city_merge m
WHERE n.city_id = m.drop_id;
--> statement-breakpoint
-- BOTH parents move together. An address whose city says Hamburg and whose
-- region still says `Unknown` is a row that contradicts itself, and nothing
-- downstream would notice.
UPDATE addresses a
SET city_id = m.keep_id,
    region_id = keep.region_id
FROM _placeholder_city_merge m
JOIN cities keep ON keep.id = m.keep_id
WHERE a.city_id = m.drop_id;
--> statement-breakpoint
UPDATE reviews r
SET city_id = m.keep_id
FROM _placeholder_city_merge m
WHERE r.city_id = m.drop_id;
--> statement-breakpoint
-- The twin takes the summed listing count and any optional field it is missing.
-- It does NOT take the placeholder's NAME: the twin is the row under the real
-- region, so its spelling is the one an operator or a geocode with a province
-- produced, and the bucketed row has no claim on it.
UPDATE cities c
SET
  properties_count = c.properties_count + agg.extra_properties,
  timezone = coalesce(c.timezone, agg.timezone),
  population = coalesce(c.population, agg.population),
  description = coalesce(c.description, agg.description),
  average_rent = coalesce(c.average_rent, agg.average_rent),
  cover_image_id = coalesce(c.cover_image_id, agg.cover_image_id),
  latitude = CASE WHEN c.latitude IS NULL AND c.longitude IS NULL
                  THEN agg.latitude ELSE c.latitude END,
  longitude = CASE WHEN c.latitude IS NULL AND c.longitude IS NULL
                   THEN agg.longitude ELSE c.longitude END,
  bbox_west = CASE WHEN c.bbox_west IS NULL THEN agg.bbox_west ELSE c.bbox_west END,
  bbox_south = CASE WHEN c.bbox_west IS NULL THEN agg.bbox_south ELSE c.bbox_south END,
  bbox_east = CASE WHEN c.bbox_west IS NULL THEN agg.bbox_east ELSE c.bbox_east END,
  bbox_north = CASE WHEN c.bbox_west IS NULL THEN agg.bbox_north ELSE c.bbox_north END
FROM (
  SELECT
    m.keep_id,
    sum(losing.properties_count)::int AS extra_properties,
    (array_remove(array_agg(losing.timezone ORDER BY losing.id), NULL))[1] AS timezone,
    (array_remove(array_agg(losing.population ORDER BY losing.id), NULL))[1] AS population,
    (array_remove(array_agg(losing.description ORDER BY losing.id), NULL))[1] AS description,
    (array_remove(array_agg(losing.average_rent ORDER BY losing.id), NULL))[1] AS average_rent,
    (array_remove(array_agg(losing.cover_image_id ORDER BY losing.id), NULL))[1] AS cover_image_id,
    (array_remove(array_agg(
       CASE WHEN losing.latitude IS NOT NULL AND losing.longitude IS NOT NULL
            THEN losing.latitude END ORDER BY losing.id), NULL))[1] AS latitude,
    (array_remove(array_agg(
       CASE WHEN losing.latitude IS NOT NULL AND losing.longitude IS NOT NULL
            THEN losing.longitude END ORDER BY losing.id), NULL))[1] AS longitude,
    (array_remove(array_agg(
       CASE WHEN losing.bbox_west IS NOT NULL THEN losing.bbox_west END ORDER BY losing.id), NULL))[1] AS bbox_west,
    (array_remove(array_agg(
       CASE WHEN losing.bbox_west IS NOT NULL THEN losing.bbox_south END ORDER BY losing.id), NULL))[1] AS bbox_south,
    (array_remove(array_agg(
       CASE WHEN losing.bbox_west IS NOT NULL THEN losing.bbox_east END ORDER BY losing.id), NULL))[1] AS bbox_east,
    (array_remove(array_agg(
       CASE WHEN losing.bbox_west IS NOT NULL THEN losing.bbox_north END ORDER BY losing.id), NULL))[1] AS bbox_north
  FROM _placeholder_city_merge m
  JOIN cities losing ON losing.id = m.drop_id
  GROUP BY m.keep_id
) agg
WHERE c.id = agg.keep_id;
--> statement-breakpoint
-- Every FK into `cities` is ON DELETE RESTRICT, so a referencing table this
-- missed aborts the migration rather than losing a row. That is the check.
DELETE FROM cities c
USING _placeholder_city_merge m
WHERE c.id = m.drop_id;
--> statement-breakpoint
DROP TABLE _placeholder_neighborhood_merge;
--> statement-breakpoint
DROP TABLE _placeholder_city_merge;
