import { create } from 'zustand';
import type { Property } from '@homiio/shared-types';

interface MapSearchState {
  // Accumulated, de-duplicated properties for the map session
  properties: Property[];
  lastUpdatedAt: number;

  // Merge new properties into the set (by _id), updating changed entries
  mergeProperties: (incoming: Property[]) => void;

  // Remove properties by id
  removeByIds: (ids: string[]) => void;

  // Clear all accumulated properties
  clear: () => void;
}

export const useMapSearchStore = create<MapSearchState>()((set, get) => ({
  properties: [],
  lastUpdatedAt: 0,

  mergeProperties: (incoming) =>
    set((state) => {
      if (!incoming || incoming.length === 0) return state;

      const byId = new Map<string, Property>();

      for (const p of state.properties) byId.set(p._id, p);

      let changed = false;
      for (const np of incoming) {
        const cur = byId.get(np._id);
        if (!cur) {
          byId.set(np._id, np);
          changed = true;
          continue;
        }

        // Check for meaningful diffs (price or coordinates change)
        const curAmt = cur.rent?.amount;
        const npAmt = np.rent?.amount;
        const curCoords = JSON.stringify(cur.address?.coordinates?.coordinates || cur.location?.coordinates);
        const npCoords = JSON.stringify(np.address?.coordinates?.coordinates || np.location?.coordinates);

        if (curAmt !== npAmt || curCoords !== npCoords) {
          byId.set(np._id, np);
          changed = true;
        }
      }

      if (!changed) return state;
      return { properties: Array.from(byId.values()), lastUpdatedAt: Date.now() };
    }),

  removeByIds: (ids) =>
    set((state) => {
      if (!ids || ids.length === 0) return state;
      const removeSet = new Set(ids);
      const filtered = state.properties.filter((p) => !removeSet.has(p._id));
      if (filtered.length === state.properties.length) return state;
      return { properties: filtered, lastUpdatedAt: Date.now() };
    }),

  clear: () => set({ properties: [], lastUpdatedAt: Date.now() }),
}));

