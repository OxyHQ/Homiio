/**
 * Which right-rail widget set each route gets — TOTALLY, with no fall-through
 * (#423).
 *
 * ## What this replaced, and what it was costing
 *
 * `RightBar` used to resolve the rail with a ladder of `pathname ===` and
 * `pathname.startsWith(...)` tests ending in `return 'home'`. Measured against
 * the real `app/` tree on 2026-08-11, that ladder resolved **49 of 69 routes**
 * to Home's rail by FALL-THROUGH — `/reviews`, `/roommates`, `/saved`,
 * `/viewings`, `/tips`, `/settings`, `/evictions`, `/inbox` and forty more.
 *
 * A default meaning "home" cannot tell *"this route wants the home rail"* from
 * *"nobody has decided what this route's rail is"*. Those are different facts
 * and only one of them is a decision. It is also the multiplier on the class of
 * bug #353 exists to remove: until #422 the featured widget issued a globally
 * unscoped query, and this fall-through is why it did so on forty-nine routes
 * rather than one.
 *
 * Three more defects the ladder was hiding, all found by enumerating rather
 * than by reading:
 *
 *  - **Three `ScreenId` values no route could ever reach.** `saved-properties`
 *    named `/properties/saved`, which has never existed in this repository's
 *    history; `payments` and `messages` named routes that do not exist either.
 *  - **Three routes fetching a property that cannot exist.** The
 *    `startsWith('/properties/')` arm treated `/properties/drafts`,
 *    `/properties/recently-viewed` and `/properties/address-detail` as detail
 *    pages and handed the path segment to `PropertyBookingWidget` as a property
 *    id — so each mounted `useProperty('drafts')` and issued a doomed
 *    `GET /api/properties/drafts`. The guard list beside it excluded `my`,
 *    `saved`, `eco`, `type` and `city`, which is a hand-maintained list of
 *    exceptions: it had to name every non-id segment, and it did not.
 *  - **A rail chosen for a page that is not that page.** `/properties/city/[id]`
 *    and `/properties/type/[type]` are LISTS and were getting the property
 *    DETAIL rail, booking widget included.
 *
 * ## The rule this map follows
 *
 * **A route keeps the rail the previous code demonstrably CHOSE for it. Every
 * route that only ever received Home's rail by fall-through gets `null`.**
 *
 * `null` is not "unknown" — it is the decision "no rail here", which is the
 * issue's safest default: the absence of a decision must produce the absence of
 * UI, never somebody else's UI. Upgrading any of them to a real rail is a
 * product call, and it is now a one-line, visible, reviewable change instead of
 * something a route acquires by existing.
 *
 * ## Adding a route
 *
 * Add it here. `__tests__/widgets/routeRailTotality.test.ts` walks the real
 * `app/` tree and FAILS on any route absent from this map, so a new screen
 * cannot be silently absorbed by a default — it has to be given one. The same
 * test fails on an entry that is not a real route, and on a `ScreenId` no route
 * reaches, so the map cannot rot in either direction.
 */

import type { ScreenId } from './screenIds';

/**
 * The rail a route gets, plus which of its dynamic segments the widgets need.
 *
 * The param NAMES live here rather than in `RightBar` because they are a fact
 * about the route, and the previous version's habit of re-deriving them from
 * `pathname.split('/')[2]` is what produced a property id of `"drafts"`.
 */
export interface RailAssignment {
  /** The widget set, or `null` for the deliberate decision "no rail here". */
  readonly rail: ScreenId | null;
  /** The dynamic segment carrying a property id, for a rail that shows one. */
  readonly propertyIdParam?: string;
  /** The dynamic segment carrying a city id, for a rail that shows one. */
  readonly cityParam?: string;
}

/** The decision "this route has no rail". Shared because it is one decision. */
const NO_RAIL: RailAssignment = { rail: null };

/**
 * Every route in `app/`, and the rail it gets.
 *
 * Keys are expo-router route PATTERNS: `(group)` segments are transparent and
 * `index` is its directory, exactly as the router resolves them, so a key here
 * is comparable to a real pathname without anyone transcribing it.
 */
