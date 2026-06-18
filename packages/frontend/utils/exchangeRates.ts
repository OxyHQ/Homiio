/**
 * Exchange-rate source for Homiio.
 *
 * Live rates are fetched from the free, key-less frankfurter.app API
 * (https://www.frankfurter.app) with USD as the base currency. Results are
 * cached in-memory for synchronous lookups and persisted to AsyncStorage so
 * they survive app restarts (TTL: 12h). When the network is unavailable and no
 * fresh cache exists, lookups fall back to the bundled {@link STALE_FALLBACK_RATES}
 * table — clearly named so callers understand these values are last-resort and
 * may be stale.
 *
 * The public synchronous API (`getRate`) always reads the in-memory cache; call
 * {@link refreshExchangeRates} from app bootstrap to populate live rates.
 */
import { getData, storeData } from '@/utils/storage';
import { logger } from '@/utils/logger';

export type ExchangeRateTable = Record<string, number>;

/**
 * Last-resort rates (base: USD). Used only when no live or cached rate is
 * available. These are approximate and intentionally not authoritative —
 * frankfurter.app is the real source.
 */
export const STALE_FALLBACK_RATES: ExchangeRateTable = {
  USD: 1.0,
  EUR: 0.85,
  GBP: 0.73,
  JPY: 110.0,
  CAD: 1.25,
  AUD: 1.35,
  CHF: 0.92,
  CNY: 6.45,
  SEK: 8.65,
  NZD: 1.4,
  MXN: 20.0,
  SGD: 1.35,
  HKD: 7.78,
  NOK: 8.5,
  KRW: 1150.0,
  TRY: 8.5,
  RUB: 75.0,
  INR: 74.0,
  BRL: 5.25,
  ZAR: 14.5,
  PLN: 3.85,
  THB: 32.0,
  IDR: 14250.0,
  MYR: 4.15,
  PHP: 50.0,
  CZK: 21.5,
  HUF: 300.0,
  ILS: 3.25,
  CLP: 750.0,
  COP: 3750.0,
  ARS: 95.0,
  PEN: 3.95,
  UYU: 42.0,
  VND: 23000.0,
  EGP: 15.7,
  NGN: 410.0,
  KES: 108.0,
  GHS: 5.85,
  MAD: 9.0,
  TND: 2.75,
  AED: 3.67,
  SAR: 3.75,
  QAR: 3.64,
  KWD: 0.3,
  BHD: 0.38,
  OMR: 0.38,
  JOD: 0.71,
  LBP: 1500.0,
  IRR: 42000.0,
  PKR: 155.0,
  BDT: 85.0,
  LKR: 200.0,
  NPR: 118.0,
  MMK: 1650.0,
  KHR: 4050.0,
  LAK: 9500.0,
  MNT: 2850.0,
  KZT: 425.0,
  UZS: 10500.0,
  TJS: 11.0,
  TMT: 3.5,
  GEL: 3.1,
  AMD: 520.0,
  AZN: 1.7,
  BYN: 2.5,
  MDL: 17.5,
  UAH: 27.0,
  RSD: 100.0,
  BGN: 1.65,
  HRK: 6.5,
  RON: 4.2,
  ALL: 105.0,
  MKD: 52.0,
  BAM: 1.65,
  MNE: 0.85,
  XCD: 2.7,
  BBD: 2.0,
  BZD: 2.0,
  BMD: 1.0,
  KYD: 0.83,
  JMD: 150.0,
  TTD: 6.75,
  GYD: 208.0,
  SRD: 21.0,
  FJD: 2.1,
  WST: 2.6,
  TOP: 2.3,
  VUV: 110.0,
  SBD: 8.0,
  PGK: 3.5,
  KID: 1.0,
  TVD: 1.0,
  NAD: 14.5,
  BWP: 10.8,
  LSL: 14.5,
  SZL: 14.5,
  MUR: 40.0,
  SCR: 20.0,
  DJF: 177.0,
  ETB: 43.0,
  SOS: 580.0,
  TZS: 2300.0,
  UGX: 3500.0,
  RWF: 1000.0,
  BIF: 1950.0,
  CDF: 2000.0,
  XAF: 550.0,
  XOF: 550.0,
  XPF: 110.0,
  KMF: 440.0,
  MGA: 3800.0,
  MZN: 60.0,
  MWK: 800.0,
  ZMW: 17.0,
  ZWL: 1.0,
  STN: 20.0,
  CVE: 100.0,
  GMD: 50.0,
  GNF: 10000.0,
  SLL: 10000.0,
  LRD: 150.0,
  GIP: 0.73,
  FKP: 0.73,
  SHP: 0.73,
  IMP: 0.73,
  JEP: 0.73,
  GGP: 0.73,
  AOA: 650.0,
  ERN: 15.0,
  SSP: 0.73,
  SDG: 450.0,
  LYD: 4.5,
  DZD: 135.0,
  MRO: 35.0,
  SYP: 2500.0,
  IQD: 1460.0,
  AFN: 80.0,
  BTN: 74.0,
  BND: 1.35,
  PAL: 0.73,
  // FAIRCoin has no public market API, so its rate is fixed by design
  // (1 FAIR pegged to 1 USD equivalent) rather than fetched.
  FAIR: 1.0,
};

