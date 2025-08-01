import { create } from 'zustand';

// Create Property Form State Interface
interface CreatePropertyFormState {
  // Data
  formData: {
    basicInfo: {
      // title removed - will be auto-generated by backend
      description: string;
      propertyType: string;
      bedrooms: number;
      bathrooms: number;
      squareFootage: number;
      yearBuilt?: number;
    };
    location: {
      address: string;
      addressLine2?: string;
      addressNumber?: string;
      showAddressNumber?: boolean;
      floor?: number;
      showFloor?: boolean;
      city: string;
      state: string;
      zipCode: string;
      country: string;
      latitude: number;
      longitude: number;
      availableFrom?: string;
      leaseTerm?: string;
      walkScore?: number;
      transitScore?: number;
      bikeScore?: number;
      proximityToTransport?: boolean;
      proximityToSchools?: boolean;
      proximityToShopping?: boolean;
    };
    pricing: {
      monthlyRent: number;
      securityDeposit: number;
      applicationFee?: number;
      lateFee?: number;
      currency: string;
      utilities?: string[];
      includedUtilities?: string[];
    };
    amenities: {
      selectedAmenities: string[];
    };
    rules: {
      petsAllowed: boolean;
      smokingAllowed: boolean;
      partiesAllowed: boolean;
      guestsAllowed: boolean;
      maxGuests?: number;
    };
    media: {
      images: any[];
      videos?: any[];
    };
    colivingFeatures: {
      sharedSpaces: boolean;
      communityEvents: boolean;
      sharedSpacesList?: string[];
      otherFeatures?: string;
    };
  };
  currentStep: number;
  isDirty: boolean;
  
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setFormData: (section: keyof CreatePropertyFormState['formData'], data: any) => void;
  updateFormField: (section: keyof CreatePropertyFormState['formData'], field: string, value: any) => void;
  nextStep: () => void;
  prevStep: () => void;
  setCurrentStep: (step: number) => void;
  setIsDirty: (dirty: boolean) => void;
  resetForm: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useCreatePropertyFormStore = create<CreatePropertyFormState>()(
  (set, get) => ({
      // Initial state
      formData: {
        basicInfo: {
          // title removed - will be auto-generated by backend
          description: '',
          propertyType: '',
          bedrooms: 1,
          bathrooms: 1,
          squareFootage: 0,
          yearBuilt: undefined,
        },
        location: {
          address: '',
          addressLine2: undefined,
          addressNumber: undefined,
          showAddressNumber: undefined,
          floor: undefined,
          showFloor: undefined,
          city: '',
          state: '',
          zipCode: '',
          country: 'Spain',
          latitude: 40.7128, // Default to New York City
          longitude: -74.0060, // Default to New York City
          availableFrom: undefined,
          leaseTerm: undefined,
          walkScore: undefined,
          transitScore: undefined,
          bikeScore: undefined,
          proximityToTransport: undefined,
          proximityToSchools: undefined,
          proximityToShopping: undefined,
        },
        pricing: {
          monthlyRent: 0,
          securityDeposit: 0,
          applicationFee: 0,
          lateFee: 0,
          currency: 'USD',
          utilities: [],
          includedUtilities: [],
        },
        amenities: {
          selectedAmenities: [],
        },
        rules: {
          petsAllowed: false,
          smokingAllowed: false,
          partiesAllowed: false,
          guestsAllowed: false,
          maxGuests: undefined,
        },
        media: {
          images: [],
          videos: [],
        },
        colivingFeatures: {
          sharedSpaces: false,
          communityEvents: false,
          sharedSpacesList: [],
          otherFeatures: '',
        },
      },
      currentStep: 0,
      isDirty: false,
      isLoading: false,
      error: null,
      
      // Actions
      setFormData: (section, data) => set((state) => ({
        formData: {
          ...state.formData,
          [section]: { ...state.formData[section], ...data }
        },
        isDirty: true
      })),
      updateFormField: (section, field, value) => set((state) => ({
        formData: {
          ...state.formData,
          [section]: {
            ...state.formData[section],
            [field]: value
          }
        },
        isDirty: true
      })),
      nextStep: () => set((state) => ({
        currentStep: Math.min(state.currentStep + 1, 6) // 6 is the max step (0-indexed)
      })),
      prevStep: () => set((state) => ({
        currentStep: Math.max(state.currentStep - 1, 0) // 0 is the min step
      })),
      setCurrentStep: (step) => set({ currentStep: step }),
      setIsDirty: (dirty) => set({ isDirty: dirty }),
      resetForm: () => set((state) => ({
        formData: {
          basicInfo: {
            // title removed - will be auto-generated by backend
            description: '',
            propertyType: '',
            bedrooms: 1,
            bathrooms: 1,
            squareFootage: 0,
            yearBuilt: undefined,
          },
          location: {
            address: '',
            addressLine2: undefined,
            addressNumber: undefined,
            showAddressNumber: undefined,
            floor: undefined,
            showFloor: undefined,
            city: '',
            state: '',
            zipCode: '',
            country: 'Spain',
            latitude: 40.7128, // Default to New York City
            longitude: -74.0060, // Default to New York City
            availableFrom: undefined,
            leaseTerm: undefined,
          },
          pricing: {
            monthlyRent: 0,
            securityDeposit: 0,
            applicationFee: 0,
            lateFee: 0,
            currency: 'USD',
            utilities: [],
            includedUtilities: [],
          },
          amenities: {
            selectedAmenities: [],
          },
          rules: {
            petsAllowed: false,
            smokingAllowed: false,
            partiesAllowed: false,
            guestsAllowed: false,
            maxGuests: undefined,
          },
          media: {
            images: [],
            videos: [],
          },
          colivingFeatures: {
            sharedSpaces: false,
            communityEvents: false,
            sharedSpacesList: [],
            otherFeatures: '',
          },
        },
        currentStep: 0,
        isDirty: false,
        error: null,
      })),
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),
    }
  )
);

// Selector hooks for easier access
export const useCreatePropertyFormSelectors = () => {
  const formData = useCreatePropertyFormStore((state) => state.formData);
  const currentStep = useCreatePropertyFormStore((state) => state.currentStep);
  const isDirty = useCreatePropertyFormStore((state) => state.isDirty);
  const isLoading = useCreatePropertyFormStore((state) => state.isLoading);
  const error = useCreatePropertyFormStore((state) => state.error);

  return {
    formData,
    currentStep,
    isDirty,
    isLoading,
    error,
  };
};