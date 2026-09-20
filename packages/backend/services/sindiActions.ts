/**
 * Turning a turn into an ACTION, on the server (#519 §8.5).
 *
 * ## Why the server and not the model
 *
 * The obvious design is to give the model a tool and let it call one. Homiio
 * cannot do that today, and saying why matters more than the workaround:
 * Alia owns Sindi's tools and memory, and `@alia.onl/server@1.0.1` carries a
 * `alia.tool_result` event but Homiio has no evidence that the Sindi agent has
 * Homiio tools provisioned — #519 §8.5 is explicit that a prompt mentioning a
 * capability is not evidence of one. Coordinating that grant is an upstream
 * dependency, and this file is deliberately shaped so that landing it later
 * changes WHERE the intent comes from and nothing else downstream.
 *
 * What Homiio does own, already, is the intent extraction: `/ai/stream` has
 * run `extractFiltersWithAI` over the user's own message and performed the
 * search itself since long before this change. So the action is derived from a
 * structured extraction of what the PERSON asked, validated here, and executed
 * by the client against its own authorization.
 *
 * ## What this is NOT
 *
 * It is not a regex over the assistant's prose, and it is not
 * `<PROPERTIES_JSON>` repurposed as a command language — #519 §8.5 forbids both
 * by name. The text channel and the action channel never look at each other:
 * this function is called with the USER's message and the search Homiio ran,
 * and it has no access to what the model is about to say.
 *
 * ## Ambiguity is refused, not guessed — and the refusal is SAID
 *
 * A city name that resolves to several places produces no search. Taking the
 * first candidate is the homonym bug (ADR 0002 §12.2) arriving through a new
 * door, and #519 §8.6 says the right answer out loud: "Si un dato imprescindible
 * es ambiguo, pedir únicamente esa precisión dentro del chat".
 *
 * What this file got wrong was the second half. "Refused" was implemented as
 * "no envelope", and a turn that named a place Homiio could not commit to could
 * therefore emit nothing at all: the location was dropped from the patch, and
 * with nothing else in the sentence the patch was empty, and the empty patch
 * fell through to a `navigate` that was itself suppressed on `/explore` —
 * where, standing in front of a list of homes, is the most common place to ask.
 * The person asked about a specific place and the app neither went there nor
 * said it could not. That is ADR 0002 §1.3(c), "no signal anywhere in the UI
 * that the location was dropped", reached by a different route.
 *
 * So an unresolvable named place now emits `clarify_location` (#519 §8.6's
 * "pedir esa precisión"), and it emits it INSTEAD of a search — see
 * {@link searchOutcomeForTurn} for why the rest of the sentence does not get
 * applied to whatever area was in force.
 *
 * This is a fix for a CLASS of failure and not for one city. Hamburg, the case
 * that was reported twice, resolves today: migrations 0029 and 0030 folded the
 * duplicate `cities` rows and `/api/cities/lookup?city=hamburg` answers
 * `resolved`. Every name that is genuinely a homonym across regions is still
 * unresolvable by design, and always will be.
 */

import { randomUUID } from 'node:crypto';

import {
  citySelection,
  OfferingType,
  parseListingCurrency,
  PropertyType,
  SINDI_ACTION_VERSION,
  SINDI_REQUESTED_PLACE_MAX_LENGTH,
  type SindiActionEnvelope,
  type SindiAppContext,
  type SindiSearchPatch,
} from '@homiio/shared-types';

import { lookupCityPlaces } from '../db/geo/placeLookup';
import { logger } from '../middlewares/logging';

/** The extraction's own fields, as `/ai/stream` already produces them. */
export interface ExtractedSearchIntent {
  /** True only when the person asked to see listings in THIS message. */
  readonly wantsListings: boolean;
  readonly city?: string;
  readonly state?: string;
  readonly type?: string;
  readonly offering?: string;
  readonly minRent?: number;
  readonly maxRent?: number;
  readonly bedrooms?: number;
  readonly minBedrooms?: number;
  readonly bathrooms?: number;
  readonly minBathrooms?: number;
  readonly amenities?: readonly string[];
  readonly petFriendly?: boolean;
}

