/**
 * What Sindi is allowed to do to the app, as a closed, versioned contract
 * (#519 §8.4).
 *
 * ## The shape of the problem
 *
 * "Sindi debe actuar sobre la app cuando permanece al lado de ella." Asking for
 * flats under €1,200 with the panel docked should open `/explore` with those
 * filters applied, in the main pane, without closing the chat. With the chat
 * full-screen, the same request shows cards inside the conversation instead.
 *
 * The dangerous way to build that is a command language: let the model emit
 * something the client executes. Three rules in this file exist to make that
 * unreachable rather than discouraged.
 *
 * **1. The union is CLOSED and narrow.** Five intents, each with a payload the
 * client re-validates. There is no `eval`, no generated JavaScript, no DOM
 * click, no arbitrary URL, no API method chosen by a model, no SQL. A sixth
 * intent is a deliberate edit to this file, reviewed, not a string that happens
 * to arrive.
 *
 * **2. Nothing here writes.** Navigating and querying are the whole scope.
 * Paying, signing, applying, messaging a third party, publishing and deleting
 * are NOT in the union and may not be added to it: each needs its own explicit
 * action and its own domain controls. "Controlling the app" is not a session
 * with unlimited permissions.
 *
 * **3. An action is bound to a TURN.** `turnId` and `actionId` are what make
 * replay, reconnection, a shared transcript and a cancelled turn all safe: an
 * envelope whose turn is not the active one is ignored, and one whose
 * `actionId` has already run is ignored. Rendering Markdown from history
 * executes nothing, because history carries text and this channel does not
 * reach it.
 *
 * ## Why the payloads are not the frontend's `SearchQuery`
 *
 * `components/search/types.ts` is a React-adjacent module and the backend may
 * not import it (#519 §8.6). {@link SindiSearchPatch} is the pure subset both
 * sides can hold, and it is a PATCH: absent keys leave the live query alone,
 * which is the "un cambio incremental conserva los filtros no mencionados"
 * rule expressed in the type rather than in an executor's discipline.
 *
 * ## The currency gap, stated rather than papered over
 *
 * {@link SindiSearchPatch} has no currency field, and that is deliberate.
 * Homiio's price filter today has exactly one implicit currency
 * (`SEARCH_PRICE_CURRENCY`, euros) all the way through the URL, the store and
 * the SQL. Adding a currency here would be a field the server ignores — which
 * #519 §6.1 forbids in the same breath as it asks for the currency work. The
 * gap is that row's, not this one's, and it is named in `docs/sindi-actions.md`.
 */

import type { LocationSelection } from './location';
import type { OfferingType, PropertyType } from './common';

/** The contract version. Bumped when a payload's MEANING changes, never for an addition. */
export const SINDI_ACTION_VERSION = 1;

/**
 * A patch over the live search query.
 *
 * ABSENT means "leave it alone". That is the whole reason this is a patch and
 * not a query: "ahora con dos habitaciones y que admitan mascotas" must keep
 * the area and the budget the previous turn established, and a full query would
 * silently reset every field the model did not restate.
 *
 * `location` is the one field that replaces rather than merges, because a
 * geographic selection is atomic (ADR 0002 §3): "the old city with the new
 * bounds" is the single largest source of wrong results and is unrepresentable
 * by construction.
 */
export interface SindiSearchPatch {
  readonly offering?: OfferingType;
  /** Replaces the whole geographic selection. `null` is NOT permitted — see the executor. */
  readonly location?: LocationSelection;
  /** What the user typed, as text. Never a place label (ADR 0002 §4.1). */
  readonly queryText?: string | null;
  readonly propertyTypes?: readonly PropertyType[];
  /** In the search's single implicit currency. See the module header. */
  readonly priceMin?: number;
  readonly priceMax?: number;
  /** A MINIMUM, matching the search contract's own semantics. */
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly amenities?: readonly string[];
  readonly petFriendly?: boolean;
}

/**
 * How Explore presents its results. Presentation only — never a filter change.
 */
export type SindiResultsView = 'list' | 'map';

/**
 * The destinations Sindi may navigate to, ENUMERATED.
 *
 * A closed list rather than a path, because a path is a string and a string is
 * an open door: `navigate` with an arbitrary URL would let a model send
 * somebody to an external site, to a destructive route, or to a deep link with
 * an id it invented. Each member maps to one Expo Router route in the executor.
 */
export type SindiDestination = 'explore' | 'saved' | 'home' | 'my_home' | 'evictions';

