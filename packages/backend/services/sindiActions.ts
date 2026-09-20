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
 * ## Ambiguity is refused, not guessed
 *
 * A city name that resolves to several places produces NO action. Taking the
 * first candidate is the homonym bug (ADR 0002 §12.2) arriving through a new
 * door, and #519 §8.6 says the right answer out loud: "Si un dato imprescindible
 * es ambiguo, pedir únicamente esa precisión dentro del chat". Sindi's prose
 * still answers; the app simply does not move.
 */

import { randomUUID } from 'node:crypto';

import {
  citySelection,
  OfferingType,
  parseListingCurrency,
  PropertyType,
  SINDI_ACTION_VERSION,
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
 * Resolve a city NAME to a selection, or answer why not.
 *
 * `ambiguous` and `not_found` both answer `null`, and the distinction is
 * deliberately not carried out of here: from the action's point of view they
 * mean the same thing — there is no area Homiio can commit — and the difference
 * belongs in the conversation, where Sindi's own text asks which Barcelona the
 * person meant.
 */
/**
 * How many candidates to look at before judging.
 *
 * More than two, because the duplicate rule below has to SEE the candidates to
 * tell duplicates from homonyms — asking for two is enough to learn that a name
 * is ambiguous and not enough to learn why.
 */
const CITY_CANDIDATE_LIMIT = 8;

/**
 * The city a turn names, or `null` when Homiio cannot say which one.
 *
 * ## Ambiguity is refused, and that is not what was breaking
 *
 * `lookupCityPlaces` answers `ambiguous` rather than picking a row, and the
 * refusal is right: choosing between two real places on a popularity tiebreak
 * is the homonym bug (ADR 0002 §12.2).
 *
 * But it was also refusing "Barcelona". Production carries THREE `cities` rows
 * named Barcelona in Spain — `Barcelona`, `barcelona` and another `Barcelona` —
 * all with the slug `barcelona`, and two of them holding **zero** listings.
 * They are duplicates, not homonyms: `cities_region_name_key` is unique on
 * `(region_id, name)` and is case-SENSITIVE, so a lower-cased name slips past
 * it, and a second region inside the same country takes the rest. So the most
 * ordinary request Sindi can receive — "show me flats in Barcelona" — produced
 * no location, and with no other constraint in the sentence, no action at all.
 * The person saw nothing happen and nothing said.
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
 */
async function resolveCity(
  city: string,
  state: string | undefined,
): Promise<ReturnType<typeof citySelection> | null> {
  const outcome = await lookupCityPlaces({
    token: city,
    ...(state ? { region: state } : {}),
    limit: CITY_CANDIDATE_LIMIT,
  });
  if (outcome.status === 'resolved') return citySelection(outcome.place);
  if (outcome.status !== 'ambiguous') return null;

  const withListings = outcome.candidates.filter((candidate) => candidate.propertiesCount > 0);
  return withListings.length === 1 ? citySelection(withListings[0]) : null;
}

/**
 * The patch a turn implies, or `null` when it implies none.
 *
 * `null` is the COMMON answer and the important one: most turns are about
 * rights, contracts or a specific home, and an assistant that navigated on
 * every message would be unusable. The gate is `wantsListings` — a field of the
 * same structured extraction, about the user's own words — plus the patch
 * having at least one real constraint in it.
 */
export async function searchPatchForTurn(
  intent: ExtractedSearchIntent,
): Promise<SindiSearchPatch | null> {
  if (!intent.wantsListings) return null;

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

  if (intent.city) {
    const selection = await resolveCity(intent.city, intent.state);
    // No selection means the area is ambiguous or unknown. The turn may still
    // carry other constraints — "under 1200, two bedrooms" — and applying those
    // to whatever area is in force is exactly the incremental behaviour the
    // patch shape is for.
    if (selection) patch.location = selection;
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
  return Object.keys(patch).length > 0 ? patch : null;
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
 */
export async function actionEnvelopeForTurn(
  input: ActionEnvelopeInput,
): Promise<SindiActionEnvelope | null> {
  try {
    const patch = await searchPatchForTurn(input.intent);
    if (patch) {
      return {
        version: SINDI_ACTION_VERSION,
        // Server-minted and unique per emission, so a retried or replayed frame
        // carries the SAME id and the client applies it once.
        actionId: randomUUID().replace(/-/g, ''),
        turnId: input.turnId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        // Echoed verbatim. The client compares it against what its query is NOW,
        // so a filter the person changed by hand mid-turn wins.
        contextRevision: input.appContext.revision,
        action: { kind: 'apply_search', patch },
      };
    }

    // Asked for listings with no constraint Homiio could pin down: open the
    // surface that owns an unbounded list rather than pretending to filter.
    if (input.intent.wantsListings && input.appContext.destination !== 'explore') {
      return {
        version: SINDI_ACTION_VERSION,
        actionId: randomUUID().replace(/-/g, ''),
        turnId: input.turnId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        contextRevision: input.appContext.revision,
        action: { kind: 'navigate', destination: 'explore' },
      };
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
