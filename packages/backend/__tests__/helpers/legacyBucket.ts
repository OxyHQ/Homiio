/**
 * Put an object in the test bucket — what Homiio's bucket already holds from
 * before the move to Oxy Files. Production code cannot write to the bucket
 * (`LegacyObjectStore` has no write), so a test seeds the in-memory store the
 * suite installs (`HOMIIO_OBJECT_STORE=memory`) directly.
 */

import { legacyObjectStore, MemoryObjectStore } from '../../services/files/legacyObjectStore';

export async function seedLegacyObject(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const store = legacyObjectStore();
  if (!(store instanceof MemoryObjectStore)) {
    throw new Error('seedLegacyObject needs the in-memory store (HOMIIO_OBJECT_STORE=memory)');
  }
  await store.put(key, bytes, contentType);
}
