/**
 * WHO an address body is being built for, and the ONE query that decides it.
 *
 * `serializeAddressRow` takes a precision and refuses to guess (ADR 0003 §4.1);
 * this module is the other half — the fact about the REQUEST that chooses which
 * rung a given caller is served. It is the address equivalent of
 * `propertyAudienceFor` / `publishedAddressPrecision` in
 * `db/properties/propertySerializer.ts`, and deliberately reads the same way,
 * because two vocabularies for one decision is how the second one drifts.
 *
 * ## The three audiences, and what each is served
 *
 *  - **`public`** — anonymous, and every signed-in caller with no recorded
 *    relation to the place. Both get `building`: ADR 0003 §9's matrix gives A
 *    and U the same row for every address field there is, and "unit / floor /
 *    door" is `—` for both. Signing in is not a relationship.
 *  - **`related`** — a caller whose relation to this dwelling is RECORDED, and
 *    recorded by somebody other than themselves wherever possible (below).
 *    Served `exact`.
 *  - **`system`** — a body that never leaves the process. Served `exact`, and
 *    named separately so a call site says which it means.
 *
 * ## Which relations count, and why these two and not more
 *
 * ADR 0003 §10.1: access to a tier-R field is granted by *a relationship
 * recorded in the database*, computed server-side from the session. Two exist
 * for a place:
 *
 *  1. **The owner of a listing at this address.** §9's matrix gives the listing
 *    owner `read/write exact` on the unit and floor of the place their listing
 *    advertises, and `GET /api/properties/:id` already serves them exactly that
 *    (#496). Recognising it here therefore widens nothing: it is the same fact,
 *    reachable by the same session, through the address route their own listing
 *    points at.
 *  2. **A party to an ACTIVE lease at this address.** A tenancy is the
 *    strongest relation to a dwelling there is — §3.4's own exception is the
 *    occupant, whose door number is their own address rather than a third
 *    party's. It is also the one relation nobody can grant themselves: a lease
 *    exists only where a landlord and a tenant both signed, from an application
 *    (`/contracts/new?application=<id>`). `active` only, because §10.2 makes
 *    permission a function of state rather than a grant that persists.
 *
 * **Authoring a review at the address is deliberately NOT one of them.** Filing
 * a review is a self-service act, and an unlock a caller can perform on
 * themselves is the shape ADR 0003 §7.3.1 refuses for the eviction board's RSVP.
 * A review's AUTHOR still reads their own review's address in full — that is
 * §9's "review unit binding: O read", applied to the one record they wrote —
 * but it buys them nothing on `/api/addresses/*`.
 *
 * ## Why the list surfaces never escalate
 *
 * Only `GET /api/addresses/:id` (and the PUT that answers with the same body)
 * consults this. Search and nearby publish `building` to everybody including a
 * related caller, because tier C is "published… never as a bulk export" (§2)
 * and §12's T4 names "no bulk endpoint returning unit-precision addresses" as
 * the control. A related caller reads the one place they are related to, by id.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { ListingAddressPrecision } from '@homiio/shared-types';

import { getDb } from '../postgres';
import { leases, properties } from '../schema';

/** WHO an address body is being built for — ADR 0003 §4.1's `audience`. */
export type AddressAudience = 'public' | 'related' | 'system';

/**
 * The rung an audience is served at.
 *
 * `public` is `building` and not `street`: a street name and a house number are
 * tier C (ADR 0003 §2.1), publishable in a context that justifies them, and the
 * page that shows a dwelling's reviews is that context. What tier R withholds is
 * everything INSIDE the building.
 */
export function addressPrecisionFor(audience: AddressAudience): ListingAddressPrecision {
  return audience === 'public' ? 'building' : 'exact';
}

/**
 * The audience one caller belongs to for one address.
 *
 * The session id is matched INSIDE the queries, never compared against a value
 * the client supplied — the discipline `AGENTS.md` states for ownership, for the
 * same reason: an id in a body or a path names whoever the caller wants to be.
 *
 * Two statements rather than one union, because the first answers most calls on
 * an index-only lookup and the second is never reached when it does.
 */
export async function addressAudienceFor(
  addressId: string,
  sessionOxyUserId: string | null | undefined,
): Promise<AddressAudience> {
  if (typeof sessionOxyUserId !== 'string' || sessionOxyUserId.length === 0) return 'public';
  const db = getDb();

  const owned = await db
    .select({ related: sql<number>`1` })
    .from(properties)
    .where(
      and(
        eq(properties.addressId, addressId),
        eq(properties.oxyUserId, sessionOxyUserId),
        // A withdrawn listing is not a live relation to the place, and a
        // permission that outlives its reason is the "standing access" §10.3
        // refuses.
        isNull(properties.deletedAt),
      ),
    )
    .limit(1);
  if (owned.length > 0) return 'related';

  const leased = await db
    .select({ related: sql<number>`1` })
    .from(leases)
    .innerJoin(properties, eq(properties.id, leases.propertyId))
    .where(
      and(
        eq(properties.addressId, addressId),
        eq(leases.status, 'active'),
        or(
          eq(leases.landlordOxyUserId, sessionOxyUserId),
          eq(leases.tenantOxyUserId, sessionOxyUserId),
        ),
      ),
    )
    .limit(1);
  return leased.length > 0 ? 'related' : 'public';
}
