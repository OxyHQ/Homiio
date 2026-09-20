-- oxy:deploy-phase=pre
--
-- REAL VIEWING AVAILABILITY (#518 §7.5, #519 §7.5). An owner can say when they
-- may be asked to show a home; a viewing gains a LENGTH, a MODALITY, a ZONE and
-- the owner's REPLY. Until now the thirteen time slots on the booking screen
-- were a hardcoded list in the client, the conflict rule was
-- `scheduled_at = scheduled_at`, and "10:00" was anchored in whichever zone the
-- API container booted in.
--
-- PRE: one CREATE TABLE, one foreign key into a table that already exists, and
-- four columns ADDED — three of them NOT NULL DEFAULT, one nullable. All of it
-- is invisible to an image that does not know about it: drizzle names its
-- columns explicitly, so the old image never selects the new ones and never
-- writes the new table, and nothing it does can be broken by their being there.
-- The new image needs every one of them the moment it starts — a viewing insert
-- names `duration_minutes` and `modality` — which is what makes `pre` the only
-- correct phase. A `post` run would leave the API answering 500 to every
-- viewing request for the length of the rollout, which is the exact failure
-- this domain was already fixed for once.
--
-- The three `ADD COLUMN ... DEFAULT` statements are safe on a live table
-- without a rewrite: since Postgres 11 a DEFAULT on ADD COLUMN is stored in the
-- catalogue rather than written into every row, so each takes ACCESS EXCLUSIVE
-- for the catalogue update only. `viewing_requests` is empty in production in
-- any case, and the defaults are the honest backfill rather than a convenient
-- one: every request that exists was made under a screen that offered half-hour
-- in-person visits and nothing else, so `30` and `'in_person'` describe what
-- those rows already meant.
--
-- WHY `duration_minutes` HAS A CEILING, AND WHY THE CEILING IS LOAD-BEARING
--
-- `viewing_requests_duration_check` is not hygiene. The overlap query
-- (`db/bookings/viewingReads.ts#findOverlappingViewing`) bounds its index scan
-- with `scheduled_at >= :instant - MAX_VIEWING_DURATION_MINUTES`, and that
-- bound is only EXHAUSTIVE because this constraint says no appointment can run
-- longer. Widen it without widening the query and the conflict check silently
-- stops finding the appointments that start furthest back.
--
-- There is no GiST index on the viewing range, and that is a refusal from the
-- server rather than a preference: the range is
-- `tstzrange(scheduled_at, scheduled_at + make_interval(mins => duration))`,
-- `timestamptz + interval` is STABLE (`pg_proc.provolatile` = `s` for
-- `timestamptz_pl_interval`, measured on this image) and an expression index
-- requires IMMUTABLE. The existing `(property_id, scheduled_at, status)` btree
-- plus the constant bound above is what serves the overlap instead.
--
-- `viewing_requests_owner_response_status_check` is ONE-WAY, unlike
-- `viewing_requests_cancelled_by_status_check` beside it, and the asymmetry is
-- deliberate: a decline with no words is an ordinary decline, while words on a
-- request nobody has answered are a message the requester would be shown and
-- the owner never sent.
--
-- `property_viewing_windows` CASCADEs from `properties`, which is the opposite
-- of what `viewing_requests` does and for the reason `CONVENTIONS.md` gives: a
-- window is a statement about an advertisement's availability and is
-- meaningless without it, in the same class as `property_availability_windows`,
-- while a viewing is a record of a human arrangement. The expiry sweep hard
-- deletes external listings continuously, so a RESTRICT here would abort sweep
-- batches on a schedule.
--
-- IT HAS NO EXPIRY, AND THAT IS A DECISION
--
-- No `expires_at`, no entry in `db/expiry.ts`. A weekly recurrence has no
-- deadline, and the table is bounded by the listings it hangs off — a handful
-- of rows per property, deleted with it — rather than by time. A deadline here
-- would quietly stop a home being visitable on a date nobody chose, which is
-- the kind of TTL `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE` exists to name.
--
-- `property_viewing_windows_slot_key` is total rather than partial: every
-- column in it is NOT NULL and the rule really is total. It deliberately does
-- NOT forbid two windows that merely overlap in time — an owner offering
-- in-person visits 17:00–20:00 and video 18:00–19:00 on the same evening means
-- both — and the slot generator dedupes what the union produces.
--
-- `property_viewing_windows_holds_a_slot_check` refuses a window shorter than
-- its own slot. Without it, "Tuesday 17:00–17:20, hour-long visits" is a window
-- that offers nothing SILENTLY: the generator emits an empty list and the
-- screen says the owner has published no times, which is both plausible and
-- wrong.
--
-- `properties.viewing_timezone` is nullable and carries NO constraint. An IANA
-- name is a FORMAT, and `db/schema/CONVENTIONS.md` keeps format validators out
-- of the schema; it is checked against `Intl` at the call site, which is the
-- only authority on what a zone name means. NULL means nobody has said, and
-- `db/availability/viewingTimeZone.ts` then falls back to `cities.timezone` and
-- finally to a STATED UTC convention. `cities.timezone` is a fallback rather
-- than the basis because it was checked: the path that creates a city during
-- ordinary address resolution (`services/addressService.ts#upsertCity`) does
-- not write it, and only `scripts/seedGeo.ts`'s six hand-written Spanish cities
-- and an explicit admin create ever do.

CREATE TABLE "property_viewing_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"modality" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "property_viewing_windows_modality_check" CHECK ("property_viewing_windows"."modality" in ('in_person', 'video')),
	CONSTRAINT "property_viewing_windows_weekday_check" CHECK ("property_viewing_windows"."weekday" between 0 and 6),
	CONSTRAINT "property_viewing_windows_start_check" CHECK ("property_viewing_windows"."start_minute" >= 0 and "property_viewing_windows"."start_minute" < 1440),
	CONSTRAINT "property_viewing_windows_end_check" CHECK ("property_viewing_windows"."end_minute" > 0 and "property_viewing_windows"."end_minute" <= 1440),
	CONSTRAINT "property_viewing_windows_order_check" CHECK ("property_viewing_windows"."end_minute" > "property_viewing_windows"."start_minute"),
	CONSTRAINT "property_viewing_windows_slot_minutes_check" CHECK ("property_viewing_windows"."slot_minutes" between 10 and 240),
	CONSTRAINT "property_viewing_windows_holds_a_slot_check" CHECK ("property_viewing_windows"."end_minute" - "property_viewing_windows"."start_minute" >= "property_viewing_windows"."slot_minutes")
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "viewing_timezone" text;--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD COLUMN "duration_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD COLUMN "modality" text DEFAULT 'in_person' NOT NULL;--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD COLUMN "owner_response" text;--> statement-breakpoint
ALTER TABLE "property_viewing_windows" ADD CONSTRAINT "property_viewing_windows_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_viewing_windows_property_weekday_idx" ON "property_viewing_windows" USING btree ("property_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "property_viewing_windows_slot_key" ON "property_viewing_windows" USING btree ("property_id","weekday","start_minute","modality");--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_modality_check" CHECK ("viewing_requests"."modality" in ('in_person', 'video'));--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_duration_check" CHECK ("viewing_requests"."duration_minutes" between 10 and 240);--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_owner_response_status_check" CHECK ("viewing_requests"."owner_response" is null or "viewing_requests"."status" <> 'pending');