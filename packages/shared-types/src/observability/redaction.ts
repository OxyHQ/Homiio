/**
 * The central redaction layer.
 *
 * THIS IS THE ONLY WAY AN EVENT REACHES A TRANSPORT. `./emitter` calls it and
 * has no path around it; the backend ingest handler calls it again on receipt.
 * Both layers matter: the first stops a careless caller, the second stops a
 * client build that is old, modified or not ours.
 *
 * WHAT IT GUARANTEES, AND HOW
 * ---------------------------
 * Two independent mechanisms, in this order, because either alone has a hole:
 *
 *   1. **Allowlist by field kind.** Only fields the schema declares survive;
 *      anything else is DROPPED. A surviving field must satisfy its declared
 *      kind, and no kind can hold free text or a fractional number (see
 *      `./schema`). This is what makes a street name or an exact coordinate
 *      structurally impossible rather than merely discouraged. It is also what
 *      the hole is: it trusts the schema, so a future field declared with a
 *      looser kind would pass. A dropped value is examined too — see the
 *      comment at the drop site for why forward compatibility stops at a value
 *      that is already disqualified.
 *
 *   2. **A kind-agnostic sweep of the FINAL object.** Every value that came out
 *      of step 1 is re-examined without reference to what it was supposed to
 *      be: strings must be short, must use a label charset with no `@`, `.`,
 *      comma or space, and must not carry a long digit run; numbers must be
 *      integers. A single failure REFUSES the whole event rather than trimming
 *      it, because a payload that reached this point carrying a phone number is
 *      evidence of a defect upstream, and emitting the rest of it would hide
 *      that.
 *
 * VIOLATIONS CARRY FIELD NAMES, NEVER VALUES. A violation record is itself
 * something that gets logged, and a "rejected: address=Carrer de Mallorca 401"
 * log line leaks precisely what the rejection prevented.
 *
 * `opaqueId` fields are exempt from the sweep's string heuristics — and only
 * those. Their kind check is `^[0-9a-f]{16}$`, which is stricter than anything
 * the sweep could apply, and without the exemption the ~1-in-4700 id that
 * happens to be all digits would be refused as a phone number.
 */

import {
  OBSERVABILITY_ENVELOPE_SPEC,
  OBSERVABILITY_EVENT_NAMES,
  OBSERVABILITY_EVENT_SPECS,
  OBSERVABILITY_SCHEMA_VERSION,
  type ObservabilityEvent,
  type ObservabilityEventName,
  type ObservabilityEventSpec,
  type ObservabilityFieldKind,
} from './schema';
import { isOpaqueId } from './queryIdentity';

/** Why a field was dropped, or an event refused. */
export type ObservabilityViolationCode =
  | 'not_an_object'
  | 'unknown_event'
  | 'unsupported_schema_version'
  | 'unknown_field'
  | 'invalid_value'
  | 'missing_required'
  | 'sensitive_value';

/** A single problem. The field NAME only — see the module header. */
export interface ObservabilityViolation {
  readonly field: string;
  readonly code: ObservabilityViolationCode;
}

export type RedactionResult =
  | {
      readonly status: 'ok';
      readonly eventName: ObservabilityEventName;
      readonly event: ObservabilityEvent;
      readonly violations: readonly ObservabilityViolation[];
    }
  | {
      readonly status: 'refused';
      readonly eventName: ObservabilityEventName | null;
      readonly event: null;
      readonly violations: readonly ObservabilityViolation[];
    };

/**
 * The oldest and newest instants an `epochMs` field may carry: 2020-09-13 to
 * 2100-01-01. Wide enough that no real clock skew trips it, narrow enough that
 * a latitude, a price or a result count cannot pass as a timestamp.
 */
export const MIN_EPOCH_MS = 1_600_000_000_000;
export const MAX_EPOCH_MS = 4_102_444_800_000;

/** Longest label any enum in the schema declares, with headroom. */
export const SAFE_LABEL_MAX_LENGTH = 24;

/**
 * Characters a label may use. Bucket labels need digits, `-` and `+`
 * (`10-25`, `200+`); enum labels need letters and `_`. Nothing else — which is
 * what excludes an email (`@`, `.`), a coordinate pair (`.`, `,`), an address
 * or any sentence (spaces).
 */
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9_+-]+$/;

/**
 * Seven consecutive digits. No label in the schema has more than five
 * (`10000+`, `1000-10000`), and a compact phone number or a document number
 * has more — the one PII shape the charset rule above lets through.
 */
const LONG_DIGIT_RUN = /\d{7,}/;

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

function isValidForKind(kind: ObservabilityFieldKind, value: unknown): boolean {
  switch (kind.kind) {
    case 'enum':
      return typeof value === 'string' && kind.values.includes(value);
    case 'opaqueId':
      return isOpaqueId(value);
    case 'countryCode':
      return typeof value === 'string' && COUNTRY_CODE_PATTERN.test(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'smallInt':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= kind.max
      );
    case 'epochMs':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= MIN_EPOCH_MS &&
        value <= MAX_EPOCH_MS
      );
  }
}

/**
 * Step 2: re-examine the surviving values without trusting what kind they were
 * declared as. Returns the fields that must not be emitted.
 *
 * `opaqueIdFields` names the fields whose kind check is already stricter than
 * anything here; see the module header.
 */
