/**
 * What Sindi (and Alia, inside Homiio) may do to the app on the person's screen,
 * as a closed contract: the host tools Homiio declares to Alia
 * (`docs/agent-embedding.md` §2 in the Alia repository, Alia ADR 0020 §6).
 *
 * ## The shape of the problem
 *
 * "Sindi debe actuar sobre la app cuando permanece al lado de ella." Asking for
 * flats under €1,200 with the panel docked opens `/explore` with those filters,
 * in the main pane, without closing the chat.
 *
 * The model asks for an effect by calling a host tool (`host_homiio__<kind>`);
 * Alia emits `alia.host_action` to the client that declared it, and the
 * executor (`frontend/hooks/useSindiActions.ts`) performs it and answers one of
 * `applied | inline | rejected | stale | failed`, which becomes that call's
 * result on the next turn. Three rules here keep that from becoming a command
 * language:
 *
 * **1. The union is CLOSED and narrow.** Five intents, each with a payload the
 * client re-validates. There is no `eval`, no generated JavaScript, no DOM
 * click, no arbitrary URL, no API method chosen by a model, no SQL. A sixth
 * intent is a deliberate edit to this file, reviewed.
 *
 * **2. Nothing here writes.** Navigating and querying are the whole scope. A
 * write (saving, applying, paying…) is a catalogue tool on Homiio's backend
 * (`backend/capabilities/*`), authorised by Oxy for the person present — a host
 * tool is never authority over data.
 *
 * **3. ONE source for the schema and the parser.** {@link SINDI_HOST_TOOLS}
 * carries every tool's JSON Schema and its parser, both built from the same
 * field table, so what the model is told it may send and what the client
 * accepts cannot drift apart.
 *
 * ## Why the payloads are not the frontend's `SearchQuery`
 *
 * `components/search/types.ts` is a React-adjacent module. {@link SindiSearchPatch}
 * is the pure subset, and it is a PATCH: absent keys leave the live query alone,
 * which is the "un cambio incremental conserva los filtros no mencionados" rule
 * expressed in the type rather than in an executor's discipline.
 *
 * ## Why there is no currency field
 *
 * Somebody who says "under 1,200" has named an amount and not a unit; there is
 * nothing in the utterance to put in the field, and filling it from the last
 * scope would apply their number in a currency they never mentioned. So a price
 * patch carries the bound alone, and `applySearchPatch` CLEARS the currency in
 * play when it lands — the server then answers the unit from the listings in
 * the scope the patch is about.
 *
 * ## Why a place that did not resolve is not an action
 *
 * "Muéstrame pisos en Hamburg" with two Hamburgs must be SAID, not silently
 * dropped (ADR 0002 §12.2, §1.3(c)). That is the `resolvePlace` catalogue tool's
 * answer (`ambiguous` / `not_found`), drawn in the conversation by Homiio's
 * renderer for that tool — not a host tool, because a host tool moves the app
 * and draws nothing in the thread.
 */

import type { ListingCurrency } from './currency';
import type { LocationSelection } from './location';
import { OfferingType, PropertyType } from './common';

/**
 * A patch over the live search query.
 *
 * ABSENT means "leave it alone": "ahora con dos habitaciones y que admitan
 * mascotas" must keep the area and the budget the previous turn established.
 *
 * `location` is the one field that replaces rather than merges, because a
 * geographic selection is atomic (ADR 0002 §3).
 */
