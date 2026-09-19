/**
 * The PURE decisions behind a Sindi action, with no React and no router.
 *
 * Split out of `useSindiActions.ts` for a reason that is about testability and
 * not tidiness: the hook imports `expo-router`, which drags the whole
 * navigation runtime into anything that touches it — so a test of "does a
 * cancelled turn's action still apply?" could not run without mounting a
 * navigator. The rules are decisions about VALUES; they belong somewhere a test
 * can call them.
 *
 * Both functions are exported from `useSindiActions.ts` as well, so existing
 * call sites and this module's own consumers share one implementation.
 */

import type {
  SindiActionEnvelope,
  SindiActionOutcome,
  SindiSearchPatch,
} from '@homiio/shared-types';

import type { SearchQuery } from '@/components/search/types';

/**
 * Apply a patch to a query.
 *
 * Pure, and exported, because the two rules that matter are ordering rules and
 * a test should be able to state them without a router:
 *
 *  - **Absent means untouched.** Every key is applied only when present, so
 *    "now with two bedrooms" keeps the city and the budget.
 *  - **The offering is applied FIRST.** `searchQueryStore.setOffering` clears
 *    the price range on purpose — a monthly rent is not a nightly rate — so a
 *    patch carrying both must set the offering before the price or the price is
 *    silently dropped. The same ordering is reproduced here.
 *  - **A price from Sindi carries no currency, so it clears the one in play.**
 *    Somebody saying "under 1,200" has named an amount and not a unit, and the
 *    patch has no field for one. Leaving the previous `priceCurrency` in place
 *    would apply their new number in whatever currency the LAST search
 *    resolved — so "under 1,200" said after a Kraków search would be read as
 *    1,200 złoty. Clearing it hands the unit back to the server, which resolves
 *    it from the scope the patch is about and says which one it used.
 */
export function applySearchPatch(query: SearchQuery, patch: SindiSearchPatch): SearchQuery {
  // The offering first, with the same per-offering clearing the store does, so
  // this function and `setOffering` cannot disagree about what a mode switch
  // means.
  const base: SearchQuery =
    patch.offering !== undefined && patch.offering !== query.offering
      ? {
          ...query,
          offering: patch.offering,
          priceMin: undefined,
          priceMax: undefined,
          priceCurrency: undefined,
          ...(patch.offering === 'short_term_rent'
            ? {}
            : { dates: undefined, guests: undefined }),
        }
      : query;

  return {
    ...base,
    // Atomic: the whole selection or none of it (ADR 0002 §3).
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    ...(patch.queryText !== undefined ? { queryText: patch.queryText } : {}),
    ...(patch.propertyTypes !== undefined ? { propertyTypes: [...patch.propertyTypes] } : {}),
    ...(patch.priceMin !== undefined ? { priceMin: patch.priceMin } : {}),
    ...(patch.priceMax !== undefined ? { priceMax: patch.priceMax } : {}),
    // A new bound arrives with no unit, so the old unit goes with the old
    // bound. Untouched when the patch names no price at all — a patch that only
    // adds a bedroom must not re-open a currency question nobody asked.
    ...(patch.priceMin !== undefined || patch.priceMax !== undefined
      ? { priceCurrency: undefined }
      : {}),
    // A patch that moves the SCOPE moves the question of what it is priced in
    // with it, exactly as `commitLocation` does in the store.
    ...(patch.location !== undefined ? { priceCurrency: undefined } : {}),
    ...(patch.bedrooms !== undefined ? { bedrooms: patch.bedrooms } : {}),
    ...(patch.bathrooms !== undefined ? { bathrooms: patch.bathrooms } : {}),
    ...(patch.amenities !== undefined ? { amenities: [...patch.amenities] } : {}),
    ...(patch.petFriendly !== undefined ? { petFriendly: patch.petFriendly } : {}),
  };
}

/**
 * Whether an envelope may still be applied, and why not when it may not.
 *
 * A pure function over the four facts, so every refusal is an ordinary
 * assertion rather than a timing simulation. `null` means "go ahead".
 */
export function envelopeRefusal(input: {
  readonly envelope: SindiActionEnvelope;
  readonly activeTurnId: string | null;
  readonly contextRevision: number;
  readonly alreadyApplied: boolean;
}): Extract<SindiActionOutcome, 'stale' | 'rejected'> | null {
  // Dedupe first: a replayed frame for the active turn is not stale, it is
  // simply already done, and reporting it as stale would look like a conflict
  // the user should resolve.
  if (input.alreadyApplied) return 'rejected';
  if (input.activeTurnId === null || input.envelope.turnId !== input.activeTurnId) return 'stale';
  if (input.envelope.contextRevision !== input.contextRevision) return 'stale';
  return null;
}

