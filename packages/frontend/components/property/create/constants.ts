/**
 * Static configuration for the property creation wizard.
 *
 * Extracted verbatim from `app/properties/create.tsx` so the orchestrator and
 * the per-step components share a single source of truth. The shapes and values
 * are unchanged to preserve the exact wizard behaviour (step order, which
 * fields are visible per type/step, and picker options).
 */

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

// Step flows for each property type
export const STEP_FLOWS: Record<string, string[]> = {
  apartment: ['Basic Info', 'Location', 'Pricing', 'Amenities', 'Media', 'Preview'],
  house: ['Basic Info', 'Location', 'Pricing', 'Amenities', 'Media', 'Preview'],
  room: ['Basic Info', 'Location', 'Pricing', 'Amenities', 'Media', 'Preview'],
  studio: ['Basic Info', 'Location', 'Pricing', 'Amenities', 'Media', 'Preview'],
  coliving: [
    'Basic Info',
    'Location',
    'Pricing',
    'Amenities',
    'Coliving Features',
    'Media',
    'Preview',
  ],
  other: ['Basic Info', 'Location', 'Pricing', 'Media', 'Preview'],
};

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
    Pricing: ['monthlyRent', 'currency', 'securityDeposit', 'applicationFee', 'lateFee'],
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
    Pricing: ['monthlyRent', 'currency', 'securityDeposit', 'applicationFee', 'lateFee'],
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
    Pricing: ['monthlyRent', 'currency', 'securityDeposit'],
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
    Pricing: ['monthlyRent', 'currency', 'securityDeposit'],
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
    Pricing: ['monthlyRent', 'currency', 'securityDeposit'],
    Amenities: ['amenities'],
    'Coliving Features': ['sharedSpaces', 'communityEvents'],
    Media: ['images'],
    Preview: [],
  },
  other: {
    // Other: minimal fields
    'Basic Info': ['propertyType', 'bathrooms', 'squareFootage', 'floor', 'yearBuilt', 'description'],
    Location: ['address', 'city', 'state', 'postal_code', 'country', 'latitude', 'longitude'],
    Pricing: ['monthlyRent', 'currency', 'securityDeposit'],
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

export const CURRENCY_OPTIONS: readonly string[] = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'MXN',
  'FAIR (FairCoin)',
  'Other',
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
