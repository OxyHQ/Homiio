/**
 * What a saved collection contains.
 *
 * One rule, in one place, because two surfaces answer the question: the folder
 * screen (`app/(tabs)/saved/[folderId]`) and Sindi's inline answer to "show me
 * my saved homes" (#519 §8). A chat that listed a different set from the screen
 * it is offering to open would be worse than a chat that listed nothing.
 *
 * The filter is the whole of it — saves carry their own `folderId` and the API
 * returns every save in one payload, so a folder is a view rather than a fetch.
 */

import type { SavedProperty } from '@homiio/shared-types';

/**
 * The saves in one collection.
 *
 * A `folderId` of `undefined` means "everything", not "the unfiled ones": the
 * caller asking without a folder wants the whole list, which is what Sindi is
 * answering when somebody says "show my saved homes" with no collection named.
 */
export function propertiesInFolder(
  saved: readonly SavedProperty[],
  folderId: string | undefined,
): SavedProperty[] {
  if (!folderId) return [...saved];
  return saved.filter((property) => property.folderId === folderId);
}
