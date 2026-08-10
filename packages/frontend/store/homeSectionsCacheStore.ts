/**
 * The last Home payload, kept on disk so an offline launch shows something
 * honest (#353).
 *
 * ## Why this exists at all, given React Query
 *
 * React Query's cache is in MEMORY. It survives a navigation and not a restart,
 * so on a cold launch with no connectivity there is nothing to show — and the
 * issue's offline state is explicit: "mostrar la última home cacheada con la
 * etiqueta de área y antigüedad. No presentarla como actualizada." A snapshot on
 * disk is the only thing that can satisfy the first half.
 *
 * ## It is keyed by scope, and that is the safety property
 *
 * The snapshot records the {@link locationKey} it was fetched for, and
 * {@link readHomeSnapshot} returns nothing when asked for a different one. The
 * failure it prevents is the one this whole issue is about: opening the app
 * offline in Madrid and being shown yesterday's Barcelona under a Madrid
 * heading. A cache that answered regardless of scope would do exactly that, and
 * it would look like a working app.
 *
 * `locationKey` is used rather than the raw selection because it has no
 * coordinate branch for a device fix — so an offline snapshot taken while
 * device-scoped is keyed `here:25000`, which is shared by everyone at that
 * radius and identifies nobody. That is deliberate: it means a device-scoped
 * snapshot can be served to a device-scoped launch from a DIFFERENT position, so
 * the surface must present it as cached, which it does.
 *
 * ## What is trimmed, and why
 *
 * A property carries its images, address, documents and availability windows, so
 * eight of them per section across eight sections is a payload measured in
 * hundreds of kilobytes — enough to matter for an AsyncStorage entry on Android.
 * The snapshot keeps {@link SNAPSHOT_ITEMS_PER_SECTION} items per section, which
 * fills the visible part of a carousel; the rest arrives with the live fetch.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HomeSection, Property } from '@homiio/shared-types';

const PERSIST_KEY = '@homiio/home-sections-snapshot-v1';

/** Items kept per section on disk. See the module header. */
export const SNAPSHOT_ITEMS_PER_SECTION = 4;

export interface HomeSnapshot {
  /** The {@link locationKey} this was fetched for. Never a coordinate. */
  readonly locationKey: string;
  readonly offering: string;
  /** The SERVER's timestamp, carried through verbatim. */
  readonly generatedAt: string;
  readonly sections: readonly HomeSection<Property>[];
}

interface HomeSectionsCacheState {
  snapshot: HomeSnapshot | null;
  /** Replace the snapshot. Exactly one is kept — the most recent scope. */
  save: (snapshot: HomeSnapshot) => void;
  clear: () => void;
}

export const useHomeSectionsCacheStore = create<HomeSectionsCacheState>()(
  persist(
    (set) => ({
      snapshot: null,
      save: (snapshot) =>
        set({
          snapshot: {
            ...snapshot,
            sections: snapshot.sections.map((section) => ({
              ...section,
              items: section.items.slice(0, SNAPSHOT_ITEMS_PER_SECTION),
            })),
          },
        }),
      clear: () => set({ snapshot: null }),
    }),
    { name: PERSIST_KEY, storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/**
 * The snapshot for a scope, or `null` when the stored one is for another.
 *
 * A pure function over an explicit snapshot rather than a store read, so the
 * scope check is testable on its own — it is the single assertion standing
 * between "cached data for here" and "another city's homes under this city's
 * name".
 */
export function readHomeSnapshot(
  snapshot: HomeSnapshot | null,
  locationKey: string,
  offering: string,
): HomeSnapshot | null {
  if (!snapshot) return null;
  if (snapshot.locationKey !== locationKey) return null;
  // The offering is part of the identity too: a "for sale" snapshot rendered
  // under the long-term tab is the same category of lie, one axis over.
  if (snapshot.offering !== offering) return null;
  return snapshot;
}