const OFFERINGS = new Set<string>(Object.values(OfferingType));
const PROPERTY_TYPES = new Set<string>(Object.values(PropertyType));

/** A positive, finite amount. Anything else is dropped rather than coerced. */
const amount = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** A room count: a non-negative integer. */
const rooms = (...candidates: (number | undefined)[]): number | undefined => {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0) {
      return candidate;
    }
  }
  return undefined;
};

/**
 * A place name trimmed to what the action contract will carry.
 *
 * The bound is the contract's own (`SINDI_REQUESTED_PLACE_MAX_LENGTH`) rather
 * than a number chosen here, because the client re-validates against it and
 * drops what exceeds it — and a refusal the client drops is the silence this
 * whole change is about, arriving one layer further down. The name comes from a
 * model's extraction of free text, which is precisely the input that can be
 * arbitrarily long; the LOOKUP still sees the untruncated name, so what is
 * clamped is only what gets read back.
 */
const echoableName = (name: string): string =>
  name.length <= SINDI_REQUESTED_PLACE_MAX_LENGTH
    ? name
    : name.slice(0, SINDI_REQUESTED_PLACE_MAX_LENGTH);

/**
 * Why a named city produced no area.
 *
 * `ambiguous` and `not_found` used to be flattened into one `null`, on the
 * reasoning that "from the action's point of view they mean the same thing".
 * They mean the same thing to the PATCH — there is no area Homiio can commit to
 * either way — and two different things to the person. "Which Barcelona did you
 * mean?" is answerable by naming a region; "I have no Atlantis" is not, and
 * asking somebody to refine a place that does not exist sends them looking for
 * a spelling mistake they did not make.
 */
export type UnresolvedPlaceReason = 'ambiguous' | 'not_found';

/** A place the turn named and Homiio could not commit to. */
export interface UnresolvedPlace {
  /** The name as the person used it, clamped to what the client's parser accepts. */
  readonly requested: string;
  readonly reason: UnresolvedPlaceReason;
}

/**
 * The area a turn names: a selection, or the reason there is none.
 *
 * A union rather than `| null` because the caller has to tell "no area was
 * asked for" from "an area was asked for and lost", and that is the whole
 * distinction ADR 0002 §4.3 turns on: "a request that names no location at all
 * is answered normally… the failure mode this ADR forbids is a location that
 * was requested and lost".
 */
type CityResolution =
  | { readonly status: 'resolved'; readonly selection: ReturnType<typeof citySelection> }
  | { readonly status: 'unresolved'; readonly reason: UnresolvedPlaceReason };

/**
 * How many candidates to look at before judging.
 *
 * More than two, because the duplicate rule below has to SEE the candidates to
 * tell duplicates from homonyms — asking for two is enough to learn that a name
 * is ambiguous and not enough to learn why.
 */
const CITY_CANDIDATE_LIMIT = 8;

