import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ListingIntent, RentMode } from '@homiio/shared-types';

import { BROWSE_MODE_MAP, type BrowseMode } from '@/components/search/types';
import { useSearchQueryStore } from '@/store/searchQueryStore';

/**
 * The rental experience the user browses in.
 *
 * `'both'` is a backend-only listing flag — it never appears in the UI as a
 * separate mode because the user always browses in either the long-term or
 * vacation experience. A `RentMode.BOTH` listing surfaces in whichever mode
 * the user is currently in. This type is the *rent-only* axis and is what every
 * price/availability surface (PropertyCard, detail headline, booking widget)
 * already consumes — it is intentionally left unchanged.
 */
export type RentalMode = 'long_term' | 'vacation';

/**
 * The unified top-level browse selection ({@link BrowseMode}) and its
 * decomposition into the two filter axes ({@link BROWSE_MODE_MAP}) are defined
 * once in the pure `components/search/types` module (imported above) so the
 * search store, this context, the sidebar toggle, and the `SearchPanel` all
 * share one mapping without a React dependency.
 */

interface RentalModeContextValue {
  /**
   * Rent-only experience axis (`long_term` | `vacation`). Derived from
   * {@link browseMode}: the buy/exchange browse modes keep `long_term`
   * semantics (sale shows no per-unit suffix; exchange shows "Free", so the
   * rent unit never surfaces for them). Every existing price/availability
   * surface keeps reading this exactly as before.
   */
  mode: RentalMode;
  /**
   * Set the rent experience. A thin wrapper over {@link setBrowseMode} that
   * maps `long_term`/`vacation` onto the matching browse mode, so the existing
   * call sites (SearchBar, SearchPanel) keep working unchanged.
   */
  setMode: (mode: RentalMode) => void;
  /** The unified top-level browse selection (rent sub-modes + buy + exchange). */
  browseMode: BrowseMode;
  /** Switch the top-level browse selection (also patches the active search query). */
  setBrowseMode: (browseMode: BrowseMode) => void;
  /**
   * The listing intent implied by {@link browseMode} (`sale` for buy,
   * `exchange` for exchange, `undefined` for the rent modes). Surfaced so
   * non-search consumers can scope feeds to the active intent without
   * re-deriving the mapping.
   */
  intent: ListingIntent | undefined;
  /** True until the persisted mode has been loaded from AsyncStorage. */
  hydrated: boolean;
}

const RentalModeContext = createContext<RentalModeContextValue | undefined>(undefined);

const STORAGE_KEY = '@homiio/browse-mode';
const DEFAULT_BROWSE_MODE: BrowseMode = 'long_term';

const isBrowseMode = (value: string | null): value is BrowseMode =>
  value === 'long_term' ||
  value === 'vacation' ||
  value === 'buy' ||
  value === 'exchange';

interface RentalModeProviderProps {
  children: React.ReactNode;
}

export const RentalModeProvider: React.FC<RentalModeProviderProps> = ({ children }) => {
  const [browseMode, setBrowseModeState] = useState<BrowseMode>(DEFAULT_BROWSE_MODE);
  const [hydrated, setHydrated] = useState(false);

  // AsyncStorage is an async I/O side effect — useEffect is the correct tool here.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (isBrowseMode(stored)) {
          setBrowseModeState(stored);
          const axes = BROWSE_MODE_MAP[stored];
          // Re-hydrate the active search query so a returning user lands on the
          // same intent/mode they last browsed. `patchQuery` is a plain Zustand
          // action (no React subscription), safe to call from this effect.
          useSearchQueryStore.getState().patchQuery({
            rentMode: axes.rentMode,
            intent: axes.intent,
          });
        }
      })
      .catch(() => {
        // Storage read failure is non-fatal — we fall back to the default.
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setBrowseMode = useCallback((next: BrowseMode) => {
    setBrowseModeState(next);
    const axes = BROWSE_MODE_MAP[next];
    // Route the selection into the SAME query the search already filters on.
    // Switching out of vacation clears the vacation-only fields (mirrors the
    // store's own `setRentMode`) so a stale date range can't follow the user
    // into a long-term/buy/exchange browse.
    useSearchQueryStore.getState().patchQuery({
      rentMode: axes.rentMode,
      intent: axes.intent,
      ...(axes.rentMode === RentMode.LONG_TERM
        ? { dates: undefined, guests: undefined }
        : {}),
    });
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Best-effort persistence — UI is already updated.
    });
  }, []);

  const setMode = useCallback(
    (next: RentalMode) => {
      setBrowseMode(next);
    },
    [setBrowseMode],
  );

  const axes = BROWSE_MODE_MAP[browseMode];

  const value = useMemo<RentalModeContextValue>(
    () => ({
      mode: axes.rentMode === RentMode.VACATION ? 'vacation' : 'long_term',
      setMode,
      browseMode,
      setBrowseMode,
      intent: axes.intent,
      hydrated,
    }),
    [axes.rentMode, axes.intent, setMode, browseMode, setBrowseMode, hydrated],
  );

  return <RentalModeContext.Provider value={value}>{children}</RentalModeContext.Provider>;
};

export const useRentalMode = (): RentalModeContextValue => {
  const ctx = useContext(RentalModeContext);
  if (!ctx) {
    throw new Error('useRentalMode must be used within a RentalModeProvider');
  }
  return ctx;
};
