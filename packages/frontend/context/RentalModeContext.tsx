import type React from 'react';
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { OfferingType } from '@homiio/shared-types';

import { BROWSE_MODE_OFFERING, type BrowseMode } from '@/components/search/types';
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
type RentalMode = 'long_term' | 'vacation';

/**
 * The unified top-level browse selection ({@link BrowseMode}) and its 1:1
 * mapping to an {@link OfferingType} ({@link BROWSE_MODE_OFFERING}) are defined
 * once in the pure `components/search/types` module (imported above) so the
 * search store, this context, the sidebar toggle, and the `HomeSearch` composer all
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
   * call sites (SearchBar, HomeSearch) keep working unchanged.
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
}

const RentalModeContext = createContext<RentalModeContextValue | undefined>(undefined);

const STORAGE_KEY = '@homiio/browse-mode';
const DEFAULT_BROWSE_MODE: BrowseMode = 'long_term';

const isBrowseMode = (value: string | null): value is BrowseMode =>
  value === 'long_term' || value === 'vacation' || value === 'buy' || value === 'exchange';

/**
 * The persisted browse mode, held at module scope as a tiny external store
 * (read through `useSyncExternalStore`) and hydrated ONCE when this module
 * loads, not from a component effect.
 *
 * On web AsyncStorage is a thin wrapper over `window.localStorage` (same key,
 * raw value), so the stored mode is read synchronously and the first render
 * already shows it. On native AsyncStorage is async: the read starts at module
 * load and lands in the store when it resolves, unless the user has already
 * picked a mode by then (their choice wins over the stale stored one).
 */
let browseModeSnapshot: BrowseMode = DEFAULT_BROWSE_MODE;
let userHasChosen = false;
const listeners = new Set<() => void>();

function applyBrowseMode(next: BrowseMode) {
  browseModeSnapshot = next;
  // Route the selection into the SAME query the search already filters on.
  // `setOffering` clears the price range (it is denominated per-offering) and
  // the short-term-only fields when leaving the short-term offering, so a
  // stale date range / nightly band can't follow the user into another mode.
  useSearchQueryStore.getState().setOffering(BROWSE_MODE_OFFERING[next]);
  for (const listener of listeners) listener();
}

function hydrateFromStorage(stored: string | null) {
  // Re-hydrate the active search query too, so a returning user lands on the
  // same offering they last browsed.
  if (!userHasChosen && isBrowseMode(stored)) applyBrowseMode(stored);
}

if (Platform.OS === 'web') {
  try {
    hydrateFromStorage(
      typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY),
    );
  } catch {
    // Storage blocked (private mode / disabled) — fall back to the default.
  }
} else {
  AsyncStorage.getItem(STORAGE_KEY)
    .then(hydrateFromStorage)
    .catch(() => {
      // Storage read failure is non-fatal — we fall back to the default.
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => browseModeSnapshot;

function setBrowseMode(next: BrowseMode) {
  userHasChosen = true;
  applyBrowseMode(next);
  AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
    // Best-effort persistence — UI is already updated.
  });
}

/** `long_term`/`vacation` are browse modes too, so this is `setBrowseMode`. */
const setMode: (mode: RentalMode) => void = setBrowseMode;

interface RentalModeProviderProps {
  children: React.ReactNode;
}

export const RentalModeProvider: React.FC<RentalModeProviderProps> = ({ children }) => {
  const browseMode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const offering = BROWSE_MODE_OFFERING[browseMode];

  const value = useMemo<RentalModeContextValue>(
    () => ({
      mode: offering === OfferingType.SHORT_TERM_RENT ? 'vacation' : 'long_term',
      setMode,
      browseMode,
      setBrowseMode,
      offering,
    }),
    [offering, browseMode],
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
