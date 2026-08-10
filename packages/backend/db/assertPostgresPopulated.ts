/**
 * Refuse the rollout when the Postgres database it is about to serve is EMPTY.
 *
 * ## What this is for
 *
 * A 200 is not evidence of a database. Mention shipped a trunk image against an
 * empty Postgres on 2026-08-04: every post-deploy smoke check passed, because an
 * empty store answers a feed endpoint 200 with no items, and "the process
 * answered" was standing in for "the process has a database behind it". What
 * reverted that deployment was an unrelated task crashing. The breakage was
 * load-bearing, and this is the control that replaces it.
 *
 * Homiio's exposure is the same shape. `/api/properties/search` on an empty
 * store is a 200 with `data: []` and a `pagination` block reading zero — which
 * is also what a legitimate over-filtered search returns, so nothing downstream
 * can tell the two apart.
 *
 * It runs as a migration one-shot in `.github/scripts/deploy-ecs-image.sh`,
 * LAST (it counts rows, so the schema has to exist first) and before
 * `update-service`. A non-zero exit there stops the release having routed
 * nothing, which is the whole reason it lives at that point rather than in the
 * post-deploy smoke checks: a smoke failure rolls back after the image has
 * already served traffic.
 *
 * ## READ-ONLY, deliberately
 *
 * A one-shot that fails may still be RUNNING against the database afterwards —
 * the deploy role cannot call `ecs:StopTask`, which `deploy-ecs-image.sh` warns
 * about in its own comments. Anything this file did to the data could therefore
 * still be happening after the deploy gave up. It counts, and it exits.
 *
 * ## STILL NOT WIRED IN, and the reason has changed — read this before wiring it
 *
 * This asserts that Postgres is AUTHORITATIVE. That was false before the
 * cutover, and would have been false again after the planned rollback to Mongo,
 * so the original plan was for the cutover commit to append this file's entry to
 * `MIGRATION_TASK_COMMANDS_JSON` in `deploy-ecs-image.sh` and for a revert to
 * remove it — the guard's lifetime tied to the lifetime of the claim it makes,
 * with no env flag, because a flag is a second thing to remember at the moment
 * nobody has attention to spare. That is also why this stays out of `/health`: a
 * permanent claim about the app becomes a trap for whoever first boots on a
 * fresh database.
 *
 * The cutover happened, and there is no rollback target left (see `AGENTS.md`).
 * The entry was never appended, and the objection that kept it out is gone.
 *
 * WHAT REPLACES IT IS A MEASUREMENT, NOT AN ARGUMENT. Every floor below is a
 * number from the Mongo census of 2026-08-06, and nobody has counted what
 * Postgres holds now. A floor production does not clear blocks every deploy —
 * the exact failure this guard exists to prevent, caused by the guard. So:
 * count the five tables against production first, adjust or justify each floor
 * against what you measured, and only then append the entry. Wiring it on the
 * strength of this paragraph is not the same as wiring it on a count.
 *
 * ## It needs no "we are mid-migration" escape hatch
 *
 * The cutover stops both services at desiredCount 0, runs the copy, and only
 * then deploys. The one moment the store is legitimately empty is a moment no
 * deploy is running. That dependency on the runbook's ORDER is executable here
 * rather than prose: change the order and this is what notices.
 */

import postgres from 'postgres';
import { Logger } from '../utils/logger';

const logger = new Logger('AssertPostgresPopulated');

/** Seconds to wait for in-flight queries before forcing the socket shut. */
const CLOSE_TIMEOUT_SECONDS = 5;

/**
 * One table that cannot legitimately be empty once Postgres is authoritative,
 * with the reason it cannot — the reason is what a later reader needs in order
 * to decide whether a failure is real or the floor is simply stale.
 */
export interface PopulationFloor {
  readonly table: string;
  readonly minimum: number;
  readonly why: string;
}

