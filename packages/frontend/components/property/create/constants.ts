/**
 * Static configuration for the property creation wizard.
 *
 * Extracted verbatim from `app/properties/create.tsx` so the orchestrator and
 * the per-step components share a single source of truth. The shapes and values
 * are unchanged to preserve the exact wizard behaviour (step order, which
 * fields are visible per type/step, and picker options).
 */
import { ExchangeMode, OfferingType } from '@homiio/shared-types';

/**
 * The property types a host can publish, in tile order. Labels are
 * `properties.titles.types.<id>`; icons are Bloom's (`DEFAULT_PROPERTY_TYPES`).
 */
export const PROPERTY_TYPE_IDS = ['apartment', 'house', 'room', 'studio', 'coliving', 'other'] as const;

export const DEFAULT_PROPERTY_TYPE = 'apartment';
export const FALLBACK_PROPERTY_TYPE = 'other';

// --- Wizard step names (named so the flow-resolver and the step switch stay
//     in sync — no stringly-typed drift between the two). ---
/** The 4-way offering selector (Rent monthly / Rent by night / Sell / Exchange). */
export const STEP_OFFERING = 'Offering';
export const STEP_LONG_TERM_PRICING = 'Long-term Pricing';
export const STEP_NIGHTLY_PRICING = 'Nightly Pricing';
export const STEP_SALE_DETAILS = 'Sale Details';
export const STEP_EXCHANGE_SETTINGS = 'Exchange Settings';
export const STEP_PROPERTY_TYPE = 'Property Type';
export const STEP_LOCATION = 'Location';
export const STEP_BASIC_INFO = 'Basic Info';
export const STEP_AMENITIES = 'Amenities';
export const STEP_COLIVING = 'Coliving Features';
export const STEP_MEDIA = 'Media';
export const STEP_DESCRIPTION = 'Description';
export const STEP_PREVIEW = 'Preview';

/**
 * Each step's copy for Bloom's `WizardProgress`, as i18n keys. The step NAMES
 * stay the stable internal ids the flow resolver and `FIELD_CONFIG` key on;
 * only this map turns them into words.
 */
export const STEP_COPY: Readonly<Record<string, { title: string; description?: string }>> = {
  [STEP_PROPERTY_TYPE]: { title: 'propertyCreate.steps.propertyType.title' },
  [STEP_LOCATION]: {
    title: 'propertyCreate.steps.location.title',
    description: 'propertyCreate.steps.location.description',
  },
  [STEP_BASIC_INFO]: { title: 'propertyCreate.steps.basicInfo.title' },
  [STEP_OFFERING]: { title: 'listing.offering.stepTitle', description: 'listing.offering.stepHelp' },
  [STEP_LONG_TERM_PRICING]: { title: 'listing.offering.longTermStepTitle' },
  [STEP_NIGHTLY_PRICING]: { title: 'listing.offering.nightlyStepTitle' },
  [STEP_SALE_DETAILS]: { title: 'listing.sale.stepTitle' },
  [STEP_EXCHANGE_SETTINGS]: { title: 'listing.exchange.stepTitle', description: 'listing.exchange.stepHelp' },
  [STEP_AMENITIES]: { title: 'propertyCreate.amenities.rulesTitle' },
  [STEP_COLIVING]: { title: 'propertyCreate.steps.coliving.title' },
  [STEP_MEDIA]: {
    title: 'propertyCreate.steps.media.title',
    description: 'propertyCreate.steps.media.description',
  },
  [STEP_DESCRIPTION]: { title: 'propertyCreate.steps.description.title' },
  [STEP_PREVIEW]: {
    title: 'propertyCreate.steps.preview.title',
    description: 'propertyCreate.steps.preview.description',
  },
};

/**
 * Base step flow per property type, in the order of Bloom's housing publish
 * template: type → where → the basics → how it is offered → (amenities) →
 * photos → description → preview. The conditional per-offering pricing steps
 * (`Long-term Pricing`, `Nightly Pricing`, `Sale Details`, `Exchange Settings`)
 * are inserted by {@link resolveStepFlow} based on the selection, NOT stored
 * here, so the base flow stays declarative.
 */
const flow = (...middle: string[]): string[] => [
  STEP_PROPERTY_TYPE,
  STEP_LOCATION,
  STEP_BASIC_INFO,
  STEP_OFFERING,
  ...middle,
  STEP_MEDIA,
  STEP_DESCRIPTION,
  STEP_PREVIEW,
];

export const STEP_FLOWS: Record<string, string[]> = {
  apartment: flow(STEP_AMENITIES),
  house: flow(STEP_AMENITIES),
  room: flow(STEP_AMENITIES),
  studio: flow(STEP_AMENITIES),
  coliving: flow(STEP_AMENITIES, STEP_COLIVING),
  other: flow(),
};

