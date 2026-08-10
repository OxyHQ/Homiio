/**
 * The observability contract, from the FRONTEND's side of the workspace.
 *
 * The redaction layer and the query-identity digest live in
 * `@homiio/shared-types` because there must be exactly one implementation of
 * each: eight of the thirteen events in the vocabulary originate on a phone or
 * in a browser, and a second copy of the privacy rules is a second place for
 * them to be wrong silently. This file is what makes that claim testable from
 * here rather than asserted.
 *
 * WHAT IT PROVES AND WHAT IT DOES NOT
 * -----------------------------------
 * It proves three things the backend suite cannot: that the package RESOLVES
 * from this workspace (the frontend reaches it through `dist`, not through the
 * source path mapping the backend's jest uses); that it survives this app's
 * Babel transform rather than the backend's ts-jest one; and that the digest
 * agrees, byte for byte, with the value the backend suite pins.
 *
 * It does NOT prove Hermes. `jest-expo` runs on Node, so a divergence that only
 * appears on a device — the reason `deriveQueryId` avoids `BigInt`,
 * `String.prototype.normalize` and anything else Hermes may not carry — would
 * still get past it. Saying so here rather than letting the file's existence
 * imply otherwise.
 */

import {
  canonicalQueryDescriptor,
  deriveOpaqueRef,
  deriveQueryId,
  isOpaqueId,
  redactObservabilityEvent,
  OBSERVABILITY_SCHEMA_VERSION,
  type QueryDescriptor,
} from '@homiio/shared-types';

/** The same descriptor the backend suite pins, field for field. */
const BARCELONA_QUERY: QueryDescriptor = {
  locationKind: 'city',
  countryCode: 'ES',
  placeKey: 'es-cat-barcelona',
  center: { lat: 41.3874, lng: 2.1686 },
  filters: { bedrooms: 2 },
  sort: 'relevance',
};

describe('shared observability contract, as the frontend sees it', () => {
  it('produces the pinned canonical form', () => {
    // Pinned rather than recomputed: the point is that a change to the
    // canonicalisation is a DELIBERATE, visible change. A test that recomputes
    // the expected value with the same function passes under any refactor,
    // including one that quietly stops including the place key.
    expect(canonicalQueryDescriptor(BARCELONA_QUERY)).toBe(
      'q1|kind=city|country=ES|place=es-cat-barcelona|center=41.387,2.169|radius=|bounds=|text=|sort=relevance|filters=bedrooms:2',
    );
  });

  it('produces the pinned query id, identical to the backend suite', () => {
    expect(deriveQueryId(BARCELONA_QUERY)).toBe('e795565c163c5c95');
    expect(isOpaqueId(deriveQueryId(BARCELONA_QUERY))).toBe(true);
  });

  it('produces the pinned opaque reference', () => {
    expect(deriveOpaqueRef('unit', 'unit-4-2')).toBe('5fc3683bd64ae56a');
  });

  it('refuses a client event carrying an address, here as on the server', () => {
    const result = redactObservabilityEvent({
      event: 'search_results_loaded',
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
      occurredAt: 1_770_000_000_000,
      surface: 'ios',
      queryId: 'e795565c163c5c95',
      locationKind: 'city',
      countryCode: 'ES',
      resultCountBucket: '20-49',
      mapMode: true,
      latencyBucketMs: '250-500',
      stale: false,
      address: 'Carrer de Mallorca 401, 08013 Barcelona',
    });

    expect(result.status).toBe('refused');
    expect(result.event).toBeNull();
    expect(result.violations.map((violation) => violation.field)).toContain('address');
  });

  it('accepts the same event without the address', () => {
    // The positive control. Without it, a build in which every event is refused
    // would pass the case above.
    const result = redactObservabilityEvent({
      event: 'search_results_loaded',
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
      occurredAt: 1_770_000_000_000,
      surface: 'ios',
      queryId: 'e795565c163c5c95',
      locationKind: 'city',
      countryCode: 'ES',
      resultCountBucket: '20-49',
      mapMode: true,
      latencyBucketMs: '250-500',
      stale: false,
    });

    expect(result.status).toBe('ok');
    expect(result.violations).toEqual([]);
  });
});
