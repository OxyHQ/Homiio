/**
 * Seed Properties Script
 *
 * Populates the database with realistic demo listings so every property-backed
 * screen (home carousels, search, city pages, saved) renders with content.
 *
 * Covers the per-offering pricing model (single `offerings` axis):
 *   - long_term_rent  (longTermRent.monthlyAmount)  — apartments / studios / rooms
 *   - short_term_rent (shortTermRent.nightlyRate)   — calendar windows, fees, instant book
 *   - sale            (sale.price)                   — buy listings
 *   - exchange        (exchange.mode)                — home swap / free hosting
 * A listing may carry several offerings at once (e.g. monthly rent AND a nightly
 * rate, with DIFFERENT numbers), each in its own priced block.
 *
 * Idempotent: each listing has a stable (source, sourceId) key. Re-running
 * upserts in place instead of creating duplicates. Addresses are deduplicated
 * by their normalizedKey via Address.findOrCreateCanonical.
 *
 * Usage:
 *   bun run seed:properties
 *   # or
 *   ts-node --transpile-only scripts/seedProperties.ts
 */

require('dotenv').config();
import {
  PropertyType,
  PropertyStatus,
  UtilitiesIncluded,
  LeaseDuration,
  OfferingType,
  AvailabilityWindowStatus,
  CancellationPolicy,
  ExchangeMode,
} from '@homiio/shared-types';
import database from '../database/connection';
import { seedGeo } from './seedGeo';
import {
  seedPropertyImages,
  seedEntityCoverImage,
  CITY_COVER_IMAGE_URLS,
  logStorageMode,
} from './seedImages';

/**
 * Furnished status is defined as an inline enum on PropertySchema (no shared
 * enum exists), so mirror its exact string union here.
 */
type FurnishedStatus = 'furnished' | 'unfurnished' | 'partially_furnished' | 'not_specified';
const FurnishedStatus = {
  FURNISHED: 'furnished',
  UNFURNISHED: 'unfurnished',
  PARTIALLY_FURNISHED: 'partially_furnished',
  NOT_SPECIFIED: 'not_specified'
} as const;

const { Property, Address, Profile, Country, Region, City, Neighborhood, Image } = require('../models');

const SEED_SOURCE = 'seed';
const SEED_OWNER_OXY_USER_ID = 'seed-demo-host';
const CURRENCY = 'EUR';

// Short-term availability runs from today for the next ~90 days.
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const today = new Date();
const ninetyDaysFromNow = new Date(today.getTime() + NINETY_DAYS_MS);

const openShortTermWindow = () => [
  {
    start: today,
    end: ninetyDaysFromNow,
    status: AvailabilityWindowStatus.AVAILABLE
  }
];

// Curated Unsplash interior/apartment imagery (same style the home already uses).
const IMG = {
  apartment1: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688',
  apartment2: 'https://images.unsplash.com/photo-1493809842364-78817add7ffb',
  apartment3: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267',
  livingRoom1: 'https://images.unsplash.com/photo-1505691938895-1758d7feb511',
  livingRoom2: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2',
  livingRoom3: 'https://images.unsplash.com/photo-1567767292278-a4f21aa2d36e',
  bedroom1: 'https://images.unsplash.com/photo-1540518614846-7eded433c457',
  bedroom2: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85',
  bedroom3: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af',
  kitchen1: 'https://images.unsplash.com/photo-1556911220-bff31c812dba',
  kitchen2: 'https://images.unsplash.com/photo-1565182999561-18d7dc61c393',
  bathroom1: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a',
  studio1: 'https://images.unsplash.com/photo-1554995207-c18c203602cb',
  studio2: 'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6',
  terrace1: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c',
  loft1: 'https://images.unsplash.com/photo-1536376072261-38c75010e6c9',
  room1: 'https://images.unsplash.com/photo-1567016432779-094069958ea5',
  room2: 'https://images.unsplash.com/photo-1598928506311-c55ded91a20c'
} as const;

interface SeedAddress {
  street: string;
  number: string;
  neighborhood: string;
  district?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  countryCode: string;
  /** [longitude, latitude] */
  coordinates: [number, number];
}

/** Monthly-rent offering block. */
interface SeedLongTermRent {
  monthlyAmount: number;
  deposit?: number;
  applicationFee?: number;
  lateFee?: number;
  utilities?: UtilitiesIncluded;
}

/** Per-night offering block. */
interface SeedShortTermRent {
  nightlyRate: number;
  cleaningFee?: number;
  serviceFee?: number;
  taxesPercent?: number;
  minNights?: number;
  maxNights?: number;
  instantBook?: boolean;
  deposit?: number;
}

/** Sale offering block. */
interface SeedSale {
  price: number;
  estimatedYield?: number;
  isPriceReduced?: boolean;
  chainStatus?: 'no_chain' | 'chain' | 'unknown';
}

/** Exchange offering block. */
interface SeedExchange {
  mode: ExchangeMode;
  welcomeNote?: string;
  languages?: string[];
  mealsIncluded?: boolean;
  requiresReciprocity?: boolean;
}

