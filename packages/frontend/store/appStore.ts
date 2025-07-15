import { create } from 'zustand';
import React from 'react';

// Bottom Sheet State
interface BottomSheetState {
  isOpen: boolean;
  content: React.ReactNode | null;
}

// Profile State
interface ProfileState {
  primaryProfile: any | null;
  allProfiles: any[];
  isLoading: boolean;
  error: string | null;
  landlordProfile: any | null;
  landlordProfileLoading: boolean;
  landlordProfileError: string | null;
}

// Saved Properties State
interface SavedPropertiesState {
  properties: any[];
  isLoading: boolean;
  error: string | null;
  savingPropertyIds: string[];
}

// App State combines all features
interface AppState extends BottomSheetState, ProfileState, SavedPropertiesState {
  // Bottom Sheet Actions
  openBottomSheet: (isOpen: boolean) => void;
  setBottomSheetContent: (content: React.ReactNode | null) => void;
  
  // Profile Actions
  setPrimaryProfile: (profile: any | null) => void;
  setAllProfiles: (profiles: any[]) => void;
  setProfileLoading: (loading: boolean) => void;
  setProfileError: (error: string | null) => void;
  setLandlordProfile: (profile: any | null) => void;
  setLandlordProfileLoading: (loading: boolean) => void;
  setLandlordProfileError: (error: string | null) => void;
  
  // Saved Properties Actions
  setSavedProperties: (properties: any[]) => void;
  setSavedPropertiesLoading: (loading: boolean) => void;
  setSavedPropertiesError: (error: string | null) => void;
  addSavingPropertyId: (propertyId: string) => void;
  removeSavingPropertyId: (propertyId: string) => void;
}

export const useAppStore = create<AppState>()(
  (set, get) => ({
    // Initial state
    // Bottom Sheet
    isOpen: false,
    content: null,
    
    // Profile
    primaryProfile: null,
    allProfiles: [],
    isLoading: false,
    error: null,
    landlordProfile: null,
    landlordProfileLoading: false,
    landlordProfileError: null,
    
    // Saved Properties
    properties: [],
    savingPropertyIds: [],
    
    // Bottom Sheet Actions
    openBottomSheet: (isOpen) => set({ isOpen }),
    setBottomSheetContent: (content) => set({ content }),
    
    // Profile Actions
    setPrimaryProfile: (profile) => set({ primaryProfile: profile }),
    setAllProfiles: (profiles) => set({ allProfiles: profiles }),
    setProfileLoading: (loading) => set({ isLoading: loading }),
    setProfileError: (error) => set({ error }),
    setLandlordProfile: (profile) => set({ landlordProfile: profile }),
    setLandlordProfileLoading: (loading) => set({ landlordProfileLoading: loading }),
    setLandlordProfileError: (error) => set({ landlordProfileError: error }),
    
    // Saved Properties Actions
    setSavedProperties: (properties) => set({ properties }),
    setSavedPropertiesLoading: (loading) => set({ isLoading: loading }),
    setSavedPropertiesError: (error) => set({ error }),
    addSavingPropertyId: (propertyId) => set((state) => ({
      savingPropertyIds: [...state.savingPropertyIds, propertyId]
    })),
    removeSavingPropertyId: (propertyId) => set((state) => ({
      savingPropertyIds: state.savingPropertyIds.filter(id => id !== propertyId)
    })),
  })
); 