-- oxy:deploy-phase=pre
--
-- The schema half of #295: a city's URL-safe label, computed by the database,
-- plus the four columns a candidate's bounds will live in.
--
-- PHASE: `pre`. Every statement is additive — two `ADD COLUMN` groups, one
-- `CREATE INDEX`, one CHECK over columns that did not exist a statement earlier
-- and are therefore NULL on every row. Nothing is dropped, renamed or narrowed,
-- so the image currently serving is unaffected and the one arriving finds it all
-- in place.
--
-- `slug` is `GENERATED ALWAYS`, so it cannot drift from the name it derives
-- from. It is a LABEL and not an identity: duplicates across regions are normal
-- and are exactly what `db/geo/placeLookup.ts` answers with an ordered candidate
-- list rather than a row. That is also why `cities_slug_idx` is a plain btree
-- and not a unique index — forbidding the duplicate would forbid the data.
--
-- The transliteration table is spelled out here rather than expressed with
-- `unaccent()` because both `unaccent` overloads are STABLE on this server
-- (measured on `postgis/postgis:17-3.5`), and a generated column — like an index
-- expression — requires IMMUTABLE. `db/geo/placeSlug.ts` is the single source
-- this text was emitted from, and carries the reasoning, including why the
-- leading `regexp_replace` strips U+0300–U+036F.
--
-- LOCKS: a STORED generated column rewrites the table, and the CHECK and index
-- take ACCESS EXCLUSIVE for their duration. On the current row count (1,660
-- cities, measured 2026-08-06 and recorded in migration 0001) that is
-- milliseconds. If `cities` is materially larger when this runs, build the index
-- CONCURRENTLY out of band instead — drizzle's migrator wraps a migration in one
-- transaction, which `CREATE INDEX CONCURRENTLY` cannot join.
--
-- BACKFILL: none, and none is possible — a generated column is computed for
-- every existing row by the ALTER itself. The four `bbox_*` columns are NULL for
-- every row on purpose: #351's geocoding gateway is their writer, and
-- `placeLookup` omits `bounds` rather than inventing an envelope.
ALTER TABLE "cities" ADD COLUMN "slug" text GENERATED ALWAYS AS (regexp_replace(
    regexp_replace(
      translate(replace(replace(replace(replace(replace(regexp_replace(lower(name), '[\u0300-\u036F]', '', 'g'), 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), 'þ', 'th'), 'ĳ', 'ij'), 'àáâãäåāăąçćčĉċďđðèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľłñńņňòóôõöøōŏőŕŗřśŝşšșţťŧțùúûüũūŭůűųŵýÿŷźżž', 'aaaaaaaaacccccdddeeeeeeeeegggghhiiiiiiiiijkllllnnnnooooooooorrrsssssttttuuuuuuuuuuwyyyzzz'),
      '[^a-z0-9]+', '-', 'g'
    ),
    '^-+|-+$', '', 'g'
  )) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "bbox_west" double precision;--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "bbox_south" double precision;--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "bbox_east" double precision;--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "bbox_north" double precision;--> statement-breakpoint
CREATE INDEX "cities_slug_idx" ON "cities" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_bbox_complete_check" CHECK ((
        "cities"."bbox_west" is null and "cities"."bbox_south" is null
        and "cities"."bbox_east" is null and "cities"."bbox_north" is null
      ) or (
        "cities"."bbox_west" is not null and "cities"."bbox_south" is not null
        and "cities"."bbox_east" is not null and "cities"."bbox_north" is not null
      ));