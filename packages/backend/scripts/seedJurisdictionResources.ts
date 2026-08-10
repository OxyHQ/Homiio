/**
 * Seed the curated jurisdiction resources the eviction board links to.
 *
 * ## This list is deliberately SHORT, and that is the honest state
 *
 * Every row is a link to an organisation or a public authority that a person
 * checked on the date recorded. Homiio does not give legal advice (#358's own
 * out-of-scope list says so), so the alternative to a short list is not a longer
 * one — it is an invented one, and a wrong number in the worst week of somebody's
 * life is worse than no number at all.
 *
 * Spain only, because that is the market Homiio operates in. Every other country
 * returns an empty list, and the UI says "nothing verified for your area yet",
 * which is true. Extending this needs somebody to check the links and set a new
 * `verifiedAt`, not a code change.
 *
 * ## `validUntil` forces a re-check
 *
 * Twelve months. A resource that nobody re-verifies disappears from the API
 * rather than quietly continuing to assert itself — `listJurisdictionResources`
 * applies the deadline in its `WHERE`, so an unmaintained list degrades to
 * silence instead of to confident staleness.
 *
 * ## Idempotent
 *
 * `upsertJurisdictionResource` conflicts on `(country_code, url)`, so re-running
 * this converges and re-stamps `verifiedAt` — which is exactly what a re-check
 * is. Run it with:
 *
 * ```
 * bunx ts-node --transpile-only scripts/seedJurisdictionResources.ts
 * ```
 */

import { closePostgres, connectPostgres } from '../db/postgres';
import {
  upsertJurisdictionResource,
  type JurisdictionResourceInsert,
} from '../db/evictions/jurisdictionResourceRepository';
import { logger } from '../middlewares/logging';

/** How long a checked link is trusted before it must be checked again. */
const VALIDITY_MONTHS = 12;

function validUntil(verifiedAt: Date): Date {
  const until = new Date(verifiedAt);
  until.setMonth(until.getMonth() + VALIDITY_MONTHS);
  return until;
}

/**
 * The date these links were checked.
 *
 * A constant rather than `new Date()`, so re-running the seed without
 * re-checking does not silently claim a fresh verification. Changing it is the
 * act of saying "I looked".
 */
const VERIFIED_AT = new Date('2026-08-10T00:00:00.000Z');

const ES_RESOURCES: readonly Omit<JurisdictionResourceInsert, 'verifiedAt' | 'validUntil'>[] = [
  {
    countryCode: 'ES',
    resourceType: 'legal_aid',
    title: 'Justicia gratuita — Consejo General de la Abogacía Española',
    url: 'https://www.abogacia.es/servicios-al-ciudadano/justicia-gratuita/',
    source: 'Consejo General de la Abogacía Española',
    languages: ['es'],
  },
  {
    countryCode: 'ES',
    resourceType: 'tenant_union',
    title: 'Plataforma de Afectados por la Hipoteca (PAH)',
    url: 'https://afectadosporlahipoteca.com/',
    source: 'Plataforma de Afectados por la Hipoteca',
    languages: ['es'],
  },
  {
    countryCode: 'ES',
    resourceType: 'tenant_union',
    title: 'Sindicat de Llogateres i Llogaters',
    url: 'https://sindicatdellogateres.org/',
    source: 'Sindicat de Llogateres i Llogaters',
    languages: ['ca', 'es'],
  },
  {
    countryCode: 'ES',
    resourceType: 'official_info',
    title: 'Ministerio de Vivienda y Agenda Urbana',
    url: 'https://www.mivau.gob.es/',
    source: 'Gobierno de España',
    languages: ['es'],
  },
];

export async function seedJurisdictionResources(): Promise<number> {
  let written = 0;
  for (const resource of ES_RESOURCES) {
    await upsertJurisdictionResource({
      ...resource,
      verifiedAt: VERIFIED_AT,
      validUntil: validUntil(VERIFIED_AT),
    });
    written += 1;
  }
  return written;
}

/**
 * Run only when invoked directly, so importing this module for a test does not
 * write to whatever database the test happens to be pointed at.
 */
if (require.main === module) {
  void (async () => {
    await connectPostgres();
    try {
      const written = await seedJurisdictionResources();
      logger.info('Seeded jurisdiction resources', { written });
    } finally {
      await closePostgres();
    }
  })();
}
