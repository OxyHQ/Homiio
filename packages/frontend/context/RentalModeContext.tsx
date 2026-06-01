import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { OfferingType } from '@homiio/shared-types';

import {
  BROWSE_MODE_OFFERING,
  type BrowseMode,
} from '@/components/search/types';
import { useSearchQueryStore } from '@/store/searchQueryStore';

/**
 * The rental experience the user browses in.
 *
 * Only the two rent offerings have a per-unit price surface, so `RentalMode`
 * collapses the four browse modes to the rent axis the price/availability
 * surfaces care about: `vacation` for the short-term offering, `long_term` for
 * everything else (sale shows no per-unit suffix, exchange shows "Free", so the
 * rent unit never surfaces for them). Every price/availability surface
 * (PropertyCard, detail headline, booking widget) consumes this.
 */
export type RentalMode = 'long_term' | 'vacation';

/**
 * The unified top-level browse selection ({@link BrowseMode}) and its 1:1
 * mapping to an {@link OfferingType} ({@link BROWSE_MODE_OFFERING}) are defined
 * once in the pure `components/search/types` module (imported above) so the
 * search store, this context, the sidebar toggle, and the `SearchPanel` all
 * share one mapping without a React dependency.
 */

interface RentalModeContextValue {
  /**
   * Rent-only experience axis (`long_term` | `vacation`). Derived from the
   * active {@link offering}: the short-term offering maps to `vacation`, every
   * other offering to `long_term`. Every existing price/availability surface
   * keeps reading this exactly as before.
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
   * The {@link OfferingType} implied by {@link browseMode}. This is the single
   * axis the feed + price surfaces filter and reprice on, surfaced so non-search
   * consumers (home feed, PropertyCard) can scope to the active offering without
   * re-deriving the mapping.
   */
  offering: OfferingType;
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
          // Re-hydrate the active search query so a returning user lands on the
          // same offering they last browsed. `setOffering` is a plain Zustand
          // action (no React subscription), safe to call from this effect.
          useSearchQueryStore.getState().setOffering(BROWSE_MODE_OFFERING[stored]);
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
    // Route the selection into the SAME query the search already filters on.
    // `setOffering` clears the price range (it is denominated per-offering) and
    // the short-term-only fields when leaving the short-term offering, so a
    // stale date range / nightly band can't follow the user into another mode.
    useSearchQueryStore.getState().setOffering(BROWSE_MODE_OFFERING[next]);
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

  const offering = BROWSE_MODE_OFFERING[browseMode];

  const value = useMemo<RentalModeContextValue>(
    () => ({
      mode: offering === OfferingType.SHORT_TERM_RENT ? 'vacation' : 'long_term',
      setMode,
      browseMode,
      setBrowseMode,
      offering,
      hydrated,
    }),
    [offering, setMode, browseMode, setBrowseMode, hydrated],
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
