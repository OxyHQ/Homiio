import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { CreatePropertyData } from '@/services/propertyService';

interface CreatePropertyFormState {
  formData: CreatePropertyData & {
    priceUnit: 'day' | 'night' | 'week' | 'month' | 'year';
    housingType?: 'private' | 'public' | 'shared' | 'open' | 'partitioned';
    // Advanced property features
    floor?: number;
    yearBuilt?: number;
    furnishedStatus: 'furnished' | 'unfurnished' | 'partially_furnished';
    petPolicy: 'allowed' | 'not_allowed' | 'case_by_case';
    petFee?: number;
    parkingType: 'none' | 'street' | 'assigned' | 'garage';
    parkingSpaces: number;
    // Availability & rules
    availableFrom: string;
    leaseTerm: 'monthly' | '6_months' | '12_months' | 'flexible';
    smokingAllowed: boolean;
    partiesAllowed: boolean;
    guestsAllowed: boolean;
    maxGuests: number;
    // Location intelligence
    walkScore?: number;
    transitScore?: number;
    bikeScore?: number;
    proximityToTransport: boolean;
    proximityToSchools: boolean;
    proximityToShopping: boolean;
    // Images
    images: string[];
    coverImageIndex: number;
    // Draft functionality
    isDraft: boolean;
    lastSaved: Date;
    // Accommodation-specific details
    accommodationDetails?: {
      sleepingArrangement?: 'couch' | 'air_mattress' | 'floor' | 'tent' | 'hammock';
      roommatePreferences?: string[];
      colivingFeatures?: string[];
      hostelRoomType?: 'dormitory' | 'private_room' | 'mixed_dorm' | 'female_dorm' | 'male_dorm';
      campsiteType?: 'tent_site' | 'rv_site' | 'cabin' | 'glamping' | 'backcountry';
      maxStay?: number;
      minAge?: number;
      maxAge?: number;
      languages?: string[];
      culturalExchange?: boolean;
      mealsIncluded?: boolean;
      wifiPassword?: string;
      houseRules?: string[];
    };
    // Ethical pricing
    rent: {
      amount: number;
      currency?: string;
      paymentFrequency?: 'monthly' | 'weekly' | 'daily';
      deposit?: number;
      utilities?: 'excluded' | 'included' | 'partial';
      hasIncomeBasedPricing?: boolean;
      hasSlidingScale?: boolean;
      hasUtilitiesIncluded?: boolean;
      hasReducedDeposit?: boolean;
      localMedianIncome?: number;
      areaAverageRent?: number;
      ethicalPricingSuggestions?: {
        standardRent?: number;
        affordableRent?: number;
        marketRate?: number;
        reducedDeposit?: number;
      };
    };
  } | null;
  isVisible: boolean;
}

const initialState: CreatePropertyFormState = {
  formData: null,
  isVisible: false,
};

const createPropertyFormSlice = createSlice({
  name: 'createPropertyForm',
  initialState,
  reducers: {
    setFormData: (state, action: PayloadAction<CreatePropertyFormState['formData']>) => {
      state.formData = action.payload;
    },
    updateFormField: (state, action: PayloadAction<{ field: string; value: any }>) => {
      if (state.formData) {
        const { field, value } = action.payload;
        const fieldPath = field.split('.');
        let current: any = state.formData;
        
        for (let i = 0; i < fieldPath.length - 1; i++) {
          current = current[fieldPath[i]];
        }
        
        current[fieldPath[fieldPath.length - 1]] = value;
      }
    },
    setVisibility: (state, action: PayloadAction<boolean>) => {
      state.isVisible = action.payload;
    },
    clearFormData: (state) => {
      state.formData = null;
      state.isVisible = false;
    },
  },
});

export const { setFormData, updateFormField, setVisibility, clearFormData } = createPropertyFormSlice.actions;
export default createPropertyFormSlice.reducer; 