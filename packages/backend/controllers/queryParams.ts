export function getQueryString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry): entry is string => typeof entry === 'string');
    return first ?? fallback;
  }

  return fallback;
}

export function getQueryNumber(value: unknown, fallback: number): number {
  const rawValue = getQueryString(value);
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getQueryInteger(value: unknown, fallback: number): number {
  const parsed = Math.trunc(getQueryNumber(value, fallback));
  return parsed > 0 ? parsed : fallback;
}

/**
 * A list param, in every spelling a client sends one: comma-joined
 * (`amenities=wifi,parking` — what the Oxy linked client makes of an array), a
 * repeated key (`amenities=wifi&amenities=parking`) or `amenities[]=`. Trimmed,
 * empty entries dropped, duplicates removed.
 *
 * `getQueryString` is the wrong tool for a list: on a repeated key it keeps the
 * FIRST value and drops the rest, which is how a multi-select filter ends up
 * filtering by one of its selections.
 */
export function getQueryList(value: unknown): string[] {
  const collect = (raw: string): string[] => raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap((entry) => (typeof entry === 'string' ? collect(entry) : []))));
  }
  if (typeof value === 'string') return Array.from(new Set(collect(value)));
  return [];
}

/**
 * The amenities a listing must ALL carry — the one reading of `amenities` for
 * every catalogue feed (search, list, proximity, rooms), lower-cased to the
 * canonical slugs listings are stored with.
 */
export function getAmenitiesParam(value: unknown): string[] {
  return getQueryList(value).map((amenity) => amenity.toLowerCase());
}