export type SindiAction =
  /** Run a search. The canonical pipeline executes it; Sindi never queries the client's behalf. */
  | { readonly kind: 'apply_search'; readonly patch: SindiSearchPatch }
  /**
   * Show the person's own saved items.
   *
   * `folderId` is re-authorised by the executor against the signed-in account.
   * A responsive capability grants no permissions: the id travelling through a
   * chat channel is not evidence that its owner is the person reading it.
   */
  | { readonly kind: 'show_saved'; readonly folderId?: string }
  /** Open one listing. The id is validated and fetched under the caller's own identity. */
  | { readonly kind: 'open_listing'; readonly propertyId: string }
  /** Switch Explore between list and map. Filters untouched. */
  | { readonly kind: 'set_results_view'; readonly view: SindiResultsView }
  /** Go to an enumerated destination. Never a URL. */
  | { readonly kind: 'navigate'; readonly destination: SindiDestination };

/**
 * One action, addressed to one turn.
 *
 * Every field outside `action` exists to answer "may this still be applied?",
 * and each answers a different failure:
 *
 *  - `version` — a client holding an older contract ignores what it cannot
 *    validate, rather than guessing at a payload whose meaning changed.
 *  - `actionId` — dedupe. A reconnection that replays the stream, or a double
 *    delivery, must not navigate twice.
 *  - `turnId` — an action from a cancelled or superseded turn is ignored. This
 *    is what makes "Stop" actually stop.
 *  - `conversationId` — an action addressed to another conversation (a second
 *    panel, a switched account) is ignored.
 *  - `contextRevision` — the revision of the app context the SERVER was given.
 *    If the user has changed a filter by hand since, the action is `stale`: the
 *    manual change wins, and #519 §8.8 says so in those words.
 */
export interface SindiActionEnvelope {
  readonly version: number;
  readonly actionId: string;
  readonly turnId: string;
  readonly conversationId?: string;
  readonly contextRevision: number;
  readonly action: SindiAction;
}

/**
 * What the client did with it.
 *
 * Reported so Sindi never claims to have changed filters the executor did not
 * change. `inline` is not a failure: it is the full-screen answer, where the
 * results are cards in the conversation and the router is deliberately not
 * called.
 */
export type SindiActionOutcome =
  /** Applied to the main pane. */
  | 'applied'
  /** Presented inside the conversation instead. */
  | 'inline'
  /** Refused: bad payload, unknown destination, unauthorised resource. */
  | 'rejected'
  /** Superseded: the context moved, or the turn is no longer active. */
  | 'stale'
  /** Attempted and failed. */
  | 'failed';

/**
 * How Sindi may present a result, derived from the EFFECTIVE layout.
 *
 * Not from the platform: "una pestaña web estrecha o la ruta Sindi fullscreen en
 * un monitor grande siguen siendo chat-only. Una tablet nativa suficientemente
 * ancha puede permitir control lateral." (#519 §8.2)
 */
export type SindiPresentation = 'side_by_side' | 'chat_only';

/**
 * The app context sent WITH a turn.
 *
 * Deliberately tiny. #519 §8.3 lists what may never travel — DOM snapshots, the
 * whole Zustand store, an IP, exact GPS, tokens, documents, contacts, the full
 * contents of somebody's saved list — and the shape of this interface is the
 * enforcement: there is nowhere to put any of it.
 *
 * `scopeLabel` is the AREA'S NAME and never a coordinate. `locationToken` is the
 * `loc` token, which by ADR 0002 §8.2 carries no coordinate either — the device
 * case serialises to `here.<radius>`, with no position in it.
 */
export interface SindiAppContext {
  /** Bumped by the client whenever the live query changes. See `contextRevision`. */
  readonly revision: number;
  readonly presentation: SindiPresentation;
  /** Where the user is now, as an enumerated destination, or null for anywhere else. */
  readonly destination: SindiDestination | null;
  readonly offering?: OfferingType;
  /** The committed scope's `loc` token. Never a coordinate. */
  readonly locationToken?: string;
  /** The area's display name, for the model's prose. Never an address. */
  readonly scopeLabel?: string;
  readonly priceMin?: number;
  readonly priceMax?: number;
}

/** Every destination, for validation and for an exhaustive switch in the executor. */
export const SINDI_DESTINATIONS: readonly SindiDestination[] = [
  'explore',
  'saved',
  'home',
  'my_home',
  'evictions',
];

const RESULTS_VIEWS: readonly SindiResultsView[] = ['list', 'map'];

/** An id shape a chat channel may carry. Deliberately strict; see `parseSindiAction`. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const nonNegativeInteger = (value: unknown): number | undefined => {
  const n = finiteNumber(value);
  return n !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined;
};

const shortString = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

const stringArray = (value: unknown, max: number): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 64);
  return out.slice(0, max);
};

/**
 * Validate a search patch, dropping everything it does not recognise.
 *
 * DROPPING rather than rejecting the whole patch, for one case and with one
 * consequence worth stating: a future contract version adding a field would
 * otherwise make every action from a newer server unusable by an older client,
 * turning an additive change into a breaking one. The cost is that an unknown
 * field is silently ignored — acceptable, because the executor reports what it
 * APPLIED and the surface shows the resulting filters, so a dropped field is
 * visible to the person rather than hidden.
 *
 * `location` is passed through structurally UNVALIDATED here and re-validated by
 * the executor against the location contract's own parser; duplicating ADR
 * 0002's union in this file is how the two would diverge.
 */
