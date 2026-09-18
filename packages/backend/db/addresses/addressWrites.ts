/**
 * The ONLY write path onto an `addresses` row that a request can reach, and the
 * predicate that decides who reaches it.
 *
 * ## What this module exists to stop
 *
 * `PUT /api/addresses/:id` and `DELETE /api/addresses/:id` used to issue
 * `where id = :id` and nothing else, behind the ordinary session middleware. So
 * any signed-in caller in the world could rewrite — or delete — the permanent
 * identity of a dwelling that listings, leases, reviews and eviction cases all
 * point at (ADR 0001 §2.1.2). The delete is gone entirely (see
 * {@link deleteAddress} — there isn't one, and the reasoning is below); the
 * update is what remains, and it is authorised HERE, in the statement, not in a
 * controller branch.
 *
 * ## Ownership is in the QUERY, and a non-owner sees a 404
 *
 * `AGENTS.md`: writes take the session `oxyUserId` from `@oxy.so/core/server`,
 * ownership is enforced in the REPOSITORY QUERY, and a non-owner gets 404 rather
 * than 403. All three are load-bearing together. Deciding in the controller
 * leaves the statement able to update any row the moment somebody adds a second
 * call site; answering 403 tells an enumerator that the id they guessed is real.
 * So the relation is a conjunct of the UPDATE's own `where`, and an
 * unauthorised caller updates zero rows, which the controller answers exactly as
 * it answers an id that does not exist.
 *
 * ## Which relation, and why not "any signed-in caller"
 *
 * The same two the address READ path already recognises —
 * `db/addresses/addressAudience.ts`, ADR 0003 §10.1: the owner of a live listing
 * at the place, and a party to an ACTIVE lease there. Nothing else, and in
 * particular not "wrote a review about it", because filing a review is a
 * self-service act and an unlock a caller performs on themselves is the shape
 * ADR 0003 §7.3.1 refuses. Reusing the read path's definition is deliberate: two
 * vocabularies for one relation is how the second one drifts, and the drift
 * would be a permission.
 *
 * ## Only three columns, and none of them is identity
 *
 * ADR 0001 §8.1: *correction of attributes is an ordinary edit and does not
 * change identity — UNLESS it changes a key field, in which case it is a merge
 * proposal.* §3.1 lists the key fields (`street`, `number`, `building_name`,
 * `block`, `entrance`, `floor`, `unit`, `subunit`) and the correctable ones
 * beside them. This module can write only the second set, so an edit that
 * re-keys a place is not merely refused — it is unreachable from here.
 * `db/addresses/addressCorrections.ts` is where the first set goes.
 *
 * ## There is no delete
 *
 * ADR 0001 §2.1.7: *a duplicate is recorded, never discarded. Merging is
 * reversible; deleting is not.* A canonical address is the identity of a
 * dwelling, not a user's own content: eleven of the twelve columns that can
 * point at one REFUSE a delete (measured in `db/schema/addressMerges.ts`), so a
 * "delete" on a place with any history raises, and on a place with none it
 * destroys the only row that would let the next ingest recognise the dwelling.
 * Withdrawing a place is `addresses.merged_into_address_id` plus an
 * `address_merges` row, which `services/addressMerge.ts` already implements as
 * an operational act. Deleting a place is not something a user does, so this
 * module offers no way to, and `routes/addresses.ts` declares no route for it.
 */

import { and, eq, sql, type SQL } from 'drizzle-orm';

import { getDb } from '../postgres';
import { qualified } from '../casing';
import { addresses, leases, properties } from '../schema';

/**
 * The columns a related caller may correct directly — ADR 0001 §3.1's
 * "correctable attributes", and nothing the identity key hashes.
 *
 * `district` is a label on the place; `po_box` and `reference` are free-form
 * fields tier R already withholds from a public read (ADR 0003 §2.1), which is
 * why writing them needs the same relation reading them does.
 */
export interface AddressAttributePatch {
  readonly district?: string | null;
  readonly poBox?: string | null;
  readonly reference?: string | null;
}

/**
 * `true` for a caller with a relation to this place that somebody ELSE recorded.
 *
 * Written as a predicate over the `addresses` row rather than as a lookup that
 * returns a boolean, so it can be `and`ed into the UPDATE itself. Every
 * correlated reference to `addresses` is {@link qualified}: a drizzle column
 * interpolated into `sql` renders BARE when its table is not in that statement's
 * `FROM`, so `${addresses.id}` inside these subqueries would render `"id"`,
 * resolve against the SUBQUERY's own table, compare two of its columns to each
 * other and match nothing — with no error at all (`db/casing.ts`, and it has
 * shipped once in this ecosystem). Here that failure would be silent and
 * one-sided: every update would 404, including the legitimate one.
 */
export function relatedToAddress(sessionOxyUserId: string): SQL {
  return sql`(
    exists (
      select 1
      from ${properties}
      where ${qualified(properties.addressId)} = ${qualified(addresses.id)}
        and ${qualified(properties.oxyUserId)} = ${sessionOxyUserId}
        and ${qualified(properties.deletedAt)} is null
    )
    or exists (
      select 1
      from ${leases}
      join ${properties} on ${qualified(properties.id)} = ${qualified(leases.propertyId)}
      where ${qualified(properties.addressId)} = ${qualified(addresses.id)}
        and ${qualified(leases.status)} = 'active'
        and (
          ${qualified(leases.landlordOxyUserId)} = ${sessionOxyUserId}
          or ${qualified(leases.tenantOxyUserId)} = ${sessionOxyUserId}
        )
    )
  )`;
}

/**
 * Correct the non-identity attributes of one address, for one session.
 *
 * Returns the row's id when the caller was related to it and it exists, and
 * `undefined` otherwise — the two cases are deliberately indistinguishable to
 * the caller, which is what makes the 404 honest rather than an information
 * leak.
 *
 * An empty patch is not this function's business: the controller answers it as
 * the read it is, without reaching a write.
 */
export async function updateAddressAttributes(input: {
  readonly addressId: string;
  readonly sessionOxyUserId: string;
  readonly patch: AddressAttributePatch;
}): Promise<string | undefined> {
  const [updated] = await getDb()
    .update(addresses)
    .set(input.patch)
    .where(and(eq(addresses.id, input.addressId), relatedToAddress(input.sessionOxyUserId)))
    .returning({ id: addresses.id });
  return updated?.id;
}
