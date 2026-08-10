/**
 * The redaction layer, tested against THE PAYLOAD THE TRANSPORT RECEIVES.
 *
 * That distinction is the whole point of this file, and it is why every
 * assertion below reads from a captured array rather than from the object the
 * caller passed in. Inspecting the pre-redaction object proves that the test
 * author knew what they meant to send; only the captured payload proves what
 * would have left the process.
 *
 * The careless caller is modelled with `Object.assign` onto a well-typed
 * object rather than with a cast. That is not squeamishness about `as`: it is
 * the faithful model. A field nobody declared arrives from a JavaScript call
 * site, an older bundle, or a hand-written `fetch` — never from a call the
 * compiler saw and approved — so a test that had to defeat the type system to
 * express it would be testing a situation that cannot occur.
 *
 * Three anti-vacuity defences, because a redaction test that has silently
 * stopped exercising anything looks exactly like one that passes:
 *
 *   1. a POSITIVE CONTROL — a well-formed event must be captured, so "nothing
 *      was captured" cannot pass as "nothing sensitive was captured";
 *   2. a COUNT FLOOR on the sensitive-payload table, so losing cases from it is
 *      a failure rather than a quieter run;
 *   3. an assertion that each refusal names the OFFENDING FIELD, so a refusal
 *      for an unrelated reason — a typo in a fixture, a missing required field
 *      — cannot be mistaken for the redaction working.
 *
 * Mutation evidence is in the pull-request body: breaking the allowlist and
 * breaking the final sweep each turn specific named cases red.
 */

import {
  OBSERVABILITY_SCHEMA_VERSION,
  assertSchemaIsWellFormed,
  createObservabilityEmitter,
  redactObservabilityEvent,
  scanForSensitiveValues,
  type ObservabilityEmitInput,
  type ObservabilityEvent,
  type ObservabilityViolation,
} from '@homiio/shared-types';

/** A capturing transport. What lands here is what would have left the process. */
function capturingTransport(): {
  captured: ObservabilityEvent[];
  transport: (event: ObservabilityEvent) => void;
} {
  const captured: ObservabilityEvent[] = [];
  return { captured, transport: (event) => captured.push(event) };
}

const FIXED_NOW = 1_770_000_000_000;

function emitterWithCapture(): {
  captured: ObservabilityEvent[];
  refusals: { event: string | null; violations: readonly ObservabilityViolation[] }[];
  emitter: ReturnType<typeof createObservabilityEmitter>;
} {
  const { captured, transport } = capturingTransport();
  const refusals: { event: string | null; violations: readonly ObservabilityViolation[] }[] = [];
  const emitter = createObservabilityEmitter({
    surface: 'web',
    transport,
    now: () => FIXED_NOW,
    onRefused: (event, violations) => refusals.push({ event, violations }),
  });
  return { captured, refusals, emitter };
}

/** A valid `search_results_loaded` — the shape the issue documents as permitted. */
const GOOD_SEARCH_RESULTS = {
  queryId: '0123456789abcdef',
  locationKind: 'city',
  countryCode: 'ES',
  resultCountBucket: '20-49',
  radiusBucketKm: '10-25',
  mapMode: true,
  latencyBucketMs: '250-500',
  stale: false,
} as const;

/** The same event with something a caller attached that the compiler never saw. */
function carelessSearchResults(
  extra: Record<string, unknown>,
): ObservabilityEmitInput<'search_results_loaded'> {
  const fields: ObservabilityEmitInput<'search_results_loaded'> = { ...GOOD_SEARCH_RESULTS };
  Object.assign(fields, extra);
  return fields;
}

