/** URL helpers are independent of schema runtimes so sharing a link stays lightweight. */
export const CASE_ID_MIN_LENGTH = 1;
export const CASE_ID_MAX_LENGTH = 200;

function validateCaseId(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < CASE_ID_MIN_LENGTH ||
    value.length > CASE_ID_MAX_LENGTH
  ) {
    throw new TypeError('Case ID must be a string between 1 and 200 characters');
  }
  return value;
}

export function getHomiioCaseUrl(id: string): string {
  return `https://homiio.com/evictions/${encodeURIComponent(validateCaseId(id))}`;
}

export function parseHomiioCaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://homiio.com' || url.username || url.password) return null;
    const match = /^\/evictions\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return null;
    return validateCaseId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function getMentionShareUrl(id: string): string {
  return `https://mention.earth/compose?homiioCaseId=${encodeURIComponent(validateCaseId(id))}`;
}