export const ROUTE_RAIL: Readonly<Record<string, RailAssignment>> = {
  // ---- Home -------------------------------------------------------------
  '/': { rail: 'home' },

  // ---- Property discovery: the renter-facing LISTS -----------------------
  // One surface, one rail. `/properties` already had it; the two filtered
  // views of the same list were getting the DETAIL rail because they happen to
  // sit under the same path prefix.
  '/properties': { rail: 'properties' },
  '/properties/type/[type]': { rail: 'properties' },
  // The only route that ever wanted a city: the replaced code carried a branch
  // extracting it, for `NeighborhoodRatingWidget`, so this is the previous
  // intent preserved rather than a new decision.
  '/properties/city/[id]': { rail: 'properties', cityParam: 'id' },

  // ---- A property, and the flows that hang off one ----------------------
  // `propertyIdParam` is declared, so the id comes from the MATCHED segment
  // rather than from counting slashes.
  '/properties/[id]': { rail: 'property-details', propertyIdParam: 'id' },
  '/properties/[id]/apply': { rail: 'property-details', propertyIdParam: 'id' },
  '/properties/[id]/book-viewing': { rail: 'property-details', propertyIdParam: 'id' },
  '/properties/[id]/report': { rail: 'property-details', propertyIdParam: 'id' },

  // ---- Creating a listing ------------------------------------------------
  '/properties/create': { rail: 'create-property' },

  // ---- Owner-side property surfaces --------------------------------------
  // Lists, but of YOUR listings, not of homes to rent. The renter rail's saved
  // searches and price alerts answer a question nobody is asking here, and
  // nobody ever chose it for them — they fell through to Home.
  '/properties/my': NO_RAIL,
  '/properties/drafts': NO_RAIL,
  '/properties/recently-viewed': NO_RAIL,
  '/properties/address-detail': NO_RAIL,

  // ---- Explore -----------------------------------------------------------
  '/explore': { rail: 'explore' },
  '/explore/[query]': { rail: 'explore-results' },
  // `/search` is a two-line `<Redirect>` to `/explore` and renders nothing of
  // its own, so it gets no rail: the rail that matters is the one `/explore`
  // resolves once the redirect lands.
  '/search': NO_RAIL,
  '/search/[query]': NO_RAIL,

  // ---- Profile -----------------------------------------------------------
  '/profile': { rail: 'profile' },
  '/profile/edit': { rail: 'profile' },
  '/profile/subscriptions': { rail: 'profile' },

  // ---- Tenancy: contracts, applications, viewings, reservations ----------
  // `/contracts*` already rendered NO rail — its widget list was empty, and an
  // empty list makes `WidgetManager` return null — so `null` here is the same
  // behaviour said out loud. The rest fell through to Home.
  '/contracts': NO_RAIL,
  '/contracts/[id]': NO_RAIL,
  '/contracts/new': NO_RAIL,
  '/applications': NO_RAIL,
  '/applications/[id]': NO_RAIL,
  '/landlord/applications': NO_RAIL,
  '/landlord/applications/[id]': NO_RAIL,
  '/viewings': NO_RAIL,
  '/reservations/[id]': NO_RAIL,
  '/stays': NO_RAIL,
  '/exchange/[id]': NO_RAIL,
  '/exchange/requests': NO_RAIL,

  // ---- Hosting -----------------------------------------------------------
  '/host/calendar': NO_RAIL,
  '/host/reservations': NO_RAIL,
  '/agent': NO_RAIL,
  '/agency/[slug]': NO_RAIL,

  // ---- Research: reviews, evictions, insights, addresses -----------------
  // These answer a geographic question of their own and state their own scope
  // (#353). A rail of unrelated listings beside them is the "not a considered
  // layout, the absence of one" case the issue names.
  '/reviews': NO_RAIL,
  '/reviews/write': NO_RAIL,
  '/reviews/city/[cityId]': NO_RAIL,
  '/reviews/neighborhood/[neighborhoodId]': NO_RAIL,
  '/evictions': NO_RAIL,
  '/evictions/new': NO_RAIL,
  '/evictions/[id]': NO_RAIL,
  '/insights': NO_RAIL,
  '/addresses/[id]': NO_RAIL,

  // ---- Roommates ---------------------------------------------------------
  '/roommates': NO_RAIL,
  '/roommates/[id]': NO_RAIL,
  '/roommates/preferences': NO_RAIL,

  // ---- Saved: folders, notes, alerts, watches -----------------------------
  // `ScreenId` used to carry a `saved-properties` value for these, pointing at
  // `/properties/saved` — a path that has never existed in this repository, so
  // that rail has never rendered. It is deleted rather than re-pointed here:
  // choosing a rail for the saved pages is a product decision nobody has made,
  // and inventing one from a dead constant would be guessing at intent.
  '/saved': NO_RAIL,
  '/saved/notes': NO_RAIL,
  '/saved/[folderId]': NO_RAIL,
  '/saved/[folderId]/edit': NO_RAIL,
  '/saved/alerts': NO_RAIL,
  '/saved/alerts/[alertId]': NO_RAIL,
  '/saved/watches/[watchId]': NO_RAIL,

  // ---- Sindi, inbox, notifications ---------------------------------------
  // Conversation surfaces own their full width.
  '/sindi': NO_RAIL,
  '/sindi/[conversationId]': NO_RAIL,
  '/sindi/shared/[token]': NO_RAIL,
  '/inbox': NO_RAIL,
  '/notifications': NO_RAIL,

  // ---- Settings and standalone pages -------------------------------------
  '/settings': NO_RAIL,
  '/settings/currency': NO_RAIL,
  '/settings/language': NO_RAIL,
  '/settings/notifications': NO_RAIL,
  '/settings/sindi': NO_RAIL,
  '/tips': NO_RAIL,
  '/tips/[slug]': NO_RAIL,
  '/donate': NO_RAIL,
  '/horizon': NO_RAIL,
};