/**
 * Resolve the active step list for a property type AND the selected offerings.
 * Replaces the static `STEP_FLOWS[type]` lookup: it starts from the type's base
 * flow and inserts the conditional per-offering pricing steps immediately after
 * the `Offering` selector, in canonical order: Long-term Pricing → Nightly
 * Pricing → Sale Details → Exchange Settings (only those the host selected).
 * Unknown types fall back to the {@link FALLBACK_PROPERTY_TYPE} flow.
 */
export function resolveStepFlow(
  propertyType: string,
  offerings: readonly OfferingType[],
): string[] {
  const base = STEP_FLOWS[propertyType] ?? STEP_FLOWS[FALLBACK_PROPERTY_TYPE];
  const inserts: string[] = [];
  if (offerings.includes(OfferingType.LONG_TERM_RENT)) inserts.push(STEP_LONG_TERM_PRICING);
  if (offerings.includes(OfferingType.SHORT_TERM_RENT)) inserts.push(STEP_NIGHTLY_PRICING);
  if (offerings.includes(OfferingType.SALE)) inserts.push(STEP_SALE_DETAILS);
  if (offerings.includes(OfferingType.EXCHANGE)) inserts.push(STEP_EXCHANGE_SETTINGS);
  const insertAt = base.indexOf(STEP_OFFERING) + 1;
  return [...base.slice(0, insertAt), ...inserts, ...base.slice(insertAt)];
}

const FULL_ADDRESS = [
  'address',
  'unit',
  'number',
  'building_name',
  'block',
  'entrance',
  'district',
  'po_box',
  'reference',
  'city',
  'state',
  'postal_code',
  'country',
  'latitude',
  'longitude',
];
const HOUSE_RULES = ['petsAllowed', 'smokingAllowed', 'partiesAllowed', 'guestsAllowed', 'maxGuests'];
const COMMON_STEPS = {
  [STEP_PROPERTY_TYPE]: ['propertyType'],
  [STEP_MEDIA]: ['images'],
  [STEP_DESCRIPTION]: ['description'],
  [STEP_PREVIEW]: [],
};
/** A whole home: every room count and the tenancy fields. */
const WHOLE_HOME = {
  ...COMMON_STEPS,
  [STEP_BASIC_INFO]: ['bedrooms', 'bathrooms', 'squareFootage', 'floor', 'yearBuilt'],
  [STEP_LOCATION]: [...FULL_ADDRESS, 'availableFrom', 'leaseTerm'],
  [STEP_AMENITIES]: ['amenities', ...HOUSE_RULES],
};
/** A room or studio: no bedroom count, amenities only. */
const SINGLE_SPACE = {
  ...COMMON_STEPS,
  [STEP_BASIC_INFO]: ['bathrooms', 'squareFootage', 'floor', 'yearBuilt'],
  [STEP_LOCATION]: FULL_ADDRESS,
  [STEP_AMENITIES]: ['amenities'],
};

/**
 * The fields each step shows (and validates) per property type. Carefully
 * tailored to real-world listing needs: a studio or room has no bedroom count,
 * coliving no floor, and "other" the minimal address.
 */
export const FIELD_CONFIG: Record<string, Record<string, string[]>> = {
  apartment: WHOLE_HOME,
  house: WHOLE_HOME,
  studio: SINGLE_SPACE,
  room: SINGLE_SPACE,
  coliving: {
    ...SINGLE_SPACE,
    [STEP_BASIC_INFO]: ['bathrooms', 'squareFootage', 'yearBuilt'],
    [STEP_COLIVING]: ['sharedSpaces', 'communityEvents'],
  },
  other: {
    ...COMMON_STEPS,
    [STEP_BASIC_INFO]: ['bathrooms', 'squareFootage', 'floor', 'yearBuilt'],
    [STEP_LOCATION]: ['address', 'city', 'state', 'postal_code', 'country', 'latitude', 'longitude'],
  },
};

export const COUNTRY_OPTIONS: readonly string[] = [
  'Spain',
  'United States',
  'Canada',
  'Mexico',
  'United Kingdom',
  'France',
  'Germany',
  'Italy',
  'Portugal',
  'Netherlands',
  'Belgium',
  'Switzerland',
  'Austria',
  'Other',
];

export const STATE_OPTIONS: readonly string[] = [
  // Spanish provinces
  'Madrid',
  'Barcelona',
  'Valencia',
  'Sevilla',
  'Zaragoza',
  'Málaga',
  'Murcia',
  'Palma',
  'Las Palmas',
  'Bilbao',
  'Alicante',
  'Córdoba',
  'Valladolid',
  'Vigo',
  'Gijón',
  "L'Hospitalet de Llobregat",
  'A Coruña',
  'Vitoria-Gasteiz',
  'Granada',
  'Elche',
  'Tarrasa',
  'Badalona',
  'Oviedo',
  'Cartagena',
  'Jerez de la Frontera',
  'Sabadell',
  'Móstoles',
  'Alcalá de Henares',
  'Pamplona',
  'Fuenlabrada',
  'Almería',
  'Leganés',
  'San Sebastián',
  'Santander',
  'Castellón de la Plana',
  'Burgos',
  'Albacete',
  'Alcorcón',
  'Getafe',
  'Salamanca',
  'Logroño',
  'Huelva',
  'Marbella',
  'Lleida',
  'Tarragona',
  'León',
  'Cádiz',
  'Jaén',
  'Girona',
  'Lugo',
  'Cáceres',
  'Toledo',
  'Ceuta',
  'Melilla',
  // US states
  'CA',
  'NY',
  'TX',
  'FL',
  'IL',
  'Other',
];