export function scanForSensitiveValues(
  record: Readonly<Record<string, unknown>>,
  opaqueIdFields: ReadonlySet<string>,
): ObservabilityViolation[] {
  const violations: ObservabilityViolation[] = [];

  for (const [field, value] of Object.entries(record)) {
    if (field === 'event') continue;

    if (typeof value === 'boolean') continue;

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        violations.push({ field, code: 'sensitive_value' });
      }
      continue;
    }

    if (typeof value === 'string') {
      if (opaqueIdFields.has(field)) continue;
      if (
        value.length === 0 ||
        value.length > SAFE_LABEL_MAX_LENGTH ||
        !SAFE_LABEL_PATTERN.test(value) ||
        LONG_DIGIT_RUN.test(value)
      ) {
        violations.push({ field, code: 'sensitive_value' });
      }
      continue;
    }

    // Anything else — an object, an array, `null`, a function — has no place in
    // a flat event and could nest arbitrary content below the sweep.
    violations.push({ field, code: 'sensitive_value' });
  }

  return violations;
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/**
 * Redact one event. Accepts `unknown` on purpose: the ingest endpoint's input
 * is a parsed request body, and typing that as anything narrower would be a
 * claim the network cannot make.
 */
export function redactObservabilityEvent(input: unknown): RedactionResult {
  if (!isPlainRecord(input)) {
    return {
      status: 'refused',
      eventName: null,
      event: null,
      violations: [{ field: '(root)', code: 'not_an_object' }],
    };
  }

  const rawName = input.event;
  if (
    typeof rawName !== 'string' ||
    !(OBSERVABILITY_EVENT_NAMES as readonly string[]).includes(rawName)
  ) {
    return {
      status: 'refused',
      eventName: null,
      event: null,
      violations: [{ field: 'event', code: 'unknown_event' }],
    };
  }
  const eventName = rawName as ObservabilityEventName;

  if (input.schemaVersion !== OBSERVABILITY_SCHEMA_VERSION) {
    return {
      status: 'refused',
      eventName,
      event: null,
      violations: [{ field: 'schemaVersion', code: 'unsupported_schema_version' }],
    };
  }

  const specs: Readonly<Record<string, ObservabilityEventSpec>> = OBSERVABILITY_EVENT_SPECS;
  const eventSpec = specs[eventName];
  // Unreachable while the schema is well formed — `assertSchemaIsWellFormed`
  // is what keeps it so. Present because indexing by a runtime string cannot
  // prove it to the compiler.
  if (eventSpec === undefined) {
    return {
      status: 'refused',
      eventName,
      event: null,
      violations: [{ field: 'event', code: 'unknown_event' }],
    };
  }

  const combined: Record<string, { type: ObservabilityFieldKind; required: boolean }> = {
    ...OBSERVABILITY_ENVELOPE_SPEC,
    ...eventSpec,
  };

  const violations: ObservabilityViolation[] = [];
  const kept: Record<string, unknown> = { event: eventName };
  const opaqueIdFields = new Set<string>();
  let droppedSomethingSensitive = false;

  for (const [field, value] of Object.entries(input)) {
    if (field === 'event') continue;
    // An absent optional field is idiomatically written as `undefined`, not as
    // a missing key. Treat the two the same rather than reporting a violation
    // for `radiusBucketKm: maybeRadius`.
    if (value === undefined) continue;

    const fieldSpec = combined[field];
    const dropCode: ObservabilityViolationCode | null =
      fieldSpec === undefined
        ? 'unknown_field'
        : isValidForKind(fieldSpec.type, value)
          ? null
          : 'invalid_value';

    if (dropCode !== null) {
      // A dropped value is still EXAMINED, and this is the rule worth stating
      // plainly, because the two halves pull in opposite directions.
      //
      // Dropping an unrecognised field rather than refusing the event is what
      // makes the pipeline forward-compatible: a newer client sending a field
      // an older server has not heard of must not lose its whole event.
      //
      // But that tolerance is for values that COULD have been legitimate. A
      // value that is ALREADY disqualified — a sentence, an email, a
      // fractional number — is not version skew, it is a defect, and letting
      // the rest of the event through would leave it counted rather than
      // noticed. So an innocuous unknown field is dropped and the event
      // proceeds; a sensitive one refuses the event outright.
      if (scanForSensitiveValues({ [field]: value }, new Set()).length > 0) {
        violations.push({ field, code: 'sensitive_value' });
        droppedSomethingSensitive = true;
      } else {
        violations.push({ field, code: dropCode });
      }
      continue;
    }

    if (fieldSpec !== undefined && fieldSpec.type.kind === 'opaqueId') opaqueIdFields.add(field);
    kept[field] = value;
  }

  const missing = Object.entries(combined)
    .filter(([field, fieldSpec]) => fieldSpec.required && !(field in kept))
    .map(([field]): ObservabilityViolation => ({ field, code: 'missing_required' }));

  const sensitive = scanForSensitiveValues(kept, opaqueIdFields);

  if (missing.length > 0 || sensitive.length > 0 || droppedSomethingSensitive) {
    return {
      status: 'refused',
      eventName,
      event: null,
      violations: [...violations, ...missing, ...sensitive],
    };
  }

  return {
    status: 'ok',
    eventName,
    // The shape has been checked field by field against the same spec the type
    // is derived from; there is no narrower expression of that in the type
    // system, because the input genuinely was `unknown`.
    event: kept as ObservabilityEvent,
    violations,
  };
}