describe('observability schema', () => {
  it('is well formed', () => {
    expect(assertSchemaIsWellFormed()).toEqual([]);
  });

  it('accepts the exact payload the issue documents as permitted', () => {
    const { captured, emitter } = emitterWithCapture();

    const result = emitter.emit('search_results_loaded', GOOD_SEARCH_RESULTS);

    expect(result.status).toBe('emitted');
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      event: 'search_results_loaded',
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
      occurredAt: FIXED_NOW,
      surface: 'web',
      ...GOOD_SEARCH_RESULTS,
    });
  });

  it('stamps version, clock and surface itself, whatever the caller supplied', () => {
    const { captured, emitter } = emitterWithCapture();

    emitter.emit(
      'search_results_loaded',
      // A caller cannot backdate an event, relabel which platform it came from,
      // or claim a schema version the consumer does not support: the emitter
      // applies its own stamps after the caller's fields, not before.
      carelessSearchResults({
        occurredAt: 1_700_000_000_000,
        surface: 'server',
        schemaVersion: 99,
      }),
    );

    const [event] = captured;
    expect(event?.occurredAt).toBe(FIXED_NOW);
    expect(event?.surface).toBe('web');
    expect(event?.schemaVersion).toBe(OBSERVABILITY_SCHEMA_VERSION);
  });
});

/**
 * Every one of these is something somebody could plausibly attach to an event,
 * and every one must be absent from what the transport receives.
 *
 * `offender` is the field name the refusal must cite. Asserting only that a
 * refusal happened is not enough: a fixture malformed for an unrelated reason
 * is also refused, and would read as the redaction working.
 */
const SENSITIVE_PAYLOADS: readonly {
  readonly what: string;
  readonly offender: string;
  readonly extra: Record<string, unknown>;
}[] = [
  {
    what: 'a full street address',
    offender: 'address',
    extra: { address: 'Carrer de Mallorca 401, 08013 Barcelona' },
  },
  {
    what: 'exact coordinates as numbers',
    offender: 'lat',
    extra: { lat: 41.38743, lng: 2.1686 },
  },
  {
    what: 'exact coordinates smuggled into a string',
    offender: 'coords',
    extra: { coords: '41.38743,2.16860' },
  },
  {
    what: 'a residence document reference',
    offender: 'residencyDocument',
    extra: { residencyDocument: 'padron-2026-4471982' },
  },
  {
    what: 'a contact email',
    offender: 'contactEmail',
    extra: { contactEmail: 'inquilina@example.com' },
  },
  {
    what: 'a contact phone with no separators',
    offender: 'contactPhone',
    extra: { contactPhone: '+34600123456' },
  },
  {
    what: 'the text of a review',
    offender: 'reviewBody',
    extra: { reviewBody: 'The landlord kept the deposit and stopped answering' },
  },
  {
    what: 'a free-text search term',
    offender: 'freeText',
    extra: { freeText: 'mallorca 401' },
  },
  {
    what: 'a nested object that could hide anything at all',
    offender: 'context',
    extra: { context: { address: 'Carrer de Mallorca 401' } },
  },
];

/**
 * The other half of the rule: a value the sweep cannot fault is DROPPED and the
 * event proceeds, because an older server must not lose a newer client's whole
 * event over a field it has not heard of.
 *
 * The last two entries are the ones that matter most, and they are not
 * harmless. A postcode and an account reference are label-shaped — short, no
 * punctuation, no long digit run — so the sweep has nothing to object to. The
 * ALLOWLIST is the only thing standing between them and a log line, which is
 * why it is the primary mechanism and the sweep is the backstop rather than the
 * other way round. Mutation-testing the allowlist turns exactly these cases red.
 *
 * Both halves of the rule are asserted, because having only the refusal half
 * would let somebody "simplify" the drop path into a blanket refusal, breaking
 * every deployment with a version skew, with a green suite.
 */
const DROPPED_BY_ALLOWLIST: readonly {
  readonly what: string;
  readonly field: string;
  readonly extra: Record<string, unknown>;
}[] = [
  {
    what: 'a field from a newer client build',
    field: 'experimentArm',
    // Distinctive enough that the absence assertion below means something: a
    // one-character value occurs inside half the other fields by chance.
    extra: { experimentArm: 'variant_b' },
  },
  {
    what: 'an identifier of the wrong shape in the session field',
    field: 'sessionId',
    extra: { sessionId: '68f4a1b2c3d4e5f6a7b8c9d0' },
  },
  {
    what: 'a postcode, which no value-level rule can recognise',
    field: 'postcode',
    extra: { postcode: '08013' },
  },
  {
    what: 'an account reference shaped exactly like a permitted label',
    field: 'landlordRef',
    extra: { landlordRef: 'a1b2c3d4e5f6a7b8' },
  },
];

