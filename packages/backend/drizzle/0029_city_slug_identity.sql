-- oxy:deploy-phase=pre
--
-- A city is one row per region per SLUG, and 102 rows in production were not.
--
-- `cities_region_name_key` was unique on `(region_id, name)`, and `name` is raw
-- text: the index is case-SENSITIVE. Two ingests that disagreed about
-- capitalisation therefore each got a row. A census of production on 2026-09-20
-- (1,660 cities, read through `/api/cities`):
--
--   * 51 groups — 102 rows — share a region and differ only in case
--     (`AARTSELAAR` beside `Aartselaar`, `ANDERLECHT` beside `Anderlecht`);
--   * 94 slugs are used by more than one city;
--   * THREE rows are named Barcelona in Spain, two of them holding no listings.
--
-- That last one is a reported bug, not a tidiness complaint. `placeLookup`
-- resolves a token to a slug and answers an ordered candidate LIST; three
-- candidates for `barcelona` is ambiguity, and ambiguity is refused, because
-- from the outside a duplicate and a homonym look exactly alike (ADR 0002
-- §12.2). So "show me flats in Barcelona" resolved no location and Sindi did
-- nothing. `services/sindiActions.ts` now discounts a candidate holding zero
-- listings, which makes the symptom go away; this is the cause.
--
-- ## The new rule
--
-- `cities.slug` is `GENERATED ALWAYS` from `name` by `placeSlugSql`, so it
-- cannot drift and cannot be written by hand. Two rows in ONE region whose
-- names normalise to the same slug are the same place — which is not an opinion
-- about data quality, it is what the lookup contract already assumes when it
-- resolves an inbound token to a slug. `(region_id, slug)` is therefore the
-- identity, and the name is a label on top of it.
--
-- Duplicate slugs remain legal GLOBALLY: Barcelona in Catalonia and Barcelona
-- in Anzoátegui are different regions and both keep their row. The condition
-- ADR 0002 exists to answer is untouched.
--
-- ## What this does NOT do
--
-- `addresses.normalized_key` hashes `city_id`, and it is a plain column that
-- nothing recomputes — deliberately, because re-keying existing buildings would
-- break the dedup `findOrCreateCanonical` depends on (see the column's header).
-- So an address moved here keeps a key computed under the city it came from,
-- and a future ingest of that same building will not dedupe against it. That is
-- the state those rows were already in; this migration does not make it worse
-- and does not pretend to fix it. Re-keying is its own decision with its own
-- census.
--
-- Two other tables carry the same case-sensitive shape and are NOT touched:
-- `regions_country_name_key` (where the duplicates are `Madrid` beside
-- `Comunidad de Madrid` — different names, so a slug would not merge them) and
-- `neighborhoods_city_name_key` (which has no slug column). Both are recorded
-- in `docs/postgres.md`; neither is a rename away.

--> statement-breakpoint
-- FIRST, because the survivor is RENAMED while the rows it is replacing are
-- still there.
--
-- The rename below takes the group's mixed-case spelling, which usually belongs
-- to a row this migration is about to delete — so `SALFORD` becomes `Salford`
-- while the other `Salford` is still present, and the old case-sensitive index
-- refuses it. That is not a hypothetical: it is `23505` on
-- `(region_id, name)=(…, Salford)`, which is how the first attempt at this
-- migration failed in production.
--
-- Deleting the losers before the rename would work too, but it would mean
-- reading every field this migration carries forward into a temp table first,
-- purely to survive the delete. Dropping the index that is being replaced
-- anyway is the smaller change, and it is safe because the whole file runs in
-- one transaction: no other session can insert a duplicate name in the gap
-- before `cities_region_slug_key` exists.
DROP INDEX "cities_region_name_key";
--> statement-breakpoint
-- The survivor of each group, and the name it will carry.
--
-- Survivor: the row holding the most listings, then the oldest, then the lowest
-- id. Correctness does not depend on the choice — every reference is repointed
-- either way — but keeping the row that already holds the listings is what
-- keeps a bookmarked city id pointing at the city somebody actually browsed.
--
-- Name: preferred MIXED-case, because that is the one a human typed —
-- `Aartselaar` over `AARTSELAAR`, `Barcelona` over `barcelona`. It may come
-- from a row that is about to be deleted; both spellings slug identically, so
-- the identity is unaffected either way.
CREATE TEMPORARY TABLE _city_slug_merge AS
WITH ranked AS (
  SELECT
    id,
    region_id,
    slug,
    count(*) OVER (PARTITION BY region_id, slug) AS siblings,
    first_value(id) OVER (
      PARTITION BY region_id, slug
      ORDER BY properties_count DESC, created_at ASC, id ASC
    ) AS keep_id,
    first_value(name) OVER (
      PARTITION BY region_id, slug
      ORDER BY (name <> upper(name) AND name <> lower(name)) DESC,
               properties_count DESC, created_at ASC, id ASC
    ) AS keep_name
  FROM cities
)
SELECT id AS drop_id, keep_id, keep_name
FROM ranked
WHERE siblings > 1 AND id <> keep_id;
--> statement-breakpoint
-- A neighbourhood of a losing city whose NAME already exists under the
-- survivor. `neighborhoods_city_name_key` is case-sensitive too, so these are
-- matched case-INSENSITIVELY: moving `Eixample` under a city that already has
-- `EIXAMPLE` would otherwise leave two rows for one neighbourhood, which is the
-- very duplicate this migration is removing one level up.
CREATE TEMPORARY TABLE _neighborhood_slug_merge AS
SELECT n.id AS drop_id, keep_n.id AS keep_id
FROM _city_slug_merge m
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
FROM _neighborhood_slug_merge m
WHERE a.neighborhood_id = m.drop_id;
--> statement-breakpoint
UPDATE reviews r
SET neighborhood_id = m.keep_id
FROM _neighborhood_slug_merge m
WHERE r.neighborhood_id = m.drop_id;
--> statement-breakpoint
DELETE FROM neighborhoods n
USING _neighborhood_slug_merge m
WHERE n.id = m.drop_id;
--> statement-breakpoint
-- Whatever is left under a losing city has no counterpart, so it moves.
UPDATE neighborhoods n
SET city_id = m.keep_id
FROM _city_slug_merge m
WHERE n.city_id = m.drop_id;
--> statement-breakpoint
UPDATE addresses a
SET city_id = m.keep_id
FROM _city_slug_merge m
WHERE a.city_id = m.drop_id;
--> statement-breakpoint
UPDATE reviews r
SET city_id = m.keep_id
FROM _city_slug_merge m
WHERE r.city_id = m.drop_id;
--> statement-breakpoint
-- The survivor takes the preferred name, the summed listing count — the groups
-- counted disjoint sets of addresses, so the sum is the count, not an estimate
-- — and any optional field it is MISSING and a loser has.
--
-- `last_updated` is not moved: it records when `properties_count` was last
-- RECOMPUTED, and this is arithmetic over counts that were already stored, not
-- a recount.
--
-- The coordinate pair and the bbox quad are filled all-or-none. A `coalesce`
-- per column would be free to take a latitude from one row and a longitude from
-- another, which is a point in neither city, and the bbox has a CHECK that
-- forbids a partial box outright.
UPDATE cities c
SET
  name = agg.keep_name,
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
    min(m.keep_name) AS keep_name,
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
  FROM _city_slug_merge m
  JOIN cities losing ON losing.id = m.drop_id
  GROUP BY m.keep_id
) agg
WHERE c.id = agg.keep_id;
--> statement-breakpoint
-- Every FK into `cities` is ON DELETE RESTRICT, so a referencing table this
-- migration failed to repoint aborts here rather than losing a row. That is the
-- check, and it is why there is no separate one.
DELETE FROM cities c
USING _city_slug_merge m
WHERE c.id = m.drop_id;
--> statement-breakpoint
DROP TABLE _neighborhood_slug_merge;
--> statement-breakpoint
DROP TABLE _city_slug_merge;
--> statement-breakpoint
CREATE UNIQUE INDEX "cities_region_slug_key" ON "cities" USING btree ("region_id","slug");
