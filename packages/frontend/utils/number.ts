/**
 * Locale-tolerant numeric parsing for free-text inputs.
 *
 * On es/it/ca devices the numeric keyboard produces a comma as the decimal
 * separator, so a raw `parseFloat('1234,5')` stops at the comma and yields
 * `1234` (silently dropping the fractional part). Normalising the comma to a dot
 * before parsing makes `'1234,5'` parse as `1234.5` regardless of keyboard.
 *
 * Returns `NaN` for non-numeric input so callers can guard with
 * `Number.isNaN(...)` exactly like a bare `parseFloat`.
 */
export function parseLocaleNumber(value: string): number {
  return parseFloat(value.replace(',', '.'));
}