/**
 * The city a turn names, or the reason Homiio cannot say which one.
 *
 * ## Ambiguity is refused, and that is not what was breaking
 *
 * `lookupCityPlaces` answers `ambiguous` rather than picking a row, and the
 * refusal is right: choosing between two real places on a popularity tiebreak
 * is the homonym bug (ADR 0002 §12.2).
 *
 * But it was also refusing "Barcelona". Production carries THREE `cities` rows
 * named Barcelona in Spain, all with the slug `barcelona` and two of them
 * holding **zero** listings. So the most ordinary request Sindi can receive —
 * "show me flats in Barcelona" — produced no location, and with no other
 * constraint in the sentence, no action at all. The person saw nothing happen
 * and nothing said.
 *
 * This comment used to go on to say that two of those three were duplicates
 * that migration 0029 removed by replacing the case-sensitive `(region_id,
 * name)` index with `(region_id, slug)`. **That was wrong, and it is wrong in
 * the direction that matters here, because it reads as though this rule were a
 * stopgap for a migration that has since landed.** The three rows are in three
 * different REGIONS — `Catalonia` (3 listings), `Barcelona` (0) and `barcelona`
 * (0) — so 0029 never saw them as duplicates, and all three are still in the
 * table. Several candidates for one slug ACROSS regions is precisely the case
 * ADR 0002 §12.2 says is legal and must stay legal, so no unique index can ever
 * remove it. This rule is what makes "Barcelona" resolve, today and after any
 * future region merge. `docs/postgres.md` carries the census and the
 * correction.
 *
 * ## The rule, and why it is not "pick the popular one"
 *
 * **A place with no listings cannot answer a question about listings there.**
 * That is not a tiebreak on relevance — `placeLookup`'s own header forbids
 * `properties_count` deciding between candidates, and this does not ask it to.
 * It asks something narrower and true: a row holding nothing is not a possible
 * answer to "what is in it", so it is not a candidate to be ambiguous WITH.
 *
 * Two genuine Barcelonas that both hold listings are still ambiguous and still
 * refused — which is the case the rule exists to protect, and the case a
 * popularity tiebreak would have got wrong.
 *
 * It lives HERE and not in `lookupCityPlaces`, because the rule is a property
 * of the QUESTION. A place picker offering somewhere to browse should still
 * show an empty city; only a search for listings may discount one.
 *
 * ## Why a discounted-to-nothing name is `ambiguous` and not `not_found`
 *
 * When the rule leaves zero candidates — several rows carry the name and none
 * of them holds a listing — the honest sentence is still "which one did you
 * mean?". The places exist; Homiio simply cannot answer "what is in it" for any
 * of them, and telling somebody their name matched nothing would be false.
 */
async function resolveCity(city: string, state: string | undefined): Promise<CityResolution> {
  const outcome = await lookupCityPlaces({
    token: city,
    ...(state ? { region: state } : {}),
    limit: CITY_CANDIDATE_LIMIT,
  });
  if (outcome.status === 'resolved') {
    return { status: 'resolved', selection: citySelection(outcome.place) };
  }
  if (outcome.status !== 'ambiguous') return { status: 'unresolved', reason: 'not_found' };

  const withListings = outcome.candidates.filter((candidate) => candidate.propertiesCount > 0);
  return withListings.length === 1
    ? { status: 'resolved', selection: citySelection(withListings[0]) }
    : { status: 'unresolved', reason: 'ambiguous' };
}

/**
 * What a turn asks of the search: a patch, a place that could not be resolved,
 * or neither.
 *
 * At most one of the two is ever set, and that is the decision this type
 * exists to record rather than to leave to a caller's discipline.
 */
export interface TurnSearchOutcome {
  /** The patch to apply, or `null` when the turn implies none. */
  readonly patch: SindiSearchPatch | null;
  /** Set only when the turn NAMED a place and Homiio could not commit to it. */
  readonly unresolvedPlace?: UnresolvedPlace;
}

/**
 * The patch a turn implies, the place it lost, or neither.
 *
 * "Neither" is the COMMON answer and the important one: most turns are about
 * rights, contracts or a specific home, and an assistant that navigated on
 * every message would be unusable. The gate is `wantsListings` — a field of the
 * same structured extraction, about the user's own words — plus the patch
 * having at least one real constraint in it.
 *
 * ## An unresolved place REPLACES the patch; it does not ride beside it
 *
 * This used to drop the `location` key and keep going, with the reasoning that
 * "the turn may still carry other constraints — 'under 1200, two bedrooms' —
 * and applying those to whatever area is in force is exactly the incremental
 * behaviour the patch shape is for". That reasoning is right for a turn that
 * named no place. It is wrong for one that named a place and lost it:
 * "muéstrame pisos en Hamburg por menos de 900" would narrow the area the
 * person was already looking at — Barcelona, say — to 900, navigate, and report
 * that it was done. They asked for Hamburg. ADR 0002 decision 5 forbids a
 * failed resolution running a query at all, and a query that silently inherits
 * a DIFFERENT city is worse than the location-less one §4.3 names: it answers
 * confidently about the wrong place.
 *
 * One action per turn makes this a choice rather than an ordering, and the
 * named place is the load-bearing half of the sentence. So the constraints are
 * dropped with it and the turn says what it could not do.
 */