export function parseSindiSearchPatch(value: unknown): SindiSearchPatch | null {
  if (!isRecord(value)) return null;
  const patch: {
    offering?: OfferingType;
    location?: LocationSelection;
    queryText?: string | null;
    propertyTypes?: readonly PropertyType[];
    priceMin?: number;
    priceMax?: number;
    bedrooms?: number;
    bathrooms?: number;
    amenities?: readonly string[];
    petFriendly?: boolean;
  } = {};

  if (typeof value.offering === 'string') patch.offering = value.offering as OfferingType;
  if (isRecord(value.location)) patch.location = value.location as unknown as LocationSelection;
  if (value.queryText === null) patch.queryText = null;
  else {
    const text = shortString(value.queryText, 200);
    if (text !== undefined) patch.queryText = text;
  }
  const types = stringArray(value.propertyTypes, 8);
  if (types && types.length > 0) patch.propertyTypes = types as readonly PropertyType[];
  const priceMin = finiteNumber(value.priceMin);
  if (priceMin !== undefined && priceMin >= 0) patch.priceMin = priceMin;
  const priceMax = finiteNumber(value.priceMax);
  if (priceMax !== undefined && priceMax >= 0) patch.priceMax = priceMax;
  const bedrooms = nonNegativeInteger(value.bedrooms);
  if (bedrooms !== undefined) patch.bedrooms = bedrooms;
  const bathrooms = nonNegativeInteger(value.bathrooms);
  if (bathrooms !== undefined) patch.bathrooms = bathrooms;
  const amenities = stringArray(value.amenities, 12);
  if (amenities && amenities.length > 0) patch.amenities = amenities;
  if (typeof value.petFriendly === 'boolean') patch.petFriendly = value.petFriendly;

  // A patch that changes NOTHING is not an action. Emitting one would make
  // Sindi claim to have applied a search while leaving the screen identical.
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Validate an action. `null` for anything not in the closed union. */
export function parseSindiAction(value: unknown): SindiAction | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'apply_search': {
      const patch = parseSindiSearchPatch(value.patch);
      return patch ? { kind: 'apply_search', patch } : null;
    }
    case 'show_saved': {
      if (value.folderId === undefined) return { kind: 'show_saved' };
      const folderId = shortString(value.folderId, 64);
      // A malformed id is a REJECTION, not a fallback to the whole list: a
      // folder the person did not ask for is a different answer, and quietly
      // widening the scope of "show me what I saved" is the wrong direction.
      return folderId && ID_PATTERN.test(folderId) ? { kind: 'show_saved', folderId } : null;
    }
    case 'open_listing': {
      const propertyId = shortString(value.propertyId, 64);
      return propertyId && ID_PATTERN.test(propertyId)
        ? { kind: 'open_listing', propertyId }
        : null;
    }
    case 'set_results_view': {
      const view = RESULTS_VIEWS.find((candidate) => candidate === value.view);
      return view ? { kind: 'set_results_view', view } : null;
    }
    case 'navigate': {
      const destination = SINDI_DESTINATIONS.find((candidate) => candidate === value.destination);
      return destination ? { kind: 'navigate', destination } : null;
    }
    default:
      return null;
  }
}

/**
 * Validate an envelope arriving on the stream's data channel.
 *
 * Total: every shape that is not an envelope of this version answers `null`,
 * including a fragment, a duplicate of something else's data frame, or a
 * payload from a future version. The caller treats `null` as "not for me" and
 * moves on, which is why an unrelated `data` frame cannot crash the chat.
 */
export function parseSindiActionEnvelope(value: unknown): SindiActionEnvelope | null {
  if (!isRecord(value)) return null;
  if (value.version !== SINDI_ACTION_VERSION) return null;

  const actionId = shortString(value.actionId, 64);
  const turnId = shortString(value.turnId, 64);
  if (!actionId || !turnId) return null;
  if (!ID_PATTERN.test(actionId) || !ID_PATTERN.test(turnId)) return null;

  const contextRevision = nonNegativeInteger(value.contextRevision);
  if (contextRevision === undefined) return null;

  const action = parseSindiAction(value.action);
  if (!action) return null;

  const conversationId = shortString(value.conversationId, 64);

  return {
    version: SINDI_ACTION_VERSION,
    actionId,
    turnId,
    ...(conversationId && ID_PATTERN.test(conversationId) ? { conversationId } : {}),
    contextRevision,
    action,
  };
}
