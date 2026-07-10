/**
 * Shared type guards for HTML/JSON portal parsers (DOM-free).
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Coerce EU-style numeric strings (e.g. "1.234,50 €" or "1.250") to a number. */
export function asNumberEu(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.,-]/g, '');
    if (!cleaned) return undefined;
    // German: dots are thousands separators when a comma decimal is present,
    // OR when the pattern is groups of three (`1.250`, `12.500.000`).
    let normalized: string;
    if (cleaned.includes(',')) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
      normalized = cleaned.replace(/\./g, '');
    } else {
      normalized = cleaned;
    }
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Alias used by most EU portal parsers. */
export const asNumber = asNumberEu;

/**
 * Parse a geographic latitude/longitude value. Unlike {@link asNumberEu}, never
 * treats dot-separated digit groups as thousands separators — "43.541" must stay
 * 43.541 (Barreiros), not 43541.
 */
export function asCoordinate(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[^0-9.,+-]/g, '');
    if (!cleaned) return undefined;
    const normalized = cleaned.includes(',') && !cleaned.includes('.')
      ? cleaned.replace(',', '.')
      : cleaned;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Coerce US-style numeric strings (e.g. "1,234 sqft") to a number. */
export function asNumberUs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.]/g, '');
    if (cleaned.length === 0) return undefined;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function deaccent(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) return value;
  }
  return undefined;
}

/** Parse euro-formatted amounts (`1.250 €`, `1.659,50 €`). */
export function parseEuroAmount(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return undefined;
  const match = raw.replace(/\u00a0/g, ' ').match(/([\d.]+(?:,\d+)?)/);
  if (!match?.[1]) return asNumberEu(raw);
  return asNumberEu(match[1]);
}