/**
 * Five tables, not one, and not all of them.
 *
 * One is not enough: the copy walks collections in dependency order, so it can
 * write `countries` and `cities` and die before `properties`, and a single-table
 * floor would report a partial copy as a healthy one. The five below are written
 * at five DIFFERENT points of that order, which is what makes the SET able to
 * tell a partial copy from an empty one — a property no individual entry has.
 *
 * Every floor is well below its measured production count and well above any
 * plausible residue. Exact counts are NOT asserted, and must not be: external
 * listings carry a TTL that reaps them continuously, so `properties` and
 * `images` move on their own between the census and the window. The property
 * being asserted is "does this hold production", not "does this hold literally
 * what production held on census day" — and a floor of 1 does not assert it
 * either, which is the specific mistake that let a trunk image serve a database
 * holding 0.016% of production.
 *
 * Source counts: production Mongo census, 2026-08-06 (issue #281, Fase 0).
 *
 * DELIBERATELY NOT A FLOOR — `countries` (7 rows). It is a seeded reference
 * table: a fresh, entirely unpopulated database gets all 7 from the seed path,
 * so it reads identical before and after the copy and cannot discriminate
 * anything. A floor that passes in the failure case is worse than no floor,
 * because it makes the set look more thorough than it is.
 *
 * DELIBERATELY NOT A FLOOR — `profiles` (5 rows), and the same reasoning in a
 * different guise. Five is indistinguishable from fixture residue, so any floor
 * low enough to be safe is low enough to pass on a database that holds nothing
 * real. The remaining ~45 tables the schema now carries are EMPTY in production
 * (live census, 2026-08-06), so none of them can carry a floor at all: the
 * correct reading for every one of them after a perfect copy is zero rows.
 */
export const POPULATION_FLOORS: readonly PopulationFloor[] = [
  {
    table: 'properties',
    minimum: 5_000,
    why:
      'The source holds 17,644 properties. This is the product: an empty ' +
      '`properties` is an empty Homiio, and every list, search and map surface ' +
      'answers 200 with an empty array rather than failing. ~3.5x below the ' +
      'real count, so the TTL reaping external listings cannot trip it, and far ' +
      'above any fixture residue.',
  },
  {
    table: 'images',
    minimum: 50_000,
    why:
      'The source holds 171,976 images, and 169,223 property image refs all ' +
      'resolve. It is written at a DIFFERENT stage of the copy than ' +
      '`properties` — media follows the property upsert — so the pair is what ' +
      'distinguishes a copy that died midway from one that never started. ' +
      '~3.4x below the real count.',
  },
  {
    table: 'addresses',
    minimum: 3_000,
    why:
      'The source holds 11,734 addresses, `normalizedKey` impeccable across ' +
      'all of them. Populated `properties` over empty `addresses` is a ' +
      'specific silent breakage rather than a generic one: `utils/helpers.ts` ' +
      'detects a populated address and returns early when it finds none, so ' +
      'every property card loses its location label with no error anywhere. ' +
      '~3.9x below the real count.',
  },
  {
    table: 'cities',
    minimum: 500,
    why:
      'The source holds 1,660 cities. It is copied EARLY, before properties ' +
      'and images, so it is the entry that fails when the copy died almost ' +
      'immediately — the case the later floors would report as an empty ' +
      'database rather than a broken run. ~3.3x below the real count. Unlike ' +
      '`countries` it is far too large to be reproduced by a seed.',
  },
  {
    table: 'agencies',
    minimum: 800,
    why:
      'The source holds 2,627 agencies, and this is the ONLY table outside the ' +
      'geo/listing chain with production data to lose — every other collection ' +
      'the remaining schema adds is at zero, and `profiles` (5) is too small to ' +
      'discriminate. It fails on a copy that finished the listing chain and ' +
      'stopped, which the four floors above would all report as healthy: ' +
      'agencies are written from the review and portal-contact paths, a ' +
      'different stage of the copy from anything else here. ~3.3x below the ' +
      'real count, and not seeded, so it cannot pass on an empty database the ' +
      'way `countries` would.',
  },
];

