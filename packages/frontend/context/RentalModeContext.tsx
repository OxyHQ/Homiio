import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The two consumer-facing rental modes.
 *
 * `'both'` is a backend-only listing flag — it never appears in the UI as a
 * separate mode because the user always browses in either the long-term or
 * vacation experience. A `RentMode.BOTH` listing surfaces in whichever mode
 * the user is currently in.
 */
export type RentalMode = 'long_term' | 'vacation';

interface RentalModeContextValue {
  mode: RentalMode;
  setMode: (mode: RentalMode) => void;
  /** True until the persisted mode has been loaded from AsyncStorage. */
  hydrated: boolean;
}

const RentalModeContext = createContext<RentalModeContextValue | undefined>(undefined);

const STORAGE_KEY = '@homiio/rental-mode';
const DEFAULT_MODE: RentalMode = 'long_term';

const isRentalMode = (value: string | null): value is RentalMode =>
  value === 'long_term' || value === 'vacation';

interface RentalModeProviderProps {
  children: React.ReactNode;
}

export const RentalModeProvider: React.FC<RentalModeProviderProps> = ({ children }) => {
  const [mode, setModeState] = useState<RentalMode>(DEFAULT_MODE);
  const [hydrated, setHydrated] = useState(false);

  // AsyncStorage is an async I/O side effect — useEffect is the correct tool here.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (isRentalMode(stored)) {
          setModeState(stored);
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

  const setMode = useCallback((next: RentalMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Best-effort persistence — UI is already updated.
    });
  }, []);

  const value = useMemo<RentalModeContextValue>(
    () => ({ mode, setMode, hydrated }),
    [mode, setMode, hydrated],
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
