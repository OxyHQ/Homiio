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

/** Coerce EU-style numeric strings (e.g. "1.234,50 €") to a number. */
export function asNumberEu(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.,-]/g, '');
    if (!cleaned) return undefined;
    const normalized = cleaned.includes(',')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Alias used by most EU portal parsers. */
export const asNumber = asNumberEu;

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
