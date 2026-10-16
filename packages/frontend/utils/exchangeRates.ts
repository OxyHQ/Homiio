/**
 * Exchange rates for Homiio, relative to USD.
 *
 * Live rates come from the free, key-less frankfurter.app API
 * (https://www.frankfurter.app) through `useExchangeRates()` — React Query owns
 * the caching (12h). While they load, or if the API is unreachable,
 * {@link FALLBACK_RATES} stands in: approximate, last-resort values.
 *
 * Listing prices are never converted (see `components/MoneyText.tsx`); rates
 * only reach the currency picker in settings.
 */
import { useQuery } from '@tanstack/react-query';

export type ExchangeRateTable = Readonly<Record<string, number>>;

/**
 * Last-resort rates (base: USD), used only until live rates arrive or when the
 * API is unreachable. Approximate and intentionally not authoritative.
 */
export const FALLBACK_RATES: ExchangeRateTable = {
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

/** Rates that never come from the live API (no market feed exists). */
const FIXED_RATES: ExchangeRateTable = {
  // FAIRCoin is pegged 1:1 to the US dollar by design.
  FAIR: 1.0,
};

const FRANKFURTER_LATEST_URL = 'https://api.frankfurter.app/latest?from=USD';
const RATES_STALE_TIME_MS = 12 * 60 * 60 * 1000;

async function fetchLiveRates(): Promise<ExchangeRateTable> {
  const response = await fetch(FRANKFURTER_LATEST_URL);
  if (!response.ok) {
    throw new Error(`frankfurter.app responded with status ${response.status}`);
  }
  const data: { rates?: Record<string, number> } = await response.json();
  if (!data?.rates || typeof data.rates !== 'object') {
    throw new Error('frankfurter.app returned an unexpected payload');
  }
  return { ...FALLBACK_RATES, ...data.rates, ...FIXED_RATES, USD: 1.0 };
}

/** Live rates relative to USD; {@link FALLBACK_RATES} until they arrive or if they fail. */
export function useExchangeRates(): ExchangeRateTable {
  const { data } = useQuery({
    queryKey: ['exchangeRates'],
    queryFn: fetchLiveRates,
    staleTime: RATES_STALE_TIME_MS,
    gcTime: RATES_STALE_TIME_MS,
  });
  return data ?? FALLBACK_RATES;
}