describe('observability redaction — negative cases', () => {
  it('has not lost its cases', () => {
    // A floor, not an equality: adding a case is progress, losing one is not.
    expect(SENSITIVE_PAYLOADS.length).toBeGreaterThanOrEqual(9);
    expect(DROPPED_BY_ALLOWLIST.length).toBeGreaterThanOrEqual(4);
  });

  it.each(SENSITIVE_PAYLOADS)('never lets $what reach the transport', ({ offender, extra }) => {
    const { captured, refusals, emitter } = emitterWithCapture();

    emitter.emit('search_results_loaded', carelessSearchResults(extra));

    // THE ASSERTION THAT MATTERS: nothing at all reached the transport.
    expect(captured).toEqual([]);

    // And it was refused for the right reason, naming the right field.
    const cited = refusals.flatMap((refusal) => refusal.violations);
    expect(cited.map((violation) => violation.field)).toContain(offender);
  });

  it.each(DROPPED_BY_ALLOWLIST)(
    'drops $what and lets the rest of the event through',
    ({ field, extra }) => {
      const { captured, refusals, emitter } = emitterWithCapture();

      const result = emitter.emit('search_results_loaded', carelessSearchResults(extra));

      expect(result.status).toBe('emitted');
      expect(captured).toHaveLength(1);
      // The field is gone from what the transport received, and so is its value.
      expect(captured[0]).not.toHaveProperty(field);
      expect(JSON.stringify(captured[0])).not.toContain(String(Object.values(extra)[0]));
      // Dropped is not the same as unnoticed: the drop is reported, because a
      // caller passing an undeclared field usually thinks it is passing
      // something useful.
      expect(refusals.flatMap((refusal) => refusal.violations).map((v) => v.field)).toContain(
        field,
      );
    },
  );

  it('never puts the offending VALUE into the violation it reports', () => {
    const { refusals, emitter } = emitterWithCapture();
    const secret = 'Carrer de Mallorca 401, 08013 Barcelona';

    emitter.emit('search_results_loaded', carelessSearchResults({ address: secret }));

    // A violation record is itself logged. Putting the value in it would leak
    // precisely what the refusal prevented.
    expect(refusals).not.toHaveLength(0);
    expect(JSON.stringify(refusals)).not.toContain('Mallorca');
    expect(JSON.stringify(refusals)).not.toContain(secret);
  });

  it('refuses an event whose required field is missing rather than emitting a partial one', () => {
    const { captured, emitter } = emitterWithCapture();

    const result = emitter.emit(
      'search_results_loaded',
      carelessSearchResults({ resultCountBucket: undefined }),
    );

    expect(result.status).toBe('refused');
    expect(captured).toEqual([]);
    expect(result.violations).toContainEqual({
      field: 'resultCountBucket',
      code: 'missing_required',
    });
  });

  it('refuses a bucket label that is not in the declared set', () => {
    const { captured, emitter } = emitterWithCapture();

    // `47` is the real count. A label outside the set is how an exact number
    // gets out, and the closed enum is what stops it.
    const result = emitter.emit(
      'search_results_loaded',
      carelessSearchResults({ resultCountBucket: '47' }),
    );

    expect(result.status).toBe('refused');
    expect(captured).toEqual([]);
    expect(result.violations).toContainEqual({
      field: 'resultCountBucket',
      code: 'invalid_value',
    });
  });

  it('refuses an unknown event name outright', () => {
    const result = redactObservabilityEvent({
      event: 'user_signed_in',
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
      occurredAt: FIXED_NOW,
      surface: 'web',
    });

    expect(result.status).toBe('refused');
    expect(result.event).toBeNull();
    expect(result.violations).toContainEqual({ field: 'event', code: 'unknown_event' });
  });

  it('refuses an event stamped with a schema version this build does not support', () => {
    const result = redactObservabilityEvent({
      ...GOOD_SEARCH_RESULTS,
      event: 'search_results_loaded',
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION + 1,
      occurredAt: FIXED_NOW,
      surface: 'web',
    });

    expect(result.status).toBe('refused');
    expect(result.violations).toContainEqual({
      field: 'schemaVersion',
      code: 'unsupported_schema_version',
    });
  });

  it('refuses a timestamp that is not a plausible instant', () => {
    // 41.3874 is a latitude. It is also a number, and `occurredAt` is a number
    // field — the epoch band is the only thing that tells them apart.
    const result = redactObservabilityEvent({
      ...GOOD_SEARCH_RESULTS,
      event: 'search_results_loaded',
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
      occurredAt: 41.3874,
      surface: 'web',
    });

    expect(result.status).toBe('refused');
    // Classified `sensitive_value` rather than merely invalid: a fractional
    // number in a timestamp field is what an exact coordinate looks like.
    expect(result.violations).toContainEqual({ field: 'occurredAt', code: 'sensitive_value' });
  });

  it('refuses anything that is not an object', () => {
    const inputs: unknown[] = ['a string', 42, null, undefined, [GOOD_SEARCH_RESULTS]];
    for (const input of inputs) {
      const result = redactObservabilityEvent(input);
      expect(result.status).toBe('refused');
      expect(result.event).toBeNull();
    }
  });
});

