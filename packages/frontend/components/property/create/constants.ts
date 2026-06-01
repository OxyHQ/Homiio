/**
 * Static configuration for the property creation wizard.
 *
 * Extracted verbatim from `app/properties/create.tsx` so the orchestrator and
 * the per-step components share a single source of truth. The shapes and values
 * are unchanged to preserve the exact wizard behaviour (step order, which
 * fields are visible per type/step, and picker options).
 */
import { ExchangeMode, OfferingType } from '@homiio/shared-types';

export interface PropertyTypeOption {
  id: string;
  label: string;
}

export const PROPERTY_TYPES: readonly PropertyTypeOption[] = [
  { id: 'apartment', label: 'Apartment' },
  { id: 'house', label: 'House' },
  { id: 'room', label: 'Room' },
  { id: 'studio', label: 'Studio' },
  { id: 'coliving', label: 'Co-living' },
  { id: 'other', label: 'Other' },
];

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

/**
 * Base step flow per property type. After `Location` comes the `Offering`
 * selector (the 4-way multi-select); the conditional per-offering pricing steps
 * (`Long-term Pricing`, `Nightly Pricing`, `Sale Details`, `Exchange Settings`)
 * are inserted by {@link resolveStepFlow} based on the selection, NOT stored
 * here, so the base flow stays declarative.
 */
export const STEP_FLOWS: Record<string, string[]> = {
  apartment: ['Basic Info', 'Location', STEP_OFFERING, 'Amenities', 'Media', 'Preview'],
  house: ['Basic Info', 'Location', STEP_OFFERING, 'Amenities', 'Media', 'Preview'],
  room: ['Basic Info', 'Location', STEP_OFFERING, 'Amenities', 'Media', 'Preview'],
  studio: ['Basic Info', 'Location', STEP_OFFERING, 'Amenities', 'Media', 'Preview'],
  coliving: [
    'Basic Info',
    'Location',
    STEP_OFFERING,
    'Amenities',
    'Coliving Features',
    'Media',
    'Preview',
  ],
  other: ['Basic Info', 'Location', STEP_OFFERING, 'Media', 'Preview'],
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
  if (inserts.length === 0) {
    return [...base];
  }
  const offeringIndex = base.indexOf(STEP_OFFERING);
  // Defensive: every base flow contains the Offering selector, but if it ever
  // didn't we append the conditional steps rather than dropping them.
  const insertAt = offeringIndex >= 0 ? offeringIndex + 1 : base.length;
  return [...base.slice(0, insertAt), ...inserts, ...base.slice(insertAt)];
}

// Field configuration for each property type and step
// Carefully tailored to real-world property listing needs
export const FIELD_CONFIG: Record<string, Record<string, string[]>> = {
  apartment: {
    // Apartment: all main fields
    'Basic Info': [
      'propertyType',
      'bedrooms',
      'bathrooms',
      'squareFootage',
      'floor',
      'yearBuilt',
      'description',
    ],
    Location: [
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
      'availableFrom',
      'leaseTerm',
    ],
    Amenities: [
      'amenities',
      'petsAllowed',
      'smokingAllowed',
      'partiesAllowed',
      'guestsAllowed',
      'maxGuests',
    ],
    Media: ['images'],
    Preview: [],
  },
  house: {
    // House: same as apartment
    'Basic Info': [
      'propertyType',
      'bedrooms',
      'bathrooms',
      'squareFootage',
      'floor',
      'yearBuilt',
      'description',
    ],
    Location: [
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
      'availableFrom',
      'leaseTerm',
    ],
    Amenities: [
      'amenities',
      'petsAllowed',
      'smokingAllowed',
      'partiesAllowed',
      'guestsAllowed',
      'maxGuests',
    ],
    Media: ['images'],
    Preview: [],
  },
  studio: {
    // Studio: no bedrooms
    'Basic Info': ['propertyType', 'bathrooms', 'squareFootage', 'floor', 'yearBuilt', 'description'],
    Location: [
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
    ],
    Amenities: ['amenities'],
    Media: ['images'],
    Preview: [],
  },
  room: {
    // Room: no bedrooms, but has bathrooms, squareFootage, floor, yearBuilt
    'Basic Info': ['propertyType', 'bathrooms', 'squareFootage', 'floor', 'yearBuilt', 'description'],
    Location: [
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
    ],
    Amenities: ['amenities'],
    Media: ['images'],
    Preview: [],
  },
  coliving: {
    // Coliving: no bedrooms, optional bathrooms, coliving features
    'Basic Info': ['propertyType', 'bathrooms', 'squareFootage', 'yearBuilt', 'description'],
    Location: [
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
    ],
    Amenities: ['amenities'],
    'Coliving Features': ['sharedSpaces', 'communityEvents'],
    Media: ['images'],
    Preview: [],
  },
  other: {
    // Other: minimal fields
    'Basic Info': ['propertyType', 'bathrooms', 'squareFootage', 'floor', 'yearBuilt', 'description'],
    Location: ['address', 'city', 'state', 'postal_code', 'country', 'latitude', 'longitude'],
    Media: ['images'],
    Preview: [],
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
 * A selectable currency: `value` is the canonical code persisted to the listing
 * (`rent.currency` / `sale.currency`), `label` is the friendly display text.
 */
export interface CurrencyOption {
  value: string;
  label: string;
}

/**
 * Currencies offered in the wizard. `value` is the canonical 3–4 letter code
 * stored VERBATIM on the listing and validated by the backend — the friendly
 * `label` is display-only and is never persisted. The set matches the backend
 * rent/sale currency contract (USD, EUR, GBP, CAD, FAIR); display strings such
 * as "Other" or non-set codes like "MXN" are intentionally excluded because the
 * schema would reject them.
 */
export const CURRENCY_OPTIONS: readonly CurrencyOption[] = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'FAIR', label: 'FAIR — FairCoin' },
];

