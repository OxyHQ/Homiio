/**
 * **Paging a feed never repeats or skips a listing.**
 *
 * Every row here ties on every sort key a feed uses (same `has_images`, same
 * `created_at`), which is what an ingest batch looks like. Without `id` closing
 * the order, Postgres may cut the same `OFFSET` between those rows differently
 * on each request; with it, walking the pages one row at a time must visit each
 * listing exactly once, in id order.
 *
 * The rows are inserted in DESCENDING id order, so the table's physical order is
 * the reverse of the expected one: a read that fell back on it would fail here
 * rather than pass by luck.
 */

import { inArray, sql } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { properties } from '../../db/schema';
import { findProperties, NEWEST_FIRST, propertyOrderBy } from '../../db/properties/propertyReads';
import {
  createPropertyScaffold,
  dropPropertyScaffold,
  insertProperty,
  type PropertyScaffold,
} from './propertyFixtures';

const BATCH = 6;
const createdAt = new Date('2026-01-01T00:00:00Z');

let db: Database;
let scaffold: PropertyScaffold;
const created: string[] = [];

beforeAll(async () => {
  db = await connectPostgres();
  scaffold = await createPropertyScaffold(db, 'page order');
  const ids = Array.from({ length: BATCH }, () => uuidv7()).reverse();
  for (const id of ids) {
    created.push(await insertProperty(db, scaffold, { id, createdAt }));
  }
});

afterAll(async () => {
  await db.delete(properties).where(inArray(properties.id, created));
  await dropPropertyScaffold(db, scaffold);
  await closePostgres();
});

it('walks tied rows one page at a time, each exactly once, in id order', async () => {
  const where = inArray(properties.id, created);
  const seen: string[] = [];
  for (let offset = 0; offset < BATCH; offset++) {
    const [row] = await findProperties({
      where,
      orderBy: propertyOrderBy(NEWEST_FIRST),
      limit: 1,
      offset,
    });
    seen.push(row.property.id);
  }

  const [{ ordered }] = await db
    .select({ ordered: sql<string[]>`array_agg(${properties.id} order by ${properties.id})` })
    .from(properties)
    .where(where);
  expect(seen).toEqual(ordered);
});