interface SeedProperty {
  sourceId: string;
  description: string;
  type: PropertyType;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  floor?: number;
  yearBuilt?: number;
  hasElevator?: boolean;
  hasBalcony?: boolean;
  hasGarden?: boolean;
  furnishedStatus: FurnishedStatus;
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  parkingType?: 'none' | 'street' | 'assigned' | 'garage';
  parkingSpaces?: number;
  amenities: string[];
  imageUrls: string[];
  isVerified?: boolean;
  isEcoFriendly?: boolean;
  maxGuests?: number;
  cancellationPolicy?: CancellationPolicy;
  // ---- Per-offering blocks (each present block adds its offering) ----
  longTermRent?: SeedLongTermRent;
  shortTermRent?: SeedShortTermRent;
  sale?: SeedSale;
  exchange?: SeedExchange;
  address: SeedAddress;
}

const BCN = { city: 'Barcelona', state: 'Catalonia', country: 'Spain', countryCode: 'ES' };
const MAD = { city: 'Madrid', state: 'Community of Madrid', country: 'Spain', countryCode: 'ES' };
const VLC = { city: 'València', state: 'Valencian Community', country: 'Spain', countryCode: 'ES' };

const properties: SeedProperty[] = [
  // ---------------------- LONG TERM (Barcelona) ----------------------
  {
    sourceId: 'bcn-eixample-01',
    description:
      'Bright renovated apartment in the heart of the Eixample, steps from Passeig de Gràcia. High ceilings, original mosaic floors and a sunny balcony overlooking a quiet inner courtyard. Fully furnished and move-in ready.',
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 1850, deposit: 3700, utilities: UtilitiesIncluded.EXCLUDED },
    bedrooms: 3,
    bathrooms: 2,
    squareFootage: 95,
    floor: 4,
    yearBuilt: 1920,
    hasElevator: true,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    petFriendly: true,
    parkingType: 'none',
    amenities: ['wifi', 'air_conditioning', 'heating', 'elevator', 'balcony', 'washing_machine', 'dishwasher', 'kitchen'],
    imageUrls: [IMG.apartment1, IMG.livingRoom1, IMG.bedroom1, IMG.kitchen1, IMG.bathroom1],
    isVerified: true,
    address: {
      street: 'Carrer de Mallorca', number: '215', neighborhood: 'Eixample', district: "L'Eixample",
      postal_code: '08008', coordinates: [2.1589, 41.3935], ...BCN
    }
  },
  {
    sourceId: 'bcn-gracia-02',
    description:
      'Charming two-bedroom flat in bohemian Gràcia, surrounded by plazas, cafés and independent shops. Recently refurbished kitchen and a cozy reading nook. Ideal for a couple or small family who love village-in-the-city living.',
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 1400, deposit: 2800 },
    bedrooms: 2,
    bathrooms: 1,
    squareFootage: 72,
    floor: 2,
    yearBuilt: 1955,
    hasElevator: false,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    petFriendly: false,
    parkingType: 'none',
    amenities: ['wifi', 'heating', 'balcony', 'washing_machine', 'kitchen', 'refrigerator'],
    imageUrls: [IMG.apartment2, IMG.livingRoom2, IMG.bedroom2, IMG.kitchen2],
    isVerified: true,
    address: {
      street: 'Carrer de Verdi', number: '48', neighborhood: 'Gràcia', district: 'Gràcia',
      postal_code: '08012', coordinates: [2.1573, 41.4045], ...BCN
    }
  },
  {
    sourceId: 'bcn-elborn-03',
    description:
      'Designer loft in El Born with exposed brick walls and industrial finishes. Open-plan living, walking distance to the Picasso Museum and Santa Maria del Mar. Perfect for a professional who wants character and location.',
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 1650, deposit: 3300 },
    bedrooms: 1,
    bathrooms: 1,
    squareFootage: 68,
    floor: 1,
    yearBuilt: 1900,
    hasElevator: false,
    hasBalcony: false,
    furnishedStatus: FurnishedStatus.FURNISHED,
    petFriendly: true,
    parkingType: 'none',
    amenities: ['wifi', 'air_conditioning', 'heating', 'washing_machine', 'dishwasher', 'kitchen', 'smart_home'],
    imageUrls: [IMG.loft1, IMG.livingRoom3, IMG.bedroom3, IMG.kitchen1],
    isVerified: true,
    isEcoFriendly: true,
    address: {
      street: 'Carrer dels Banys Vells', number: '12', neighborhood: 'El Born', district: 'Ciutat Vella',
      postal_code: '08003', coordinates: [2.1818, 41.3845], ...BCN
    }
  },
  {
    sourceId: 'bcn-sants-04',
    description:
      'Spacious and affordable family apartment in Sants, well connected by metro and the Sants train station. Four bedrooms, a generous living room and an updated bathroom. Great value for long-term tenants.',
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 1550, deposit: 3100 },
    bedrooms: 4,
    bathrooms: 2,
    squareFootage: 110,
    floor: 3,
    yearBuilt: 1972,
    hasElevator: true,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.PARTIALLY_FURNISHED,
    petFriendly: true,
    parkingType: 'street',
    amenities: ['wifi', 'heating', 'elevator', 'balcony', 'washing_machine', 'kitchen', 'public_transit_access'],
    imageUrls: [IMG.apartment3, IMG.livingRoom1, IMG.bedroom1, IMG.bedroom2],
    address: {
      street: 'Carrer de Sants', number: '178', neighborhood: 'Sants', district: 'Sants-Montjuïc',
      postal_code: '08028', coordinates: [2.1330, 41.3756], ...BCN
    }
  },
  {
    sourceId: 'bcn-studio-eixample-05',
    description:
      'Compact, light-filled studio in the right Eixample, fully equipped for one person or a couple. Smart layout maximizes every meter, with a Murphy bed and a modern kitchenette. Bills can be included on request.',
    type: PropertyType.STUDIO,
    longTermRent: { monthlyAmount: 950, deposit: 1900, utilities: UtilitiesIncluded.INCLUDED },
    bedrooms: 0,
    bathrooms: 1,
    squareFootage: 38,
    floor: 5,
    yearBuilt: 1965,
    hasElevator: true,
    hasBalcony: false,
    furnishedStatus: FurnishedStatus.FURNISHED,
    utilitiesIncluded: true,
    parkingType: 'none',
    amenities: ['wifi', 'air_conditioning', 'heating', 'elevator', 'kitchen', 'refrigerator'],
    imageUrls: [IMG.studio1, IMG.studio2, IMG.kitchen2],
    isVerified: true,
    address: {
      street: 'Carrer de Girona', number: '92', neighborhood: 'Eixample', district: "L'Eixample",
      postal_code: '08009', coordinates: [2.1685, 41.3962], ...BCN
    }
  },
  {
    sourceId: 'bcn-room-gracia-06',
    description:
      'Cozy private studio in friendly Gràcia, ideal for one person. Compact and fully furnished with a double bed, desk, large wardrobe and a kitchenette. A sunny, quiet retreat. Utilities and wifi included.',
    type: PropertyType.STUDIO,
    longTermRent: { monthlyAmount: 620, deposit: 620, utilities: UtilitiesIncluded.INCLUDED },
    bedrooms: 1,
    bathrooms: 1,
    squareFootage: 16,
    floor: 2,
    yearBuilt: 1960,
    hasElevator: false,
    hasBalcony: false,
    furnishedStatus: FurnishedStatus.FURNISHED,
    utilitiesIncluded: true,
    petFriendly: false,
    parkingType: 'none',
    amenities: ['wifi', 'heating', 'washing_machine', 'kitchen'],
    imageUrls: [IMG.room1, IMG.room2, IMG.kitchen1],
    address: {
      street: 'Carrer de Bailèn', number: '210', neighborhood: 'Gràcia', district: 'Gràcia',
      postal_code: '08037', coordinates: [2.1645, 41.4012], ...BCN
    }
  },
  {
    sourceId: 'bcn-poblenou-07',
    description:
      'Modern apartment in Poblenou, the 22@ innovation district, close to the beach and tech offices. Bright open kitchen, a private balcony and access to a communal rooftop with sea views. Eco-efficient building.',
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 1750, deposit: 3500 },
    bedrooms: 2,
    bathrooms: 2,
    squareFootage: 85,
    floor: 6,
    yearBuilt: 2018,
    hasElevator: true,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    petFriendly: true,
    parkingType: 'garage',
    parkingSpaces: 1,
    amenities: ['wifi', 'air_conditioning', 'heating', 'elevator', 'balcony', 'washing_machine', 'dishwasher', 'kitchen', 'gym', 'rooftop_deck', 'parking_space'],
    imageUrls: [IMG.apartment1, IMG.livingRoom2, IMG.bedroom3, IMG.kitchen2, IMG.terrace1],
    isVerified: true,
    isEcoFriendly: true,
    address: {
      street: 'Carrer de Pujades', number: '140', neighborhood: 'Poblenou', district: 'Sant Martí',
      postal_code: '08005', coordinates: [2.1985, 41.4002], ...BCN
    }
  },
  {
    sourceId: 'bcn-raval-09',
    description:
      'Central one-bedroom in El Raval, in the middle of Barcelona’s most vibrant cultural scene next to the MACBA and La Rambla. Renovated, affordable and perfect for someone who wants the city at their doorstep.',
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 1150, deposit: 2300 },
    bedrooms: 1,
    bathrooms: 1,
    squareFootage: 55,
    floor: 3,
    yearBuilt: 1940,
    hasElevator: false,
    hasBalcony: false,
    furnishedStatus: FurnishedStatus.FURNISHED,
    parkingType: 'none',
    amenities: ['wifi', 'heating', 'washing_machine', 'kitchen', 'public_transit_access'],
    imageUrls: [IMG.apartment3, IMG.livingRoom1, IMG.bedroom3],
    address: {
      street: 'Carrer de Joaquín Costa', number: '28', neighborhood: 'El Raval', district: 'Ciutat Vella',
      postal_code: '08001', coordinates: [2.1668, 41.3812], ...BCN
    }
  },
  // ---------------------- LONG TERM (Madrid) ----------------------
  {
    sourceId: 'mad-malasana-10',
    description:
      'Stylish apartment in trendy Malasaña, Madrid’s hippest neighborhood full of vintage shops, terraces and nightlife. Two bedrooms, a fully equipped kitchen and tons of character. Walk everywhere from here.',
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 1600, deposit: 3200 },
    bedrooms: 2,
    bathrooms: 1,
    squareFootage: 78,
    floor: 4,
    yearBuilt: 1930,
    hasElevator: true,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    petFriendly: true,
    parkingType: 'none',
    amenities: ['wifi', 'air_conditioning', 'heating', 'elevator', 'balcony', 'washing_machine', 'dishwasher', 'kitchen'],
    imageUrls: [IMG.apartment1, IMG.livingRoom2, IMG.bedroom2, IMG.kitchen1],
    isVerified: true,
    address: {
      street: 'Calle del Espíritu Santo', number: '18', neighborhood: 'Malasaña', district: 'Centro',
      postal_code: '28004', coordinates: [-3.7038, 40.4255], ...MAD
    }
  },
  {
    sourceId: 'mad-chamberi-11',
    description:
      'Bright and well-located apartment in Chamberí, a classic Madrid neighborhood with grand architecture and great restaurants. Three bedrooms and a roomy living area, ideal for families or sharers.',
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 1900, deposit: 3800 },
    bedrooms: 3,
    bathrooms: 2,
    squareFootage: 102,
    floor: 5,
    yearBuilt: 1968,
    hasElevator: true,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.PARTIALLY_FURNISHED,
    petFriendly: false,
    parkingType: 'street',
    amenities: ['wifi', 'air_conditioning', 'heating', 'elevator', 'balcony', 'washing_machine', 'dishwasher', 'kitchen'],
    imageUrls: [IMG.apartment2, IMG.livingRoom3, IMG.bedroom1, IMG.kitchen2, IMG.bathroom1],
    isVerified: true,
    address: {
      street: 'Calle de Almagro', number: '26', neighborhood: 'Chamberí', district: 'Chamberí',
      postal_code: '28010', coordinates: [-3.6938, 40.4318], ...MAD
    }
  },
  {
    sourceId: 'mad-studio-lavapies-12',
    description:
      'Cozy studio in multicultural Lavapiés, full of art, theaters and some of Madrid’s best international food. Compact and affordable, fully furnished with everything you need to settle in immediately.',
    type: PropertyType.STUDIO,
    longTermRent: { monthlyAmount: 850, deposit: 1700, utilities: UtilitiesIncluded.INCLUDED },
    bedrooms: 0,
    bathrooms: 1,
    squareFootage: 34,
    floor: 2,
    yearBuilt: 1950,
    hasElevator: false,
    hasBalcony: false,
    furnishedStatus: FurnishedStatus.FURNISHED,
    utilitiesIncluded: true,
    parkingType: 'none',
    amenities: ['wifi', 'air_conditioning', 'heating', 'kitchen', 'refrigerator'],
    imageUrls: [IMG.studio2, IMG.studio1, IMG.kitchen1],
    address: {
      street: 'Calle de Argumosa', number: '11', neighborhood: 'Lavapiés', district: 'Centro',
      postal_code: '28012', coordinates: [-3.7008, 40.4078], ...MAD
    }
  },
  // ---------------------- SHORT TERM (Barcelona) ----------------------
  {
    sourceId: 'bcn-vac-barceloneta-13',
    description:
      'Sun-drenched beach apartment in Barceloneta, 50 meters from the Mediterranean. Wake up to sea breeze, walk to the boardwalk for tapas and swim before breakfast. Perfect summer getaway for couples and small families.',
    type: PropertyType.APARTMENT,
    shortTermRent: { nightlyRate: 145, cleaningFee: 45, serviceFee: 20, taxesPercent: 10, minNights: 2, maxNights: 30, instantBook: true },
    cancellationPolicy: CancellationPolicy.MODERATE,
    bedrooms: 2,
    bathrooms: 1,
    squareFootage: 62,
    floor: 3,
    yearBuilt: 1950,
    hasElevator: false,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    parkingType: 'none',
    amenities: ['wifi', 'air_conditioning', 'kitchen', 'washing_machine', 'balcony', 'refrigerator'],
    imageUrls: [IMG.apartment1, IMG.livingRoom1, IMG.bedroom1, IMG.kitchen1, IMG.terrace1],
    isVerified: true,
    maxGuests: 4,
    address: {
      street: 'Carrer del Mar', number: '24', neighborhood: 'Barceloneta', district: 'Ciutat Vella',
      postal_code: '08003', coordinates: [2.1898, 41.3782], ...BCN
    }
  },
  {
    sourceId: 'bcn-vac-gothic-14',
    description:
      'Historic apartment in the Gothic Quarter with medieval charm and modern comfort. Stone walls, beamed ceilings and a balcony over a romantic lantern-lit alley. Steps from the Cathedral and Plaça Reial.',
    type: PropertyType.APARTMENT,
    shortTermRent: { nightlyRate: 120, cleaningFee: 35, serviceFee: 15, taxesPercent: 10, minNights: 2, maxNights: 21, instantBook: true },
    cancellationPolicy: CancellationPolicy.FLEXIBLE,
    bedrooms: 1,
    bathrooms: 1,
    squareFootage: 48,
    floor: 2,
    yearBuilt: 1890,
    hasElevator: false,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    parkingType: 'none',
    amenities: ['wifi', 'air_conditioning', 'heating', 'kitchen', 'balcony'],
    imageUrls: [IMG.apartment2, IMG.livingRoom2, IMG.bedroom2, IMG.kitchen2],
    isVerified: true,
    maxGuests: 2,
    address: {
      street: 'Carrer dels Escudellers', number: '8', neighborhood: 'Barri Gòtic', district: 'Ciutat Vella',
      postal_code: '08002', coordinates: [2.1762, 41.3795], ...BCN
    }
  },
  {
    sourceId: 'bcn-vac-eixample-loft-15',
    description:
      'Luxury designer loft in the Eixample with a private terrace and plunge pool. Floor-to-ceiling windows, premium furnishings and a rooftop chill-out. The ultimate stylish base to explore Gaudí’s Barcelona.',
    type: PropertyType.APARTMENT,
    shortTermRent: { nightlyRate: 195, cleaningFee: 65, serviceFee: 30, taxesPercent: 10, minNights: 3, maxNights: 60, instantBook: false },
    cancellationPolicy: CancellationPolicy.STRICT,
    bedrooms: 2,
    bathrooms: 2,
    squareFootage: 90,
    floor: 7,
    yearBuilt: 2019,
    hasElevator: true,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    parkingType: 'garage',
    parkingSpaces: 1,
    amenities: ['wifi', 'air_conditioning', 'heating', 'elevator', 'kitchen', 'washing_machine', 'dishwasher', 'swimming_pool', 'rooftop_deck', 'smart_home', 'parking_space'],
    imageUrls: [IMG.loft1, IMG.livingRoom3, IMG.bedroom3, IMG.kitchen1, IMG.terrace1, IMG.bathroom1],
    isVerified: true,
    isEcoFriendly: true,
    maxGuests: 4,
    address: {
      street: 'Carrer de València', number: '302', neighborhood: 'Eixample', district: "L'Eixample",
      postal_code: '08009', coordinates: [2.1648, 41.3938], ...BCN
    }
  },
  // ---------------------- SHORT TERM (València) ----------------------
  {
    sourceId: 'vlc-vac-carmen-17',
    description:
      'Atmospheric apartment in the historic Carmen quarter of València, surrounded by the old city walls, tapas bars and the buzzing Central Market. A characterful base to explore paella’s birthplace.',
    type: PropertyType.APARTMENT,
    shortTermRent: { nightlyRate: 78, cleaningFee: 30, serviceFee: 12, taxesPercent: 10, minNights: 2, maxNights: 30, instantBook: true },
    cancellationPolicy: CancellationPolicy.FLEXIBLE,
    bedrooms: 1,
    bathrooms: 1,
    squareFootage: 52,
    floor: 2,
    yearBuilt: 1910,
    hasElevator: false,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    parkingType: 'none',
    amenities: ['wifi', 'air_conditioning', 'kitchen', 'balcony', 'refrigerator'],
    imageUrls: [IMG.apartment1, IMG.livingRoom2, IMG.bedroom2, IMG.kitchen1],
    isVerified: true,
    maxGuests: 3,
    address: {
      street: 'Carrer de Quart', number: '20', neighborhood: 'El Carme', district: 'Ciutat Vella',
      postal_code: '46001', coordinates: [-0.3825, 39.4762], ...VLC
    }
  },
  {
    sourceId: 'vlc-vac-malvarrosa-18',
    description:
      'Beachfront apartment on Malvarrosa beach with panoramic sea views and direct boardwalk access. Spacious terrace for sunset dinners. The perfect Mediterranean escape for families and groups of friends.',
    type: PropertyType.APARTMENT,
    shortTermRent: { nightlyRate: 135, cleaningFee: 55, serviceFee: 25, taxesPercent: 10, minNights: 3, maxNights: 60, instantBook: false },
    cancellationPolicy: CancellationPolicy.MODERATE,
    bedrooms: 3,
    bathrooms: 2,
    squareFootage: 95,
    floor: 5,
    yearBuilt: 2005,
    hasElevator: true,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    parkingType: 'garage',
    parkingSpaces: 1,
    amenities: ['wifi', 'air_conditioning', 'heating', 'elevator', 'kitchen', 'washing_machine', 'dishwasher', 'balcony', 'swimming_pool', 'parking_space'],
    imageUrls: [IMG.apartment2, IMG.livingRoom3, IMG.bedroom3, IMG.bedroom1, IMG.terrace1],
    isVerified: true,
    maxGuests: 6,
    address: {
      street: 'Passeig Marítim de la Patacona', number: '14', neighborhood: 'Malvarrosa', district: 'Poblats Marítims',
      postal_code: '46011', coordinates: [-0.3258, 39.4778], ...VLC
    }
  },
  // ---------------------- MULTI-OFFERING: long-term + short-term ----------------------
  // Eixample flat offered BOTH monthly (1700/month) AND by the night (110/night)
  // — DIFFERENT numbers, each in its own block, so the price is never reinterpreted.
  {
    sourceId: 'bcn-both-eixample-19',
    description:
      'Flexible Eixample apartment available for both long stays and shorter vacation bookings. A beautifully furnished two-bedroom with a balcony, ideal whether you are relocating to Barcelona or visiting for a few weeks.',
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 1700, deposit: 3400 },
    shortTermRent: { nightlyRate: 110, cleaningFee: 50, serviceFee: 22, taxesPercent: 10, minNights: 4, maxNights: 90, instantBook: true },
    cancellationPolicy: CancellationPolicy.MODERATE,
    bedrooms: 2,
    bathrooms: 1,
    squareFootage: 80,
    floor: 4,
    yearBuilt: 1958,
    hasElevator: true,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    petFriendly: true,
    parkingType: 'none',
    amenities: ['wifi', 'air_conditioning', 'heating', 'elevator', 'balcony', 'washing_machine', 'dishwasher', 'kitchen'],
    imageUrls: [IMG.apartment3, IMG.livingRoom1, IMG.bedroom2, IMG.kitchen2, IMG.bathroom1],
    isVerified: true,
    maxGuests: 4,
    address: {
      street: 'Carrer d’Aragó', number: '255', neighborhood: 'Eixample', district: "L'Eixample",
      postal_code: '08007', coordinates: [2.1612, 41.3905], ...BCN
    }
  },
  // Salamanca flat offered BOTH monthly (2300/month) AND by the night (160/night).
  {
    sourceId: 'mad-both-salamanca-20',
    description:
      'Upscale apartment in Madrid’s elegant Salamanca district, offered for both monthly rentals and vacation stays. Designer interiors, doorman building and the city’s best shopping right outside. Premium living, your way.',
    type: PropertyType.APARTMENT,
    longTermRent: { monthlyAmount: 2300, deposit: 4600 },
    shortTermRent: { nightlyRate: 160, cleaningFee: 70, serviceFee: 35, taxesPercent: 10, minNights: 5, maxNights: 120, instantBook: false },
    cancellationPolicy: CancellationPolicy.STRICT,
    bedrooms: 2,
    bathrooms: 2,
    squareFootage: 98,
    floor: 6,
    yearBuilt: 1975,
    hasElevator: true,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    petFriendly: false,
    parkingType: 'garage',
    parkingSpaces: 1,
    amenities: ['wifi', 'air_conditioning', 'heating', 'elevator', 'balcony', 'washing_machine', 'dishwasher', 'kitchen', 'gym', 'secure_entry', 'parking_space'],
    imageUrls: [IMG.apartment1, IMG.livingRoom3, IMG.bedroom1, IMG.bedroom3, IMG.kitchen1, IMG.bathroom1],
    isVerified: true,
    maxGuests: 4,
    address: {
      street: 'Calle de Velázquez', number: '60', neighborhood: 'Salamanca', district: 'Salamanca',
      postal_code: '28001', coordinates: [-3.6838, 40.4285], ...MAD
    }
  },
  // ---------------------- MULTI-OFFERING: long-term + sale ----------------------
  // Sarrià family home offered for rent (2450/month) AND for sale (785,000).
  {
    sourceId: 'bcn-rent-sale-sarria-21',
    description:
      'Elegant family home in the leafy, residential Sarrià district — available to rent or to buy. Three bedrooms, a private garden and plenty of natural light. Quiet, safe and close to international schools.',
    type: PropertyType.HOUSE,
    longTermRent: { monthlyAmount: 2450, deposit: 4900 },
    sale: { price: 785000, estimatedYield: 3, chainStatus: 'no_chain' },
    bedrooms: 3,
    bathrooms: 2,
    squareFootage: 140,
    floor: 0,
    yearBuilt: 1985,
    hasElevator: false,
    hasBalcony: false,
    hasGarden: true,
    furnishedStatus: FurnishedStatus.UNFURNISHED,
    petFriendly: true,
    parkingType: 'garage',
    parkingSpaces: 2,
    amenities: ['wifi', 'heating', 'air_conditioning', 'garden_access', 'parking_space', 'kitchen', 'dishwasher'],
    imageUrls: [IMG.apartment2, IMG.livingRoom3, IMG.bedroom1, IMG.bedroom2, IMG.bathroom1],
    isVerified: true,
    address: {
      street: 'Carrer de Margenat', number: '34', neighborhood: 'Sarrià', district: 'Sarrià-Sant Gervasi',
      postal_code: '08017', coordinates: [2.1245, 41.3998], ...BCN
    }
  },
  // ---------------------- SALE-ONLY ----------------------
  {
    sourceId: 'mad-sale-retiro-22',
    description:
      'Bright, recently reformed apartment for sale beside El Retiro park. South-facing with parquet floors and a renovated kitchen. A solid investment in one of Madrid’s most sought-after locations.',
    type: PropertyType.APARTMENT,
    sale: { price: 620000, estimatedYield: 4, isPriceReduced: true, chainStatus: 'no_chain' },
    bedrooms: 2,
    bathrooms: 2,
    squareFootage: 88,
    floor: 3,
    yearBuilt: 1965,
    hasElevator: true,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.UNFURNISHED,
    parkingType: 'none',
    amenities: ['heating', 'air_conditioning', 'elevator', 'balcony', 'kitchen'],
    imageUrls: [IMG.apartment3, IMG.livingRoom2, IMG.bedroom3, IMG.kitchen2],
    isVerified: true,
    address: {
      street: 'Calle de Alcalá', number: '142', neighborhood: 'Retiro', district: 'Retiro',
      postal_code: '28009', coordinates: [-3.6745, 40.4231], ...MAD
    }
  },
  // ---------------------- EXCHANGE-ONLY ----------------------
  {
    sourceId: 'bcn-exchange-gracia-23',
    description:
      'Welcoming Gràcia apartment open to home exchange and free hosting. We love meeting travellers and would happily swap homes or host you while you explore Barcelona like a local. Tell us about your place!',
    type: PropertyType.APARTMENT,
    exchange: {
      mode: ExchangeMode.BOTH,
      welcomeNote: 'Happy to swap or host. We speak English, Spanish and Catalan and love sharing local tips.',
      languages: ['en', 'es', 'ca'],
      mealsIncluded: false,
      requiresReciprocity: false
    },
    bedrooms: 2,
    bathrooms: 1,
    squareFootage: 70,
    floor: 1,
    yearBuilt: 1962,
    hasElevator: false,
    hasBalcony: true,
    furnishedStatus: FurnishedStatus.FURNISHED,
    petFriendly: true,
    parkingType: 'none',
    amenities: ['wifi', 'air_conditioning', 'heating', 'kitchen', 'washing_machine', 'balcony', 'pet_friendly'],
    imageUrls: [IMG.apartment3, IMG.livingRoom1, IMG.bedroom1, IMG.kitchen2],
    maxGuests: 4,
    address: {
      street: 'Carrer de Torrijos', number: '57', neighborhood: 'Gràcia', district: 'Gràcia',
      postal_code: '08012', coordinates: [2.1592, 41.4028], ...BCN
    }
  }
];