/**
 * The 4-way offering picker shown as multi-select chips on the Offering step.
 * `value` is the canonical {@link OfferingType}; label + helper copy resolve via
 * i18n (`listing.offering.*`) at render time. A listing must carry at least one
 * offering; long-term rent is the default but every option is independently
 * toggleable (a listing can be offered several ways at once).
 */
export interface OfferingOption {
  value: OfferingType;
  i18nKey: string;
  fallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  icon: string;
}

export const PRICING_OFFERING_OPTIONS: readonly OfferingOption[] = [
  {
    value: OfferingType.LONG_TERM_RENT,
    i18nKey: 'listing.offering.longTerm',
    fallback: 'Rent monthly',
    descriptionKey: 'listing.offering.longTermHelp',
    descriptionFallback: 'Traditional long-term lease, priced per month.',
    icon: 'home-outline',
  },
  {
    value: OfferingType.SHORT_TERM_RENT,
    i18nKey: 'listing.offering.nightly',
    fallback: 'Rent by night',
    descriptionKey: 'listing.offering.nightlyHelp',
    descriptionFallback: 'Vacation / short stays, priced per night.',
    icon: 'moon-outline',
  },
  {
    value: OfferingType.SALE,
    i18nKey: 'listing.offering.sell',
    fallback: 'Sell',
    descriptionKey: 'listing.offering.sellHelp',
    descriptionFallback: 'List the property for sale.',
    icon: 'pricetag-outline',
  },
  {
    value: OfferingType.EXCHANGE,
    i18nKey: 'listing.offering.exchange',
    fallback: 'Exchange',
    descriptionKey: 'listing.offering.exchangeHelp',
    descriptionFallback: 'Home swap or free hosting.',
    icon: 'swap-horizontal-outline',
  },
];

/**
 * Chain-status options for a sale listing (UK-style onward-chain disclosure).
 * `value` matches `PropertySale['chainStatus']`; labels resolve via i18n.
 */
export interface ChainStatusOption {
  value: NonNullable<import('@homiio/shared-types').PropertySale['chainStatus']>;
  i18nKey: string;
  fallback: string;
}

export const CHAIN_STATUS_OPTIONS: readonly ChainStatusOption[] = [
  { value: 'no_chain', i18nKey: 'listing.sale.chainStatus.noChain', fallback: 'No chain' },
  { value: 'chain', i18nKey: 'listing.sale.chainStatus.chain', fallback: 'In a chain' },
  { value: 'unknown', i18nKey: 'listing.sale.chainStatus.unknown', fallback: 'Unknown' },
];

/**
 * Exchange-mode options on the Exchange Settings step. `value` is the canonical
 * {@link ExchangeMode}; labels + helper copy resolve via i18n. `both` is the
 * most permissive (accepts a swap or a one-way hosting request).
 */
export interface ExchangeModeOption {
  value: ExchangeMode;
  i18nKey: string;
  fallback: string;
  descriptionKey: string;
  descriptionFallback: string;
}

export const EXCHANGE_MODE_OPTIONS: readonly ExchangeModeOption[] = [
  {
    value: ExchangeMode.SWAP,
    i18nKey: 'listing.exchange.mode.swap',
    fallback: 'Home swap',
    descriptionKey: 'listing.exchange.mode.swapHelp',
    descriptionFallback: 'Each party stays in the other’s home.',
  },
  {
    value: ExchangeMode.HOST,
    i18nKey: 'listing.exchange.mode.host',
    fallback: 'Free hosting',
    descriptionKey: 'listing.exchange.mode.hostHelp',
    descriptionFallback: 'Welcome a guest with no stay in return.',
  },
  {
    value: ExchangeMode.BOTH,
    i18nKey: 'listing.exchange.mode.both',
    fallback: 'Either',
    descriptionKey: 'listing.exchange.mode.bothHelp',
    descriptionFallback: 'Open to a swap or to hosting a guest.',
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
