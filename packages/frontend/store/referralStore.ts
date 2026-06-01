import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Captured partner referral code.
 *
 * When a property owner lands on the create-property flow through a partner's
 * referral link (`…/properties/create?ref=<code>`), the `ref` query param is
 * captured here and persisted (AsyncStorage, mirroring `recentSearchesStore`).
 * The create-property submit reads it and sends `referralCode` so the backend
 * can attribute the listing to the sourcing partner — even if the owner closes
 * the app mid-flow and finishes later, the attribution survives.
 *
 * The code is cleared after a successful submit so a later, unreferred listing
 * isn't mis-attributed.
 */
interface ReferralState {
  /** The captured partner referral code, or null if none is active. */
  referralCode: string | null;
  /**
   * Record a referral code. No-ops on a blank/empty value so a missing `ref`
   * param never wipes a previously captured code.
   */
  setReferralCode: (code: string | null | undefined) => void;
  /** Clear the captured code (call after a listing that consumed it is created). */
  clearReferralCode: () => void;
}

export const useReferralStore = create<ReferralState>()(
  persist(
    (set) => ({
      referralCode: null,

      setReferralCode: (code) => {
        const trimmed = typeof code === 'string' ? code.trim() : '';
        if (!trimmed) return;
        set({ referralCode: trimmed });
      },

      clearReferralCode: () => set({ referralCode: null }),
    }),
    {
      name: '@homiio/referral-code',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ referralCode: state.referralCode }),
    },
  ),
);
