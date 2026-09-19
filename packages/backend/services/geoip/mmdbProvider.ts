/**
 * The local MaxMind-format (`.mmdb`) city database adapter.
 *
 * ## Why a file and not an API
 *
 * Both epics ask for a local database "para evitar enviar IPs de usuarios a
 * terceros". This is that: the file is memory-mapped once, a lookup is a
 * B-tree walk in process, and no visitor's address leaves the task. The
 * secondary benefits are not small either — no key to leak, no rate limit to
 * exhaust, no third-party outage that makes Home slow, and no provider terms
 * governing what Homiio may do with its own users' traffic.
 *
 * The format is open and several databases use it (MaxMind's GeoLite2 and
 * GeoIP2, DB-IP's Lite editions). Which file is installed is an operator's
 * decision recorded in `docs/geoip.md`; this adapter only reads one.
 *
 * ## Opening is lazy, and a failed open is remembered
 *
 * The reader is built on first lookup rather than at module load, so importing
 * this module in a test or a CLI touches no filesystem. A failure to open is
 * cached as a failure: a missing or corrupt file does not get re-opened on
 * every request, which would turn one misconfiguration into a per-request
 * syscall storm on the hot path of the home screen.
 */

import type { CityResponse, Reader } from 'maxmind';

import config from '../../config';
import { logger } from '../../middlewares/logging';
import type { GeoIpLookupOutcome, GeoIpProvider, GeoIpRecord } from './types';

export const MMDB_PROVIDER_ID = 'mmdb';

/**
 * The open reader, or the fact that opening was already tried and failed.
 *
 * `undefined` means "not tried yet". `null` means "tried, and it is not
 * available" — the distinction is what stops the retry storm described above.
 */
let reader: Reader<CityResponse> | null | undefined;
let opening: Promise<Reader<CityResponse> | null> | undefined;

/** Test seam: forget the reader so a suite can change the configured path. */
export function resetMmdbReader(): void {
  reader = undefined;
  opening = undefined;
}

async function openReader(path: string): Promise<Reader<CityResponse> | null> {
  try {
    // Imported here rather than at module scope so a deployment with no
    // database configured never loads the library at all, and so this module
    // can be unit-tested without it being resolvable.
    const maxmind = await import('maxmind');
    return await maxmind.open<CityResponse>(path);
  } catch (error) {
    logger.warn('GeoIP database could not be opened; approximate location is unavailable', {
      // The PATH is safe to log and is the only thing an operator needs. The
      // address being looked up is never logged anywhere in this module.
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Pull the pieces Homiio uses out of a MaxMind city record.
 *
 * Everything else the record carries — ASN, ISP, postal code, continent,
 * `is_anonymous_proxy`, the traits block — is dropped HERE rather than
 * downstream, so no later refactor can start reading a field the contract says
 * Homiio does not hold.
 *
 * `subdivisions` is ordered outermost-first; the FIRST entry is the top-level
 * administrative division, which is the one `AdminHierarchy.regionCode` means.
 * Taking the last would yield a county or a district in the countries that
 * publish several levels.
 */
export function recordFromCityResponse(response: CityResponse | null): GeoIpRecord | null {
  const countryCode = response?.country?.iso_code ?? response?.registered_country?.iso_code;
  if (!countryCode) return null;

  const subdivision = response?.subdivisions?.[0];
  const cityName = response?.city?.names?.en;
  const latitude = response?.location?.latitude;
  const longitude = response?.location?.longitude;
  const accuracyRadiusKm = response?.location?.accuracy_radius;

  return {
    countryCode: countryCode.toUpperCase(),
    ...(subdivision?.iso_code ? { regionCode: subdivision.iso_code.toUpperCase() } : {}),
    ...(subdivision?.names?.en ? { regionName: subdivision.names.en } : {}),
    ...(cityName ? { cityName } : {}),
    ...(typeof latitude === 'number' ? { latitude } : {}),
    ...(typeof longitude === 'number' ? { longitude } : {}),
    // Only when the provider published one. See the contract's note on why
    // Homiio never invents this number.
    ...(typeof accuracyRadiusKm === 'number' ? { accuracyRadiusKm } : {}),
  };
}

export function createMmdbProvider(): GeoIpProvider {
  return {
    id: MMDB_PROVIDER_ID,
    async lookup(address: string): Promise<GeoIpLookupOutcome> {
      const path = config.geoip.databasePath;
      if (!path) return { status: 'not_configured' };

      if (reader === undefined) {
        // One in-flight open shared by every concurrent caller, so a cold start
        // that takes ten simultaneous requests opens the file once.
        opening ??= openReader(path);
        reader = await opening;
        opening = undefined;
      }
      if (reader === null) return { status: 'not_configured' };

      try {
        const record = recordFromCityResponse(reader.get(address));
        return record ? { status: 'found', record } : { status: 'not_found' };
      } catch (error) {
        // A malformed address reaches here as a throw from the reader. It is an
        // error rather than `not_found` because the two are fixed differently,
        // and the address is deliberately absent from the log line.
        logger.warn('GeoIP lookup failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return { status: 'error' };
      }
    },
  };
}