/** Rate that never comes from the live API (no market feed exists). */
const FIXED_RATES: ExchangeRateTable = {
  FAIR: 1.0,
};

const CACHE_STORAGE_KEY = 'homiio.exchangeRates';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FRANKFURTER_LATEST_URL = 'https://api.frankfurter.app/latest?from=USD';

interface CachedRates {
  rates: ExchangeRateTable;
  fetchedAt: number;
}

interface FrankfurterResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

let memoryRates: ExchangeRateTable = { ...STALE_FALLBACK_RATES };
let lastFetchedAt = 0;
let inFlight: Promise<ExchangeRateTable> | null = null;
let hydrated = false;

function applyRates(rates: ExchangeRateTable, fetchedAt: number): void {
  memoryRates = { ...STALE_FALLBACK_RATES, ...rates, ...FIXED_RATES, USD: 1.0 };
  lastFetchedAt = fetchedAt;
}

async function hydrateFromStorage(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const cached = await getData<CachedRates>(CACHE_STORAGE_KEY);
    if (cached?.rates && typeof cached.fetchedAt === 'number') {
      applyRates(cached.rates, cached.fetchedAt);
    }
  } catch (error) {
    logger.warn('ExchangeRates: failed to hydrate cache from storage', error);
  }
}

async function fetchLiveRates(): Promise<ExchangeRateTable> {
  const response = await fetch(FRANKFURTER_LATEST_URL);
  if (!response.ok) {
    throw new Error(`frankfurter.app responded with status ${response.status}`);
  }
  const data: FrankfurterResponse = await response.json();
  if (!data?.rates || typeof data.rates !== 'object') {
    throw new Error('frankfurter.app returned an unexpected payload');
  }
  return { ...data.rates, USD: 1.0 };
}

/**
 * Refresh exchange rates from the live API. Hydrates from AsyncStorage first;
 * if the cached rates are still within the TTL, the network call is skipped.
 * On network failure the existing (cached or fallback) rates are kept. Safe to
 * call repeatedly — concurrent calls share a single in-flight request.
 */
export async function refreshExchangeRates(): Promise<ExchangeRateTable> {
  await hydrateFromStorage();

  const isFresh = Date.now() - lastFetchedAt < CACHE_TTL_MS;
  if (isFresh && lastFetchedAt > 0) {
    return memoryRates;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const rates = await fetchLiveRates();
      const fetchedAt = Date.now();
      applyRates(rates, fetchedAt);
      const cached: CachedRates = { rates, fetchedAt };
      await storeData(CACHE_STORAGE_KEY, cached);
      return memoryRates;
    } catch (error) {
      logger.warn('ExchangeRates: live refresh failed, using cached/fallback rates', error);
      return memoryRates;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Synchronous lookup of a currency's rate relative to USD, read from the
 * in-memory cache. Falls back to {@link STALE_FALLBACK_RATES} (and ultimately
 * 1.0) when the currency is unknown. Call {@link refreshExchangeRates} on
 * bootstrap to keep this cache current.
 */
export function getRate(currencyCode: string): number {
  return memoryRates[currencyCode] ?? STALE_FALLBACK_RATES[currencyCode] ?? 1.0;
}
