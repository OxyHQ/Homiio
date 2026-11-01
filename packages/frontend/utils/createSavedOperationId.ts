import { randomUUID } from 'expo-crypto';

/** Identify a queued operation without reusing an id after an app restart. */
export function createSavedOperationId(): string {
  return randomUUID();
}
