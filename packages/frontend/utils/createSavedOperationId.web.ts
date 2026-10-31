/** Identify a queued operation without reusing an id after an app restart. */
export function createSavedOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Secure operation identifiers are unavailable');
  }
  return globalThis.crypto.randomUUID();
}
