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