/**
 * Unsplash transform params: format-negotiated, cropped, capped to a sensible
 * source width/quality. Appended before fetching so the bytes we process and
 * store are reasonably sized rather than multi-megabyte originals.
 */
const UNSPLASH_PARAMS = '?auto=format&fit=crop&w=1200&q=80';

/** Append the Unsplash transform params to each bare seed photo URL. */
function withUnsplashParams(urls: readonly string[]): string[] {
  return urls.map((url) => `${url}${UNSPLASH_PARAMS}`);
}

/** Build the `offerings` array from whichever priced blocks the seed sets. */
function resolveOfferings(seed: SeedProperty): OfferingType[] {
  const offerings: OfferingType[] = [];
  if (seed.longTermRent) offerings.push(OfferingType.LONG_TERM_RENT);
  if (seed.shortTermRent) offerings.push(OfferingType.SHORT_TERM_RENT);
  if (seed.sale) offerings.push(OfferingType.SALE);
  if (seed.exchange) offerings.push(OfferingType.EXCHANGE);
  return offerings;
}

async function ensureSeedOwner(): Promise<string> {
  const owner = await Profile.findOneAndUpdate(
    { oxyUserId: SEED_OWNER_OXY_USER_ID },
    {
      $setOnInsert: {
        oxyUserId: SEED_OWNER_OXY_USER_ID,
        personalProfile: {}
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return String(owner._id);
}

async function upsertProperty(seed: SeedProperty, profileId: string): Promise<'inserted' | 'updated'> {
  const address = await Address.findOrCreateCanonical({
    street: seed.address.street,
    number: seed.address.number,
    neighborhood: seed.address.neighborhood,
    district: seed.address.district,
    city: seed.address.city,
    state: seed.address.state,
    postal_code: seed.address.postal_code,
    country: seed.address.country,
    countryCode: seed.address.countryCode,
    coordinates: {
      type: 'Point',
      coordinates: seed.address.coordinates
    }
  });

  const offerings = resolveOfferings(seed);
  const isShortTermCapable = offerings.includes(OfferingType.SHORT_TERM_RENT);
  const isLongTermCapable = offerings.includes(OfferingType.LONG_TERM_RENT);

  const longTermRent = seed.longTermRent
    ? { ...seed.longTermRent, currency: CURRENCY }
    : undefined;
  const shortTermRent = seed.shortTermRent
    ? { ...seed.shortTermRent, currency: CURRENCY }
    : undefined;
  const sale = seed.sale ? { ...seed.sale, currency: CURRENCY } : undefined;
  const exchange = seed.exchange
    ? { ...seed.exchange, availabilityWindows: openShortTermWindow() }
    : undefined;

  const doc: Record<string, unknown> = {
    profileId,
    isExternal: false,
    source: SEED_SOURCE,
    description: seed.description,
    addressId: address._id,
    type: seed.type,
    bedrooms: seed.bedrooms,
    bathrooms: seed.bathrooms,
    squareFootage: seed.squareFootage,
    floor: seed.floor ?? 0,
    yearBuilt: seed.yearBuilt,
    hasElevator: seed.hasElevator ?? false,
    hasBalcony: seed.hasBalcony ?? false,
    hasGarden: seed.hasGarden ?? false,
    utilitiesIncluded: seed.utilitiesIncluded ?? false,
    petFriendly: seed.petFriendly ?? false,
    furnishedStatus: seed.furnishedStatus,
    parkingType: seed.parkingType ?? 'none',
    parkingSpaces: seed.parkingSpaces ?? 0,
    offerings,
    longTermRent,
    shortTermRent,
    sale,
    exchange,
    amenities: seed.amenities,
    // Photos are attached AFTER the property is saved: each seed photo URL is
    // fetched once and persisted as a canonical Image doc keyed by the new
    // property's `_id`, then the resolved `PropertyImageRef[]` is embedded here
    // (see `seedPropertyImages`). Start empty so the property has an `_id` to
    // own its images.
    images: [],
    coverImageIndex: 0,
    leaseTerm: isLongTermCapable ? LeaseDuration.YEARLY : LeaseDuration.FLEXIBLE,
    maxGuests: seed.maxGuests ?? Math.max(1, seed.bedrooms * 2 || 1),
    availabilityWindows: isShortTermCapable ? openShortTermWindow() : [],
    cancellationPolicy: seed.cancellationPolicy,
    isVerified: seed.isVerified ?? false,
    isEcoFriendly: seed.isEcoFriendly ?? false,
    status: PropertyStatus.PUBLISHED,
    availability: {
      isAvailable: true,
      availableFrom: today
    },
    availableFrom: today
  };

  // Drop undefined keys so absent optional blocks aren't persisted as nulls.
  for (const key of Object.keys(doc)) {
    if (doc[key] === undefined) {
      delete doc[key];
    }
  }

  // Create a fresh document (the collection is wiped first in `run`). Using
  // `new Property(...).save()` runs the full document-level validators — the
  // cross-field `offerings`↔blocks check needs the whole document as `this`,
  // which Mongoose's update-validators (on findOneAndUpdate) do not provide.
  doc.sourceId = seed.sourceId;
  const property = await new Property(doc).save();

  // Backfill the canonical Image collection for this property, then embed the
  // resolved `{ url, caption, isPrimary, urls }` refs (the shape the frontend
  // already consumes, now backed by Image docs). `coverImageIndex` stays 0 — the
  // first/primary photo leads.
  const imageRefs = await seedPropertyImages(property._id, withUnsplashParams(seed.imageUrls));
  property.images = imageRefs;
  await property.save();

  return 'inserted';
}

/**
 * Seed each city's cover image. For every seeded city with a curated URL, fetch
 * the photo once, store it as an Image doc (`entityType: 'city'`,
 * `entityId = city._id`) and set the city's `coverImageId` + `imageIds`. Runs
 * after geo is seeded so the City rows (and their `_id`s) exist.
 */
async function seedCityCoverImages(): Promise<void> {
  const cities = await City.find({}).select('_id name');
  for (const city of cities) {
    const url = CITY_COVER_IMAGE_URLS[city.name as keyof typeof CITY_COVER_IMAGE_URLS];
    if (!url) {
      console.warn(`[seed-properties] No curated cover image for city "${city.name}" — skipping`);
      continue;
    }
    try {
      const imageId = await seedEntityCoverImage('city', city._id, url, `${city.name} cityscape`);
      if (imageId) {
        city.coverImageId = imageId;
        city.imageIds = [imageId];
        await city.save();
        console.log(`[seed-properties] city image  ${city.name} -> ${String(imageId)}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[seed-properties] FAILED city image ${city.name}: ${message}`);
      throw err;
    }
  }
}

async function run(): Promise<void> {
  console.log('[seed-properties] Connecting to database...');
  await database.connect();

  // Fresh reseed (no migration): wipe properties, addresses, the geo hierarchy
  // AND every Image doc (property + geo photos), then re-seed geo so addresses
  // resolve against canonical rows.
  console.log('[seed-properties] Wiping properties, addresses, geo collections and images...');
  await Promise.all([
    Property.deleteMany({ source: SEED_SOURCE }),
    Address.deleteMany({}),
    Country.deleteMany({}),
    Region.deleteMany({}),
    City.deleteMany({}),
    Neighborhood.deleteMany({}),
    Image.deleteMany({}),
  ]);

  logStorageMode();

  console.log('[seed-properties] Seeding geo hierarchy (Spain)...');
  const geoSummary = await seedGeo();
  console.log(`[seed-properties] Geo seeded: ${geoSummary.countries} country, ${geoSummary.regions} regions, ${geoSummary.cities} cities, ${geoSummary.neighborhoods} neighborhoods`);

  // Seed each city's cover image: fetch the curated photo ONCE, store it as an
  // Image doc (entityType 'city') in our own object storage, and link it via
  // `coverImageId` — so the runtime never depends on an external image host.
  console.log('[seed-properties] Seeding city cover images (fetch-once-then-store)...');
  await seedCityCoverImages();

  console.log('[seed-properties] Ensuring seed owner profile...');
  const profileId = await ensureSeedOwner();
  console.log(`[seed-properties] Seed owner profileId=${profileId}`);

  let inserted = 0;
  let updated = 0;

  for (const seed of properties) {
    try {
      const result = await upsertProperty(seed, profileId);
      if (result === 'inserted') {
        inserted += 1;
      } else {
        updated += 1;
      }
      console.log(`[seed-properties] ${result.padEnd(8)} ${seed.sourceId} (${resolveOfferings(seed).join('+')})`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[seed-properties] FAILED ${seed.sourceId}: ${message}`);
      throw err;
    }
  }

  // Refresh each city's cached propertiesCount from its resolved addresses.
  console.log('[seed-properties] Refreshing city property counts...');
  const cities = await City.find({}).select('_id name');
  for (const city of cities) {
    await city.updatePropertiesCount();
  }

  const totalSeed = await Property.countDocuments({ source: SEED_SOURCE });
  const longTermCount = await Property.countDocuments({ source: SEED_SOURCE, offerings: OfferingType.LONG_TERM_RENT });
  const shortTermCount = await Property.countDocuments({ source: SEED_SOURCE, offerings: OfferingType.SHORT_TERM_RENT });
  const saleCount = await Property.countDocuments({ source: SEED_SOURCE, offerings: OfferingType.SALE });
  const exchangeCount = await Property.countDocuments({ source: SEED_SOURCE, offerings: OfferingType.EXCHANGE });

  console.log('[seed-properties] ----------------------------------------');
  console.log(`[seed-properties] Inserted: ${inserted}  Updated: ${updated}`);
  console.log(`[seed-properties] Total seed properties:    ${totalSeed}`);
  console.log(`[seed-properties] Long-term-rent listings:  ${longTermCount}`);
  console.log(`[seed-properties] Short-term-rent listings: ${shortTermCount}`);
  console.log(`[seed-properties] Sale listings:            ${saleCount}`);
  console.log(`[seed-properties] Exchange listings:        ${exchangeCount}`);
  console.log('[seed-properties] Done.');
}

run()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[seed-properties] FAILED:', message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await database.disconnect();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[seed-properties] disconnect error:', message);
    }
    process.exit(process.exitCode ?? 0);
  });
