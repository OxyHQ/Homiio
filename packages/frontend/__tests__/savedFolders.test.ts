/**
 * What a saved collection contains (#519 §8).
 *
 * One rule, two readers: the folder screen and Sindi's inline answer. A chat
 * that listed a different set from the screen it offers to open would be worse
 * than a chat that listed nothing — so the rule is a function, and this is it.
 */

import { propertiesInFolder } from '@/utils/savedFolders';
import type { SavedProperty } from '@homiio/shared-types';

const saved = (id: string, folderId?: string) =>
  ({ id, ...(folderId ? { folderId } : {}) }) as SavedProperty;

describe('the saves in one collection', () => {
  it('filters to the folder that was named', () => {
    const all = [saved('a', 'trips'), saved('b', 'maybe'), saved('c', 'trips')];
    expect(propertiesInFolder(all, 'trips').map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('returns EVERYTHING when no folder was named', () => {
    // "Show my saved homes" with no collection named is a question about the
    // whole list — not about the unfiled ones, which is the other reading and
    // would quietly drop most of somebody's saves.
    const all = [saved('a', 'trips'), saved('b')];
    expect(propertiesInFolder(all, undefined).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('matches nothing for a folder the viewer does not have', () => {
    // A `folderId` from the model filters what the viewer's own session already
    // returned; it never reaches for anything. An id naming somebody else's
    // collection is simply absent from this list (#519 §8.3).
    expect(propertiesInFolder([saved('a', 'mine')], 'somebody-elses')).toEqual([]);
  });

  it('does not put an unfiled save in a folder', () => {
    expect(propertiesInFolder([saved('a')], 'trips')).toEqual([]);
  });

  it('copies rather than returning the caller\'s array', () => {
    // The unfiltered path is the one that could hand back the context's own
    // array, and a caller sorting it in place would reorder every other
    // surface's list.
    const all = [saved('a')];
    expect(propertiesInFolder(all, undefined)).not.toBe(all);
  });
});
