-- oxy:deploy-phase=pre
--
-- GUEST POINTS (#518 §7.5, #519 §7.5). A ledger of nights: hosting one night
-- earns one point, staying one night costs one. The rate is 1 in both
-- directions and is not a column — the reasoning is in
-- `shared-types/src/guestPoints.ts`, stated once.
--
-- PRE: one CREATE TABLE, one foreign key into a table that already exists, and
-- one column ADDED to `exchange_requests` with a NOT NULL DEFAULT false. Every
-- one of those is invisible to an image that does not know about it: the old
-- image never selects the new column (drizzle names its columns explicitly,
-- so `select *` widening is not in play), never writes the new table, and
-- cannot be broken by either being there. The new image needs all three the
-- moment it starts, which is what makes `pre` the only correct phase — a
-- `post` run would leave the API answering 500 on any points request for the
-- length of the rollout.
--
-- `uses_guest_points boolean NOT NULL DEFAULT false` is safe as a single
-- statement on a live table: since Postgres 11 a DEFAULT on ADD COLUMN is
-- stored in the catalogue rather than rewritten into every row, so this takes
-- an ACCESS EXCLUSIVE lock for the catalogue update only and does not scan
-- `exchange_requests`. `false` is also the semantically correct backfill: every
-- request that exists today is free hosting, and a default of true would
-- retroactively charge people for stays they were given.
--
-- The two unique indexes carry different guarantees and neither substitutes for
-- the other:
--
--   `..._idempotency_key` is (account_oxy_user_id, idempotency_key) and answers
--   a retried request and a double tap — the caller supplies the same key. Per
--   ACCOUNT, because the account is what a balance is computed over and
--   therefore what a duplicate row would corrupt.
--
--   `..._request_direction_key` is (exchange_request_id, direction) and answers
--   a replayed ACCEPT, from a different caller with a different key: one stay
--   charges its guest once and credits its host once, whatever arrives twice.
--   Total rather than partial, because both columns are NOT NULL and the rule
--   really is total.
--
-- Neither index prevents the case this domain actually has to get right — two
-- DIFFERENT stays spending the same point. That is a lost update, not a
-- duplicate, and it is prevented by the row lock in
-- `db/guestPoints/guestPointsLedger.ts` rather than by anything here.
--
-- `..._settled_check`, `..._released_check` and
-- `..._release_reason_presence_check` are all TWO-WAY for the reason
-- `lease_payment_movements_confirmed_check` is: a date or a reason sitting
-- beside a movement that is not in that state is a value a screen will render,
-- and rendering it is the only way anybody would find out.
--
-- `..._earn_settles_check` says a host is credited at the moment they accept
-- and never holds a reserved balance they cannot use.
-- `..._distinct_parties_check` says nobody hosts themselves, which would
-- otherwise be a loop that mints points out of nothing.
--
-- `exchange_requests_points_mode_check` restricts points to a one-way `host`
-- stay: a swap is already reciprocal, so charging one side points takes payment
-- for a night that side is also receiving.
--
-- `exchange_request_id` is NOT NULL, and that is the product rule rather than a
-- modelling preference. #518 §7.5 forbids purchases, gifts, transfers,
-- conversions to money, reputation crossover and a points marketplace; none of
-- those has an exchange request behind it, so the constraint refuses every one
-- of them without naming any. RESTRICT, not CASCADE: deleting a request must
-- not silently delete the points somebody earned by honouring it.

CREATE TABLE "guest_point_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"account_oxy_user_id" text NOT NULL,
	"counterparty_oxy_user_id" text NOT NULL,
	"exchange_request_id" text NOT NULL,
	"direction" text NOT NULL,
	"state" text NOT NULL,
	"points" integer NOT NULL,
	"settled_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "guest_point_movements_direction_check" CHECK ("guest_point_movements"."direction" in ('earn', 'spend')),
	CONSTRAINT "guest_point_movements_state_check" CHECK ("guest_point_movements"."state" in ('reserved', 'settled', 'released')),
	CONSTRAINT "guest_point_movements_release_reason_check" CHECK ("guest_point_movements"."release_reason" is null or "guest_point_movements"."release_reason" in ('declined', 'cancelled', 'expired')),
	CONSTRAINT "guest_point_movements_points_check" CHECK ("guest_point_movements"."points" > 0),
	CONSTRAINT "guest_point_movements_distinct_parties_check" CHECK ("guest_point_movements"."account_oxy_user_id" <> "guest_point_movements"."counterparty_oxy_user_id"),
	CONSTRAINT "guest_point_movements_earn_settles_check" CHECK ("guest_point_movements"."direction" <> 'earn' or "guest_point_movements"."state" = 'settled'),
	CONSTRAINT "guest_point_movements_settled_check" CHECK (("guest_point_movements"."state" = 'settled') = ("guest_point_movements"."settled_at" is not null)),
	CONSTRAINT "guest_point_movements_released_check" CHECK (("guest_point_movements"."state" = 'released') = ("guest_point_movements"."released_at" is not null)),
	CONSTRAINT "guest_point_movements_release_reason_presence_check" CHECK (("guest_point_movements"."state" = 'released') = ("guest_point_movements"."release_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD COLUMN "uses_guest_points" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_point_movements" ADD CONSTRAINT "guest_point_movements_exchange_request_id_exchange_requests_id_fk" FOREIGN KEY ("exchange_request_id") REFERENCES "public"."exchange_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_point_movements_account_created_idx" ON "guest_point_movements" USING btree ("account_oxy_user_id","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "guest_point_movements_idempotency_key" ON "guest_point_movements" USING btree ("account_oxy_user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_point_movements_request_direction_key" ON "guest_point_movements" USING btree ("exchange_request_id","direction");--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_points_mode_check" CHECK ("exchange_requests"."uses_guest_points" = false or "exchange_requests"."mode" = 'host');