export interface SindiSearchPatch {
  readonly offering?: OfferingType;
  /** Replaces the whole geographic selection. */
  readonly location?: LocationSelection;
  /** What the person typed, as text. Never a place label (ADR 0002 §4.1). */
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

/** How Explore presents its results. Presentation only — never a filter change. */
export type SindiResultsView = 'list' | 'map';

/**
 * The destinations Sindi may navigate to, ENUMERATED: a path is a string and a
 * string is an open door. Each member maps to one Expo Router route in the
 * executor.
 */
export type SindiDestination = 'explore' | 'saved' | 'home' | 'my_home' | 'evictions';

export type SindiAction =
  /** Run a search. The canonical pipeline executes it. */
  | { readonly kind: 'apply_search'; readonly patch: SindiSearchPatch }
  /**
   * Show the person's own saved items. `folderId` only FILTERS what the
   * person's own session returns: an id naming somebody else's collection
   * matches nothing.
   */
  | { readonly kind: 'show_saved'; readonly folderId?: string }
  /** Open one listing. The screen fetches it under the person's own identity. */
  | { readonly kind: 'open_listing'; readonly propertyId: string }
  /** Switch Explore between list and map. Filters untouched. */
  | { readonly kind: 'set_results_view'; readonly view: SindiResultsView }
  /** Go to an enumerated destination. Never a URL. */
  | { readonly kind: 'navigate'; readonly destination: SindiDestination };

export type SindiActionKind = SindiAction['kind'];

/**
 * What the client did with an action — the host tool's outcome as Alia's wire
 * contract names it. Reported so the model never claims to have changed filters
 * the executor did not change.
 */
export type SindiActionOutcome =
  /** Applied to the app. */
  | 'applied'
  /** Not performed: the surface cannot show a result; the answer stays in the conversation. */
  | 'inline'
  /** Refused: bad payload, unknown destination. */
  | 'rejected'
  /** Superseded: the person changed the search by hand during the turn. */
  | 'stale'
  /** Attempted and failed. */
  | 'failed';

/**
 * How Sindi may present a result, derived from the surface and the layout — not
 * from the platform (#519 §8.2). `side_by_side` is the docked panel alone.
 */
export type SindiPresentation = 'side_by_side' | 'chat_only';

/**
 * What the app shows, sent with every turn as Alia's `clientContext`.
 *
 * Deliberately tiny. #519 §8.3 lists what may never travel — DOM snapshots, the
 * whole store, an IP, exact GPS, tokens, documents, contacts, the contents of
 * somebody's saved list — and the shape of this interface is the enforcement.
 * `locationToken` is the `loc` token, which by ADR 0002 §8.2 carries no
 * coordinate; `scopeLabel` is the area's name, already on screen.
 */
export interface SindiAppContext {
  /** A hash of the live query. The executor compares it to detect a manual change mid-turn. */
  readonly revision: number;
  readonly presentation: SindiPresentation;
  /** Where the person is now, as an enumerated destination, or null for anywhere else. */
  readonly destination: SindiDestination | null;
  /** The listing open on screen, when the person is reading one. */
  readonly listingId?: string;
  readonly offering?: OfferingType;
  /** The committed scope's `loc` token. Never a coordinate. */
  readonly locationToken?: string;
  /** The area's display name, for the model's prose. Never an address. */
  readonly scopeLabel?: string;
  readonly priceMin?: number;
  readonly priceMax?: number;
  /** The unit those bounds are in, when a scope has answered, so the model can SAY it. */
  readonly priceCurrency?: ListingCurrency;
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

// ── The field table: one parser and one JSON Schema per field ──────────────

/** A JSON Schema fragment, as the host-tool declaration carries it. */
export type SindiJsonSchema = Readonly<Record<string, unknown>>;

interface Field<T> {
  readonly schema: SindiJsonSchema;
  /** The value, or `undefined` when it is not acceptable. */
  readonly parse: (value: unknown) => T | undefined;
}

/** An id shape a chat channel may carry. Deliberately strict. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const oneOf = <T extends string>(values: readonly T[], description: string): Field<T> => ({
  schema: { type: 'string', enum: [...values], description },
  parse: (value) => values.find((candidate) => candidate === value),
});

const text = (maxLength: number, description: string): Field<string> => ({
  schema: { type: 'string', minLength: 1, maxLength, description },
  parse: (value) =>
    typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : undefined,
});

const id = (description: string): Field<string> => ({
  schema: { type: 'string', pattern: ID_PATTERN.source, description },
  parse: (value) => (typeof value === 'string' && ID_PATTERN.test(value) ? value : undefined),
});

const amount = (description: string): Field<number> => ({
  schema: { type: 'number', minimum: 0, description },
  parse: (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined,
});

const count = (description: string): Field<number> => ({
  schema: { type: 'integer', minimum: 0, description },
  parse: (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined,
});

const list = <T extends string>(
  item: Field<T>,
  maxItems: number,
  description: string,
): Field<readonly T[]> => ({
  schema: { type: 'array', items: item.schema, maxItems, description },
  parse: (value) => {
    if (!Array.isArray(value)) return undefined;
    const items = value.flatMap((entry) => {
      const parsed = item.parse(entry);
      return parsed === undefined ? [] : [parsed];
    });
    return items.length > 0 ? items.slice(0, maxItems) : undefined;
  },
});

/**
 * The search patch, field by field.
 *
 * An unacceptable field is DROPPED rather than failing the whole patch: the
 * executor reports what it applied and the screen shows the resulting filters,
 * so a dropped field is visible to the person rather than hidden.
 *
 * `location` is checked only for being an object here and re-validated by the
 * executor (`exploreHref` refuses a selection the `loc` grammar cannot carry):
 * duplicating ADR 0002's union in this file is how the two would diverge.
 */
const SEARCH_PATCH_FIELDS: {
  readonly [K in keyof SindiSearchPatch]-?: Field<SindiSearchPatch[K]>;
} = {
  offering: oneOf(
    Object.values(OfferingType),
    'What the person is looking for: long_term_rent (monthly rent), short_term_rent (by the night), sale or exchange. Changing it clears the price range.',
  ),
  location: {
    schema: {
      type: 'object',
      description:
        "Replaces the whole area. A LocationSelection: for a city, the `location` that resolvePlace answered with `status: 'resolved'`. Never guess one — when resolvePlace answers ambiguous or not_found, ask the person instead.",
    },
    parse: (value) => (isRecord(value) ? (value as unknown as LocationSelection) : undefined),
  },
  queryText: {
    schema: {
      type: ['string', 'null'],
      maxLength: 200,
      description: 'Free text the person asked to search for (not a place name). null clears it.',
    },
    parse: (value) => (value === null ? null : text(200, '').parse(value)),
  },
  propertyTypes: list(
    oneOf(Object.values(PropertyType), 'A property type.'),
    8,
    'Only these property types.',
  ),
  priceMin: amount('The lowest price, in the currency of the area searched. No currency field.'),
  priceMax: amount('The highest price, in the currency of the area searched. No currency field.'),
  bedrooms: count('At least this many bedrooms.'),
  bathrooms: count('At least this many bathrooms.'),
  amenities: list(text(64, 'An amenity key.'), 12, 'Required amenities.'),
  petFriendly: {
    schema: { type: 'boolean', description: 'Only homes that accept pets.' },
    parse: (value) => (typeof value === 'boolean' ? value : undefined),
  },
};

/** Validate a search patch, dropping what it does not recognise. `null` when nothing is left. */
export function parseSindiSearchPatch(value: unknown): SindiSearchPatch | null {
  if (!isRecord(value)) return null;
  const patch: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(SEARCH_PATCH_FIELDS) as [
    keyof SindiSearchPatch,
    Field<unknown>,
  ][]) {
    if (!(key in value)) continue;
    const parsed = field.parse(value[key]);
    if (parsed !== undefined) patch[key] = parsed;
  }
  // A patch that changes NOTHING is not an action: applying it would claim a
  // search while leaving the screen identical.
  return Object.keys(patch).length > 0 ? (patch as SindiSearchPatch) : null;
}

/** One host tool: what the model is told, and how its input becomes a {@link SindiAction}. */
export interface SindiHostTool {
  readonly name: SindiActionKind;
  readonly description: string;
  /** A JSON Schema with an object root, built from the same fields as {@link SindiHostTool.parse}. */
  readonly inputSchema: SindiJsonSchema;
  /** The action, or `null` for an input outside the contract. */
  readonly parse: (input: unknown) => SindiAction | null;
}

/**
 * A tool whose input is a fixed set of fields. A REQUIRED field that is missing
 * or unacceptable refuses the call; an OPTIONAL one that is present but
 * unacceptable refuses it too — quietly widening "show me that collection" to
 * every collection answers a different question.
 */
function fieldsTool<K extends SindiActionKind>(
  name: K,
  description: string,
  fields: Readonly<Record<string, { readonly field: Field<unknown>; readonly required: boolean }>>,
  build: (values: Record<string, unknown>) => Extract<SindiAction, { kind: K }>,
): SindiHostTool {
  const entries = Object.entries(fields);
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(entries.map(([key, { field }]) => [key, field.schema])),
      required: entries.filter(([, { required }]) => required).map(([key]) => key),
      additionalProperties: false,
    },
    parse: (input) => {
      if (!isRecord(input)) return null;
      const values: Record<string, unknown> = {};
      for (const [key, { field, required }] of entries) {
        if (input[key] === undefined) {
          if (required) return null;
          continue;
        }
        const parsed = field.parse(input[key]);
        if (parsed === undefined) return null;
        values[key] = parsed;
      }
      return build(values);
    },
  };
}