/** What a pathname resolves to. `pattern` is `null` when nothing matched. */
export interface ResolvedRail {
  /** The widget set to render, or `null` for no rail. */
  readonly screenId: ScreenId | null;
  /** The route pattern that matched, or `null` for an unrecognised pathname. */
  readonly pattern: string | null;
  readonly propertyId?: string;
  readonly city?: string;
}

/** No pattern matched: render no rail. See {@link railForPathname}. */
const UNMATCHED: ResolvedRail = { screenId: null, pattern: null };

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function isDynamic(segment: string): boolean {
  return segment.startsWith('[') && segment.endsWith(']');
}

/**
 * The route patterns, pre-split. Built once at module load: the map is a
 * literal, so re-splitting 69 patterns on every navigation would be work with
 * no possible different answer.
 */
const PATTERNS: readonly { pattern: string; segments: string[] }[] = Object.keys(ROUTE_RAIL).map(
  (pattern) => ({ pattern, segments: segmentsOf(pattern) }),
);

/**
 * Resolve a pathname to its rail.
 *
 * **An unrecognised pathname gets NO rail**, which is the one residual left in
 * the system and is deliberate rather than a fall-through: nothing can reach it
 * except a pathname that is not a route at all (`+not-found`, a deep link to a
 * deleted screen, a typo), and rendering Home's widgets over a 404 was never a
 * decision anybody made. The totality test proves no REAL route reaches it.
 *
 * A static segment beats a dynamic one at the same position, so
 * `/properties/create` resolves to `/properties/create` and not to
 * `/properties/[id]` — the previous code needed an ordered ladder plus a list
 * of excluded words to achieve that, and the list is what went stale.
 */
export function railForPathname(pathname: string): ResolvedRail {
  // Defensive: `usePathname` does not include a query or hash, but a caller
  // passing `router`-shaped input should not silently miss every pattern.
  const path = pathname.split(/[?#]/)[0];
  const segments = segmentsOf(path);

  let bestPattern: string | null = null;
  let bestParams: Record<string, string> = {};
  let bestStatics = -1;

  for (const candidate of PATTERNS) {
    if (candidate.segments.length !== segments.length) continue;

    let statics = 0;
    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < segments.length; i += 1) {
      const expected = candidate.segments[i];
      if (isDynamic(expected)) {
        params[expected.slice(1, -1)] = segments[i];
      } else if (expected === segments[i]) {
        statics += 1;
      } else {
        matched = false;
        break;
      }
    }

    if (matched && statics > bestStatics) {
      bestPattern = candidate.pattern;
      bestParams = params;
      bestStatics = statics;
    }
  }

  if (bestPattern === null) return UNMATCHED;

  const assignment = ROUTE_RAIL[bestPattern];
  const propertyId = assignment.propertyIdParam
    ? bestParams[assignment.propertyIdParam]
    : undefined;
  const city = assignment.cityParam ? bestParams[assignment.cityParam] : undefined;

  return {
    screenId: assignment.rail,
    pattern: bestPattern,
    ...(propertyId ? { propertyId } : {}),
    ...(city ? { city } : {}),
  };
}