describe('observability emitter behaviour', () => {
  it('never throws when the transport does, and reports it instead', () => {
    const emitter = createObservabilityEmitter({
      surface: 'web',
      now: () => FIXED_NOW,
      transport: () => {
        throw new Error('sink unavailable');
      },
    });

    // Observability must not be able to break the action it observes.
    const result = emitter.emit('search_results_loaded', GOOD_SEARCH_RESULTS);

    expect(result.status).toBe('transport_error');
    expect(emitter.stats().transportErrors).toBe(1);
    expect(emitter.stats().emitted).toBe(0);
  });

  it('samples successful events but never samples a refusal away', () => {
    const { captured, transport } = capturingTransport();
    const emitter = createObservabilityEmitter({
      surface: 'web',
      transport,
      now: () => FIXED_NOW,
      // Drops everything the sampler is allowed to drop.
      sampling: { default: 0 },
      random: () => 0.999,
    });

    emitter.emit('search_results_loaded', GOOD_SEARCH_RESULTS);
    emitter.emit(
      'search_results_loaded',
      carelessSearchResults({ address: 'Carrer de Mallorca 401' }),
    );

    expect(captured).toEqual([]);
    const stats = emitter.stats();
    expect(stats.sampledOut).toBe(1);
    // The refusal is counted in full. A privacy defect that sampling could hide
    // is a privacy defect nobody would ever see.
    expect(stats.refused).toBe(1);
    expect(stats.violationsByCode.sensitive_value).toBe(1);
  });

  it('measures review-step abandonment without identifying anybody', () => {
    const { captured, emitter } = emitterWithCapture();
    const wizardId = 'a1b2c3d4e5f60718';

    emitter.emit('review_step_completed', {
      wizardId,
      stepId: 'identify_address',
      stepIndex: 0,
      durationBucketS: '30-120',
    });
    emitter.emit('review_abandoned', {
      wizardId,
      lastStepId: 'evidence',
      lastStepIndex: 5,
      durationBucketS: '120-600',
      reason: 'navigated_away',
    });

    // The funnel is answerable — which step, how long, why it ended — and the
    // only thing tying the two events together is a per-draft opaque reference
    // that resolves to nobody.
    expect(captured.map((event) => event.event)).toEqual([
      'review_step_completed',
      'review_abandoned',
    ]);
    for (const event of captured) {
      const keys = Object.keys(event);
      expect(keys).not.toContain('oxyUserId');
      expect(keys).not.toContain('profileId');
      expect(keys).not.toContain('addressId');
      expect(scanForSensitiveValues(event, new Set(['wizardId']))).toEqual([]);
    }
  });

  it('honours a per-event sampling override', () => {
    const { captured, transport } = capturingTransport();
    const emitter = createObservabilityEmitter({
      surface: 'web',
      transport,
      now: () => FIXED_NOW,
      sampling: { default: 0, perEvent: { search_zero_results: 1 } },
      random: () => 0.5,
    });

    emitter.emit('search_results_loaded', GOOD_SEARCH_RESULTS);
    emitter.emit('search_zero_results', {
      queryId: '0123456789abcdef',
      locationKind: 'city',
      countryCode: 'ES',
      filterCount: 3,
      hasFreeText: false,
      fallbackApplied: 'none',
    });

    expect(captured.map((event) => event.event)).toEqual(['search_zero_results']);
  });
});