export async function searchOutcomeForTurn(
  intent: ExtractedSearchIntent,
): Promise<TurnSearchOutcome> {
  const none: TurnSearchOutcome = { patch: null };
  if (!intent.wantsListings) return none;

  const patch: {
    offering?: OfferingType;
    location?: ReturnType<typeof citySelection>;
    propertyTypes?: PropertyType[];
    priceMin?: number;
    priceMax?: number;
    bedrooms?: number;
    bathrooms?: number;
    amenities?: string[];
    petFriendly?: boolean;
  } = {};

  if (intent.offering && OFFERINGS.has(intent.offering)) {
    patch.offering = intent.offering as OfferingType;
  }

  const named = intent.city?.trim();
  if (named) {
    const resolution = await resolveCity(named, intent.state);
    if (resolution.status === 'unresolved') {
      // Nothing else in the sentence survives the place it was about. See the
      // header above this function.
      return {
        patch: null,
        unresolvedPlace: { requested: echoableName(named), reason: resolution.reason },
      };
    }
    patch.location = resolution.selection;
  }

  if (intent.type && PROPERTY_TYPES.has(intent.type)) {
    patch.propertyTypes = [intent.type as PropertyType];
  }

  const priceMin = amount(intent.minRent);
  if (priceMin !== undefined) patch.priceMin = priceMin;
  const priceMax = amount(intent.maxRent);
  if (priceMax !== undefined) patch.priceMax = priceMax;

  const bedrooms = rooms(intent.bedrooms, intent.minBedrooms);
  if (bedrooms !== undefined) patch.bedrooms = bedrooms;
  const bathrooms = rooms(intent.bathrooms, intent.minBathrooms);
  if (bathrooms !== undefined) patch.bathrooms = bathrooms;

  const amenities = (intent.amenities ?? [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 12);
  if (amenities.length > 0) patch.amenities = amenities;

  if (typeof intent.petFriendly === 'boolean') patch.petFriendly = intent.petFriendly;

  // A patch with nothing in it would make Sindi claim to have applied a search
  // while leaving the screen identical. "Show me homes" with no constraint at
  // all is a request to OPEN Explore, not to filter it — and that is a
  // different action, emitted below.
  return Object.keys(patch).length > 0 ? { patch } : none;
}

export interface ActionEnvelopeInput {
  readonly turnId: string;
  readonly appContext: SindiAppContext;
  readonly conversationId?: string;
  readonly intent: ExtractedSearchIntent;
}

/**
 * The envelope to write onto the stream's data channel, or `null`.
 *
 * At most ONE action per turn, and that is a rule rather than a limitation: a
 * turn that navigated twice would leave the user somewhere neither step
 * announced, and the executor's dedupe cannot help because both would be
 * legitimate. A sequence needs its own design.
 *
 * The three branches are ORDERED, and the order is the fix:
 *
 *  1. **A place was named and lost.** Say so. It comes first because both of
 *     the branches below are worse answers to that turn than a sentence is —
 *     `apply_search` would narrow a different city, and `navigate` would open
 *     an unrestricted feed under a request for one place (ADR 0002 §1.3(c)).
 *  2. **A patch.** The ordinary case.
 *  3. **Listings asked for, nothing to filter on.** Open Explore.
 */
export async function actionEnvelopeForTurn(
  input: ActionEnvelopeInput,
): Promise<SindiActionEnvelope | null> {
  const envelope = (action: SindiActionEnvelope['action']): SindiActionEnvelope => ({
    version: SINDI_ACTION_VERSION,
    // Server-minted and unique per emission, so a retried or replayed frame
    // carries the SAME id and the client applies it once.
    actionId: randomUUID().replace(/-/g, ''),
    turnId: input.turnId,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    // Echoed verbatim. The client compares it against what its query is NOW,
    // so a filter the person changed by hand mid-turn wins.
    contextRevision: input.appContext.revision,
    action,
  });

  try {
    const outcome = await searchOutcomeForTurn(input.intent);

    if (outcome.unresolvedPlace) {
      return envelope({
        kind: 'clarify_location',
        requested: outcome.unresolvedPlace.requested,
        reason: outcome.unresolvedPlace.reason,
      });
    }

    if (outcome.patch) return envelope({ kind: 'apply_search', patch: outcome.patch });

    // Asked for listings with no constraint Homiio could pin down: open the
    // surface that owns an unbounded list rather than pretending to filter.
    //
    // Suppressed on `/explore`, and that suppression is CORRECT here in a way
    // it was not before. Reaching this line now means the turn named no place
    // at all — a named-and-lost one returned above — so the request is "show me
    // homes" from somebody already standing in front of them. There is nothing
    // to change, and `router.push('/explore')` from `/explore` would add a
    // back-stack entry, change nothing on screen, and report "Done: open
    // Explore" for it. The same rule `parseSindiSearchPatch` applies to an
    // empty patch applies to an empty navigation.
    if (input.intent.wantsListings && input.appContext.destination !== 'explore') {
      return envelope({ kind: 'navigate', destination: 'explore' });
    }

    return null;
  } catch (error: unknown) {
    // An action is an ENHANCEMENT. A failure here must never cost the person
    // their answer, so it is logged and the turn continues as text.
    logger.warn('Sindi action could not be derived for this turn', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Validate the app context a client sent.
 *
 * Total, and narrow on purpose: an unrecognised shape answers `null` and the
 * turn simply emits no action. The alternative — trusting the body — would let
 * a caller name a `contextRevision` that matches nothing, which is the one
 * field the staleness check depends on.
 *
 * Nothing here is used for AUTHORIZATION. The context describes a screen; the
 * identity of the person comes from the session, as it does everywhere else.
 */
export function parseAppContext(value: unknown): SindiAppContext | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const revision = raw.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null;

  const presentation = raw.presentation;
  if (presentation !== 'side_by_side' && presentation !== 'chat_only') return null;

  const destination = raw.destination;
  const validDestination =
    destination === null ||
    destination === 'explore' ||
    destination === 'saved' ||
    destination === 'home' ||
    destination === 'my_home' ||
    destination === 'evictions';
  if (!validDestination) return null;

  const text = (input: unknown, max: number): string | undefined =>
    typeof input === 'string' && input.length > 0 && input.length <= max ? input : undefined;
  const number = (input: unknown): number | undefined =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : undefined;

  const offering = text(raw.offering, 32);
  const locationToken = text(raw.locationToken, 256);
  const scopeLabel = text(raw.scopeLabel, 120);
  const priceMin = number(raw.priceMin);
  const priceMax = number(raw.priceMax);
  // Validated against the listing vocabulary, like every other closed set here:
  // an unknown code reaches the model as prose it would repeat back.
  const priceCurrency = parseListingCurrency(raw.priceCurrency);

  return {
    revision,
    presentation,
    destination: destination as SindiAppContext['destination'],
    ...(offering && OFFERINGS.has(offering) ? { offering: offering as OfferingType } : {}),
    ...(locationToken ? { locationToken } : {}),
    ...(scopeLabel ? { scopeLabel } : {}),
    ...(priceMin !== undefined ? { priceMin } : {}),
    ...(priceMax !== undefined ? { priceMax } : {}),
    ...(priceCurrency ? { priceCurrency } : {}),
  };
}

/** A turn id a client may supply. Same shape the action contract validates. */
export function parseTurnId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}
