/**
 * `eviction_cases.location_geo` — the SECOND and last PostGIS column in this
 * migration, asserted against REAL ROWS.
 *
 * It is the same shape as `addresses.geo` and it needs its own file rather than
 * a line in `postgis.test.ts`, because a shape being right once says nothing
 * about the second time somebody writes it: the whole hazard is that
 * `ST_MakePoint(latitude, longitude)` compiles, runs, produces a valid point,
 * and is wrong. The ordering assertion here is therefore anchored to the SAME
 * independently checkable real-world distance — Barcelona to Madrid, ~505 km,
 * where the transposed pair reads ~658 km — so a copy-paste that swapped the
 * arguments fails rather than passing on "a row came back".
 *
 * The consequence is worse here than on an address. An eviction case is a public
 * notice telling people WHERE and WHEN to turn up; a plausible point in the
 * wrong place sends them somewhere else entirely.
 */

import { eq, sql } from 'drizzle-orm';
import { CHECK_VIOLATION, GENERATED_ALWAYS, constraintNameOf, sqlStateOf, uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { evictionCases } from '../../db/schema';

/** Barcelona city centre. */
const BARCELONA = { latitude: 41.3874, longitude: 2.1686 };
/** Madrid city centre. */
const MADRID = { latitude: 40.4168, longitude: -3.7038 };
/** The real great-circle distance between them, in metres (~505 km). */
const BARCELONA_TO_MADRID_METRES = 505_000;
/** Guarding an ORDERING bug, not geodesy — far tighter than the 153 km a swap adds. */
const DISTANCE_TOLERANCE_METRES = 20_000;

const SCHEDULED_AT = new Date(Date.UTC(2026, 8, 15, 9, 0, 0));

let db: Database;
const createdIds: string[] = [];

async function insertCaseAt(
  coordinates: { latitude: number; longitude: number },
  label = 'Plaça de Sant Jaume',
): Promise<string> {
  const [row] = await db
    .insert(evictionCases)
    .values({
      oxyUserId: `oxy-${uuidv7()}`,
      title: 'Desahucio',
      description: 'Concentración de apoyo.',
      locationLabel: label,
      locationLongitude: coordinates.longitude,
      locationLatitude: coordinates.latitude,
      scheduledAt: SCHEDULED_AT,
    })
    .returning({ id: evictionCases.id });
  if (!row) throw new Error('insert returned no row');
  createdIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  for (const id of createdIds) {
    await db.delete(evictionCases).where(eq(evictionCases.id, id));
  }
  await closePostgres();
});

describe('eviction_cases.location_geo', () => {
  it('is a generated POINT at SRID 4326', async () => {
    const id = await insertCaseAt(BARCELONA);

    const rows = await db.execute<{ kind: string; srid: number; is_generated: string }>(sql`
      select
        ST_GeometryType(e.location_geo::geometry) as kind,
        ST_SRID(e.location_geo::geometry) as srid,
        c.is_generated
      from eviction_cases e
      join information_schema.columns c
        on c.table_name = 'eviction_cases' and c.column_name = 'location_geo'
      where e.id = ${id}
    `);
    expect(rows[0].kind).toBe('ST_Point');
    expect(Number(rows[0].srid)).toBe(4326);
    expect(rows[0].is_generated).toBe('ALWAYS');
  });

  it('measures a REAL distance, so a transposed pair fails', async () => {
    // The assertion the file exists for. `ST_MakePoint(location_latitude,
    // location_longitude)` would put Barcelona at 41.4E 2.2N — off the coast of
    // Somalia — and Madrid at 40.4E -3.7N, and the pair would still be a valid
    // geography with a plausible-looking distance between them. Only anchoring
    // on the true figure tells the two apart.
    const barcelona = await insertCaseAt(BARCELONA, 'Barcelona');
    const madrid = await insertCaseAt(MADRID, 'Madrid');

    const rows = await db.execute<{ metres: string }>(sql`
      select ST_Distance(a.location_geo, b.location_geo) as metres
      from eviction_cases a, eviction_cases b
      where a.id = ${barcelona} and b.id = ${madrid}
    `);
    const metres = Number(rows[0].metres);
    expect(metres).toBeGreaterThan(BARCELONA_TO_MADRID_METRES - DISTANCE_TOLERANCE_METRES);
    expect(metres).toBeLessThan(BARCELONA_TO_MADRID_METRES + DISTANCE_TOLERANCE_METRES);
  });

  it('cannot be written directly', async () => {
    // What makes a divergence between the point and its two coordinate columns
    // UNREPRESENTABLE rather than merely discouraged.
    let caught: unknown;
    try {
      await db.execute(sql`
        insert into eviction_cases (
          id, oxy_user_id, title, description, location_label,
          location_longitude, location_latitude, scheduled_at, location_geo
        ) values (
          ${uuidv7()}, 'oxy-x', 't', 'd', 'l', 0, 0,
          ${SCHEDULED_AT.toISOString()}::timestamptz, ST_MakePoint(0, 0)::geography
        )
      `);
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(GENERATED_ALWAYS);
  });

  it('is backed by a GiST index, and it is the only one on this table', async () => {
    const rows = await db.execute<{ indexname: string }>(sql`
      select i.relname as indexname
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_am am on am.oid = i.relam
      where t.relname = 'eviction_cases' and am.amname = 'gist'
      order by 1
    `);
    expect(rows.map((row) => row.indexname)).toEqual(['eviction_cases_location_geo_gist']);
  });

  it('refuses an out-of-range coordinate rather than silently relocating it', async () => {
    // PostGIS does NOT reject this on its own: `ST_MakePoint(0, 100)::geography`
    // emits a NOTICE, wraps latitude 100 over the pole to 80, and SUCCEEDS. The
    // CHECK is what keeps Mongo's validator rather than degrading it into a
    // gathering advertised 2,000 km from where it is.
    let caught: unknown;
    try {
      await insertCaseAt({ latitude: 100, longitude: 0 });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(caught)).toBe('eviction_cases_coordinates_range_check');
  });

  it('refuses an out-of-range longitude too', async () => {
    // Both halves, because the CHECK is one expression over two columns and a
    // mutation that dropped either conjunct would leave the other passing.
    let caught: unknown;
    try {
      await insertCaseAt({ latitude: 0, longitude: 200 });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(caught)).toBe('eviction_cases_coordinates_range_check');
  });
});