/**
 * Currencies offered in the wizard: the canonical 3–4 letter codes stored
 * VERBATIM on the listing and validated by the backend (its rent/sale currency
 * contract: USD, EUR, GBP, CAD, FAIR). Codes like "MXN" are intentionally
 * excluded because the schema would reject them.
 */
export const CURRENCY_OPTIONS: readonly string[] = ['USD', 'EUR', 'GBP', 'CAD', 'FAIR'];

/**
 * The 4-way offering picker shown as multi-select cards on the Offering step.
 * `value` is the canonical {@link OfferingType}; label + helper copy resolve via
 * i18n (`listing.offering.*`) at render time. A listing must carry at least one
 * offering; long-term rent is the default but every option is independently
 * toggleable (a listing can be offered several ways at once).
 */
export interface OfferingOption {
  value: OfferingType;
  i18nKey: string;
  descriptionKey: string;
}

export const PRICING_OFFERING_OPTIONS: readonly OfferingOption[] = [
  {
    value: OfferingType.LONG_TERM_RENT,
    i18nKey: 'listing.offering.longTerm',
    descriptionKey: 'listing.offering.longTermHelp',
  },
  {
    value: OfferingType.SHORT_TERM_RENT,
    i18nKey: 'listing.offering.nightly',
    descriptionKey: 'listing.offering.nightlyHelp',
  },
  {
    value: OfferingType.SALE,
    i18nKey: 'listing.offering.sell',
    descriptionKey: 'listing.offering.sellHelp',
  },
  {
    value: OfferingType.EXCHANGE,
    i18nKey: 'listing.offering.exchange',
    descriptionKey: 'listing.offering.exchangeHelp',
  },
];

/**
 * Chain-status options for a sale listing (UK-style onward-chain disclosure).
 * `value` matches `PropertySale['chainStatus']`; labels resolve via i18n.
 */
export interface ChainStatusOption {
  value: NonNullable<import('@homiio/shared-types').PropertySale['chainStatus']>;
  i18nKey: string;
}

export const CHAIN_STATUS_OPTIONS: readonly ChainStatusOption[] = [
  { value: 'no_chain', i18nKey: 'listing.sale.chainStatus.noChain' },
  { value: 'chain', i18nKey: 'listing.sale.chainStatus.chain' },
  { value: 'unknown', i18nKey: 'listing.sale.chainStatus.unknown' },
];

/**
 * Exchange-mode options on the Exchange Settings step. `value` is the canonical
 * {@link ExchangeMode}; labels + helper copy resolve via i18n. `both` is the
 * most permissive (accepts a swap or a one-way hosting request).
 */
export interface ExchangeModeOption {
  value: ExchangeMode;
  i18nKey: string;
  descriptionKey: string;
}

export const EXCHANGE_MODE_OPTIONS: readonly ExchangeModeOption[] = [
  {
    value: ExchangeMode.SWAP,
    i18nKey: 'listing.exchange.mode.swap',
    descriptionKey: 'listing.exchange.mode.swapHelp',
  },
  {
    value: ExchangeMode.HOST,
    i18nKey: 'listing.exchange.mode.host',
    descriptionKey: 'listing.exchange.mode.hostHelp',
  },
  {
    value: ExchangeMode.BOTH,
    i18nKey: 'listing.exchange.mode.both',
    descriptionKey: 'listing.exchange.mode.bothHelp',
  },
];

/**
 * Languages a host may select on the Exchange Settings step (stored as the
 * English label so they round-trip into `exchange.languages`). Curated to the
 * most common travel languages rather than an exhaustive ISO list.
 */
export const EXCHANGE_LANGUAGE_OPTIONS: readonly string[] = [
  'English',
  'Spanish',
  'Catalan',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Arabic',
  'Mandarin',
  'Japanese',
  'Russian',
];

export const SHARED_SPACE_OPTIONS: readonly string[] = [
  'Kitchen',
  'Living Room',
  'Coworking Area',
  'Gym',
  'Laundry',
  'Garden',
  'Terrace',
  'Dining Room',
];

export const MAX_PROPERTY_IMAGES = 10;
export const PROPERTY_IMAGE_FOLDER = 'properties';
export const MAP_HEIGHT = 400;
