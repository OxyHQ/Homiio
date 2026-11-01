export * from './watch-core';

// ---------------------------------------------------------------------------
// The safety sweep
// ---------------------------------------------------------------------------

/**
 * Field names an alert payload must never carry, whatever their value.
 *
 * Lower-cased and matched as a SUBSTRING, so `propertyLatitude`, `geoPoint` and
 * `bbox_west` are all caught. A substring match over-reaches by design: the cost
 * of refusing a field that merely sounds spatial is that somebody renames it,
 * and the cost of the reverse is publishing where a person lives.
 */
const FORBIDDEN_ALERT_FIELD_FRAGMENTS: readonly string[] = [
  'latitude',
  'longitude',
  'coordinate',
  'geopoint',
  'geometry',
  'bbox',
  'bounds',
  'lat',
  'lng',
  'lon',
];

/**
 * A string that looks like a coordinate pair — `41.3851, 2.1734` and friends.
 *
 * Guards the case the key-name sweep cannot see: a coordinate pasted into a
 * listing TITLE, which is a legitimate free-text field carried by three
 * explanation variants and populated from portal data Homiio does not author.
 */
const COORDINATE_PAIR = /-?\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/;

/**
 * Every reason a payload is unfit to be published in a notification.
 *
 * Returns FIELD PATHS and never values — a violation is itself something that
 * gets logged, and "rejected: title=41.3851, 2.1734" logs exactly what the
 * rejection prevented. Same rule as `observability/redaction`.
 *
 * This is the SECOND layer. The first is {@link AlertExplanationDetail} being a
 * closed union with no coordinate-shaped field in any variant; this one runs over
 * the assembled object so that the next variant somebody adds is covered before
 * they have thought about it.
 */
export function findUnsafeAlertFields(payload: unknown): string[] {
  const violations: string[] = [];

  const walk = (value: unknown, path: string, depth: number): void => {
    // A payload nested deeper than this is not an explanation, and an unbounded
    // walk over a cyclic object would not return at all.
    if (depth > 8) {
      violations.push(`${path}: too deeply nested to verify`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const lowered = key.toLowerCase();
        const fragment = FORBIDDEN_ALERT_FIELD_FRAGMENTS.find((needle) => lowered.includes(needle));
        const childPath = path ? `${path}.${key}` : key;
        if (fragment !== undefined) {
          violations.push(`${childPath}: field name contains '${fragment}'`);
          continue;
        }
        walk(child, childPath, depth + 1);
      }
      return;
    }
    if (typeof value === 'string' && COORDINATE_PAIR.test(value)) {
      violations.push(`${path}: value looks like a coordinate pair`);
    }
  };

  walk(payload, '', 0);
  return violations;
}