/** What one floor read. */
export interface PopulationReading {
  readonly table: string;
  readonly rows: number;
}

/** The verdict, and the lines an operator reads. */
export interface PopulationVerdict {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/**
 * Decide from the readings alone — separated from the counting so the decision
 * is testable without a database, and so the two failures it distinguishes
 * (below the floor / never measured) cannot be conflated by a query error.
 *
 * Reports what it counted AND what it required, on SUCCESS as well as failure.
 * A check that says only "passed" leaves nobody able to tell afterwards whether
 * it looked at anything.
 */
export function evaluatePopulation(
  floors: readonly PopulationFloor[],
  readings: readonly PopulationReading[],
): PopulationVerdict {
  const lines: string[] = [];
  let ok = true;

  // An empty floor list is NOT a pass. Whatever emptied it left the question
  // unanswered, and an unanswered question about whether production has data
  // must never read as yes.
  if (floors.length === 0) {
    return {
      ok: false,
      lines: ['no population floors are declared, so nothing was checked'],
    };
  }

  for (const floor of floors) {
    const reading = readings.find((entry) => entry.table === floor.table);
    // A floor with no reading is NOT a pass either, for the same reason.
    if (reading === undefined) {
      ok = false;
      lines.push(`${floor.table}: NOT MEASURED (floor ${floor.minimum}) — ${floor.why}`);
      continue;
    }
    const verdict = reading.rows >= floor.minimum ? 'ok' : 'BELOW FLOOR';
    if (reading.rows < floor.minimum) ok = false;
    lines.push(
      `${floor.table}: ${reading.rows} row(s), floor ${floor.minimum} — ${verdict}`,
    );
  }
  return { ok, lines };
}

/**
 * `count(*)`, read-only.
 *
 * Uses the raw postgres.js handle rather than `getDb()` because this file must
 * not depend on `db/schema` — the floors name tables that land across several
 * batches, and a schema import would tie a deploy-time guard to whichever of
 * them had been merged. The table names come from {@link POPULATION_FLOORS}, a
 * constant in this file and never input, so they are interpolated as identifiers
 * — which a table name cannot be parameterised as anyway.
 */
async function countRows(client: postgres.Sql, table: string): Promise<number> {
  const rows = await client.unsafe<{ count: string }[]>(
    `select count(*)::text as count from ${table}`,
  );
  const value = rows[0]?.count;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`count(*) on ${table} returned ${String(value)}, which is not a number`);
  }
  return parsed;
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set, so the population floor could not read anything. ' +
      'An unreadable database is not a passing check.',
    );
  }

  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const readings: PopulationReading[] = [];
    for (const floor of POPULATION_FLOORS) {
      readings.push({ table: floor.table, rows: await countRows(client, floor.table) });
    }

    const verdict = evaluatePopulation(POPULATION_FLOORS, readings);
    for (const line of verdict.lines) logger.info(line);

    if (!verdict.ok) {
      logger.error(
        'REFUSING THE ROLLOUT. The schema is present and the connection works, ' +
        'so this is not an unreachable database — it is a REACHABLE EMPTY ONE, ' +
        'which every HTTP check in this pipeline reports as healthy. If the copy ' +
        'has not run yet, that is the answer: run it. If it has, something ' +
        'emptied the target and the deploy must not proceed.',
      );
      return 1;
    }
    logger.info('every floor satisfied; the rollout may proceed.');
    return 0;
  } finally {
    await client.end({ timeout: CLOSE_TIMEOUT_SECONDS });
  }
}

// `require.main === module` rather than an unconditional call: the exported
// helpers above stay importable without this file counting rows on import.
if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      // Not `process.exit`: it would truncate the very message that says what
      // went wrong. The event loop is already free once the pool is closed.
      logger.error('Population floor check failed', error);
      process.exitCode = 1;
    });
}