/**
 * Every host tool Homiio declares, in the order the model sees them.
 *
 * The descriptions carry the one product rule that is not a type: asking about
 * homes is not asking to be taken somewhere. Sindi answers "¿qué pisos hay en
 * Gràcia?" with `searchListings` (drawn as cards in the conversation) and uses
 * `apply_search` only when the person wants the app to show them.
 */
export const SINDI_HOST_TOOLS: readonly SindiHostTool[] = [
  {
    name: 'apply_search',
    description:
      'Open Homiio\'s Explore screen with these search filters, as a PATCH over the search on screen: omitted fields keep their current value. Use it when the person wants the app to show them homes ("show me", "open", "filter"); to answer a question about homes, call searchListings instead. For a place name, call resolvePlace first and pass its `location`.',
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(SEARCH_PATCH_FIELDS).map(([key, field]) => [key, field.schema]),
      ),
      additionalProperties: false,
    },
    parse: (input) => {
      const patch = parseSindiSearchPatch(input);
      return patch ? { kind: 'apply_search', patch } : null;
    },
  },
  fieldsTool(
    'show_saved',
    "Open the person's saved homes, or one of their saved collections.",
    {
      folderId: {
        field: id('A collection id from listSavedFolders. Omitted: everything saved.'),
        required: false,
      },
    },
    ({ folderId }) =>
      folderId === undefined
        ? { kind: 'show_saved' }
        : { kind: 'show_saved', folderId: folderId as string },
  ),
  fieldsTool(
    'open_listing',
    "Open one listing's page in the app.",
    {
      propertyId: {
        field: id('The listing id, as searchListings or getListing returned it.'),
        required: true,
      },
    },
    ({ propertyId }) => ({ kind: 'open_listing', propertyId: propertyId as string }),
  ),
  fieldsTool(
    'set_results_view',
    'Show the Explore results as a list or on the map. Filters are untouched.',
    { view: { field: oneOf(RESULTS_VIEWS, 'list or map.'), required: true } },
    ({ view }) => ({ kind: 'set_results_view', view: view as SindiResultsView }),
  ),
  fieldsTool(
    'navigate',
    'Go to one of these screens of the app.',
    {
      destination: {
        field: oneOf(
          SINDI_DESTINATIONS,
          'explore (search), saved (saved homes), home, my_home (the home the person lives in), evictions (the eviction board).',
        ),
        required: true,
      },
    },
    ({ destination }) => ({ kind: 'navigate', destination: destination as SindiDestination }),
  ),
];

/** The action a host-tool call asks for, or `null` for an unknown tool or an input outside the contract. */
export function parseSindiHostCall(name: string, input: unknown): SindiAction | null {
  return SINDI_HOST_TOOLS.find((tool) => tool.name === name)?.parse(input) ?? null;
}

/** Validate an action object (`{ kind, …fields }`; `apply_search` carries `patch`). */
export function parseSindiAction(value: unknown): SindiAction | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  const { kind, ...input } = value;
  return parseSindiHostCall(kind, kind === 'apply_search' ? value.patch : input);
}
