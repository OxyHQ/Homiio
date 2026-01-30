import { create } from 'zustand';
import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/core';

export interface Entitlements {
  plusActive: boolean;
  plusSince?: string;
  plusCanceledAt?: string;
  plusStripeSubscriptionId?: string;
  fileCredits: number;
  lastPaymentAt?: string;
  founderSupporter: boolean;
  founderSince?: string;
  processedSessions: string[];
}

interface SubscriptionState {
  // State
  entitlements: Entitlements | null;
  isLoading: boolean;
  error: string | null;
  loadingStates: {
    checkout: boolean;
    customerPortal: boolean;
    sync: boolean;
    cancel: boolean;
    reactivate: boolean;
  };

  // Actions
  fetchEntitlements: (oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  startCheckout: (product: 'plus' | 'file' | 'founder', oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  openCustomerPortal: (oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  syncSubscription: (oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  cancelSubscription: (immediate: boolean, oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  reactivateSubscription: (oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  resetError: () => void;
}

const defaultEntitlements: Entitlements = {
  plusActive: false,
  fileCredits: 0,
  founderSupporter: false,
  processedSessions: [],
};

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  // Initial state
  entitlements: null,
  isLoading: false,
  error: null,
  loadingStates: {
    checkout: false,
    customerPortal: false,
    sync: false,
    cancel: false,
    reactivate: false,
  },

  // Fetch entitlements
  fetchEntitlements: async (oxyServices: OxyServices, activeSessionId: string) => {
    try {
      set({ isLoading: true, error: null });
      
      const { data } = await api.get<{ success: boolean; entitlements: Entitlements }>(
        '/api/profiles/me/entitlements',
        { oxyServices, activeSessionId }
      );

      if (!data?.success) {
        throw new Error('Failed to load entitlements');
      }

      set({ 
        entitlements: data.entitlements || defaultEntitlements,
        isLoading: false 
      });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to load entitlements',
        isLoading: false 
      });
      throw error;
    }
  },

  // Start checkout
  startCheckout: async (product: 'plus' | 'file' | 'founder', oxyServices: OxyServices, activeSessionId: string) => {
    try {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, checkout: true },
        error: null 
      }));

      // Prevent redundant purchase if Plus is active
      const { entitlements } = get();
      if (product === 'plus' && entitlements?.plusActive) {
        throw new Error('You already have Homiio+ subscription');
      }
      if (product === 'file' && entitlements?.plusActive) {
        throw new Error('File uploads are included in your Homiio+ subscription');
      }

      const { data } = await api.post<{ success: boolean; url: string }>(
        '/api/billing/checkout',
        { product },
        { oxyServices, activeSessionId }
      );

      if (!data?.success) {
        throw new Error('Failed to create checkout session');
      }

      // Open checkout URL
      const { Linking } = require('react-native');
      await Linking.openURL(data.url);
    } catch (error: any) {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, checkout: false },
        error: error.message || 'Failed to start checkout'
      }));
      throw error;
    } finally {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, checkout: false }
      }));
    }
  },

  // Open customer portal
  openCustomerPortal: async (oxyServices: OxyServices, activeSessionId: string) => {
    try {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, customerPortal: true },
        error: null 
      }));

      const { entitlements } = get();
      if (!entitlements?.plusStripeSubscriptionId) {
        throw new Error('No subscription found to manage');
      }

      const { data } = await api.post<{ success: boolean; url: string; error?: { code: string; message: string } }>(
        '/api/billing/customer-portal',
        { subscriptionId: entitlements.plusStripeSubscriptionId },
        { oxyServices, activeSessionId }
      );

      if (!data?.success) {
        throw new Error(data?.error?.message || 'Failed to create customer portal session');
      }

      // Open customer portal URL
      const { Linking } = require('react-native');
      await Linking.openURL(data.url);
    } catch (error: any) {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, customerPortal: false },
        error: error.message || 'Failed to open customer portal'
      }));
      throw error;
    } finally {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, customerPortal: false }
      }));
    }
  },

  // Sync subscription from Stripe
  syncSubscription: async (oxyServices: OxyServices, activeSessionId: string) => {
    try {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, sync: true },
        error: null 
      }));

      const { data } = await api.post<{ success: boolean; entitlements: Entitlements }>(
        '/api/billing/sync-subscription',
        {},
        { oxyServices, activeSessionId }
      );

      if (!data?.success) {
        throw new Error('Failed to sync subscription');
      }

      set({ 
        entitlements: data.entitlements || defaultEntitlements,
        loadingStates: { ...get().loadingStates, sync: false }
      });
    } catch (error: any) {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, sync: false },
        error: error.message || 'Failed to sync subscription'
      }));
      throw error;
    }
  },

  // Cancel subscription
  cancelSubscription: async (immediate: boolean, oxyServices: OxyServices, activeSessionId: string) => {
    try {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, cancel: true },
        error: null 
      }));

      const { data } = await api.post<{ success: boolean; entitlements: Entitlements }>(
        '/api/billing/cancel-subscription',
        { immediate },
        { oxyServices, activeSessionId }
      );

      if (!data?.success) {
        throw new Error('Failed to cancel subscription');
      }

      set({ 
        entitlements: data.entitlements || defaultEntitlements,
        loadingStates: { ...get().loadingStates, cancel: false }
      });
    } catch (error: any) {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, cancel: false },
        error: error.message || 'Failed to cancel subscription'
      }));
      throw error;
    }
  },

  // Reactivate subscription
  reactivateSubscription: async (oxyServices: OxyServices, activeSessionId: string) => {
    try {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, reactivate: true },
        error: null 
      }));

      const { data } = await api.post<{ success: boolean; entitlements: Entitlements }>(
        '/api/billing/reactivate-subscription',
        {},
        { oxyServices, activeSessionId }
      );

      if (!data?.success) {
        throw new Error('Failed to reactivate subscription');
      }

      set({ 
        entitlements: data.entitlements || defaultEntitlements,
        loadingStates: { ...get().loadingStates, reactivate: false }
      });
    } catch (error: any) {
      set(state => ({ 
        loadingStates: { ...state.loadingStates, reactivate: false },
        error: error.message || 'Failed to reactivate subscription'
      }));
      throw error;
    }
  },

  // Reset error
  resetError: () => set({ error: null }),
}));
