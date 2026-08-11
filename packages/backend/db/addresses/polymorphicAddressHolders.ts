/**
 * Every column that holds an address id WITHOUT a foreign key, derived from the
 * catalogue.
 *
 * ## Why these are the dangerous ones
 *
 * A real foreign key is enforced by the database: after a merge, a row still
 * pointing at the loser is at worst pointing at a row that redirects, and
 * nothing can point at a row that does not exist. A polymorphic `subject_id` has
 * no such help. **Nothing in the database will refuse a stale id**, so moving
 * these is entirely the engine's responsibility and a miss is invisible — no
 * error, no dangling-reference report, just an alert or an event quietly filed
 * against a retired address forever.
 *
 * That is why this module DERIVES the set instead of listing it. A hand-written
 * list is what left three of six `PlaceType` values unhandled in #416 and 49 of
 * 69 routes inheriting a rail in #423; both shipped, and neither list looked
 * incomplete. The rule the two failures share is that a list has to name every
 * member and nothing checks that it did.
 *
 * ## The derivation, and the convention it depends on
 *
 * A polymorphic holder is a table with a discriminator column constrained by a
 * `CHECK (<col> = ANY (ARRAY[...]))` whose value set contains `'address'`. The
 * id column beside it is the discriminator's name with `_type` replaced by
 * `_id` — `subject_type` → `subject_id`, `entity_type` → `entity_id` — which is
 * this schema's own naming convention and is asserted rather than assumed:
 * {@link derivePolymorphicAddressHolders} refuses a discriminator whose id
 * column does not exist, rather than skipping it.
 *
 * A refusal is the point. If somebody adds a holder that breaks the convention,
 * the engine stops with a named error instead of silently not moving its rows.
 *
 * ## What it does NOT do
 *
 * It does not decide whether a value in the enum other than `'address'` matters.
 * `images.entity_type` is `property | city | region | country | profile` and
 * carries no `'address'`, so it is not derived — correctly, because an image is
 * never attached to a place. That exclusion is a consequence of the derivation
 * rather than a rule somebody wrote down, which is the property that makes it
 * survive somebody adding `'address'` to that enum tomorrow.
 */

import { sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '../postgres';

/** A column that can hold an address id with no constraint behind it. */
export interface PolymorphicAddressHolder {
  readonly table: string;
  /** The column holding the id. */
  readonly column: string;
  /** The discriminator, and the value that makes the row an address row. */
  readonly discriminator: { readonly column: string; readonly value: string };
}

/**
 * The value a discriminator must admit for its table to be an address holder.
 *
 * A constant rather than a literal, because it appears in the SQL pattern and in
 * the derived result and the two must agree — the shape of bug where a scan
 * looks for one spelling and the registry records another.
 */
export const ADDRESS_SUBJECT_VALUE = 'address';

/**
 * Raised when a discriminator admits `'address'` but the id column the naming
 * convention predicts does not exist.
 *
 * A hard failure rather than a skip: the whole reason this module derives is
 * that a silently-unhandled holder is invisible, and skipping one here would
 * reproduce exactly that.
 */
export class UnconventionalAddressHolderError extends Error {
  constructor(
    readonly table: string,
    readonly discriminatorColumn: string,
    readonly expectedIdColumn: string,
  ) {
    super(
      `${table}.${discriminatorColumn} admits '${ADDRESS_SUBJECT_VALUE}' but ` +
        `${table}.${expectedIdColumn} does not exist. A polymorphic address holder must ` +
        'name its id column `<discriminator>_id` (see db/addresses/polymorphicAddressHolders.ts), ' +
        'because the merge engine has to move it and nothing in the database will refuse a ' +
        'stale id if it does not.',
    );
  }
}

/**
 * Every polymorphic address holder in the live schema.
 *
 * Reads the CATALOGUE rather than the drizzle objects, because a CHECK's value
 * set is what the database will actually enforce and a drizzle `text({ enum })`
 * is only what the TypeScript side believes. When a migration adds a value to a
 * CHECK, this sees it; nothing else here would.
 */
export async function derivePolymorphicAddressHolders(
  db: DatabaseOrTransaction,
): Promise<readonly PolymorphicAddressHolder[]> {
  // Hoisted rather than interpolated inline: a nested template literal inside a
  // tagged template is a parse error here, and the pattern is easier to read as
  // a named value anyway.
  const quotedAddressValue = "%'" + ADDRESS_SUBJECT_VALUE + "'::text%";
  const discriminatorSuffix = '%\\_type';

  const rows = await db.execute<{
    table_name: string;
    discriminator_column: string;
  }>(sql`
    select c.conrelid::regclass::text as table_name, a.attname as discriminator_column
    from pg_constraint c
    join unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'c'
      and c.connamespace = 'public'::regnamespace
      and a.attname like ${discriminatorSuffix}
      -- The value set, as the database will enforce it. Quoted on both sides so
      -- a column merely NAMED address_type cannot match, and a value like
      -- 'addresses' cannot either. (No backticks in here: this is inside a
      -- template literal, and one would end it mid-query.)
      and pg_get_constraintdef(c.oid) like ${quotedAddressValue}
    order by 1, 2
  `);

  const holders: PolymorphicAddressHolder[] = [];
  for (const row of rows) {
    const idColumn = row.discriminator_column.replace(/_type$/, '_id');
    const exists = await db.execute<{ present: boolean }>(sql`
      select true as present
      from pg_attribute
      where attrelid = ${row.table_name}::regclass
        and attname = ${idColumn}
        and attnum > 0
        and not attisdropped
    `);
    if ([...exists].length === 0) {
      throw new UnconventionalAddressHolderError(
        row.table_name,
        row.discriminator_column,
        idColumn,
      );
    }
    holders.push({
      table: row.table_name,
      column: idColumn,
      discriminator: { column: row.discriminator_column, value: ADDRESS_SUBJECT_VALUE },
    });
  }
  return holders;
}
