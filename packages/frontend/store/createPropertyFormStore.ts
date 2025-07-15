import { create } from 'zustand';

// Create Property Form State Interface
interface CreatePropertyFormState {
  // Data
  formData: {
    basicInfo: {
      title: string;
      description: string;
      propertyType: string;
      bedrooms: number;
      bathrooms: number;
      squareFootage: number;
    };
    location: {
      address: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
      latitude: number;
      longitude: number;
    };
    pricing: {
      rent: number;
      deposit: number;
      utilities: string[];
      includedUtilities: string[];
    };
    amenities: {
      features: string[];
      parking: string;
      pets: boolean;
      furnished: boolean;
    };
    media: {
      images: File[];
      videos: File[];
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
          title: '',
          description: '',
          propertyType: '',
          bedrooms: 0,
          bathrooms: 0,
          squareFootage: 0,
        },
        location: {
          address: '',
          city: '',
          state: '',
          zipCode: '',
          country: '',
          latitude: 0,
          longitude: 0,
        },
        pricing: {
          rent: 0,
          deposit: 0,
          utilities: [],
          includedUtilities: [],
        },
        amenities: {
          features: [],
          parking: '',
          pets: false,
          furnished: false,
        },
        media: {
          images: [],
          videos: [],
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
      setCurrentStep: (step) => set({ currentStep: step }),
      setIsDirty: (dirty) => set({ isDirty: dirty }),
      resetForm: () => set((state) => ({
        formData: {
          basicInfo: {
            title: '',
            description: '',
            propertyType: '',
            bedrooms: 0,
            bathrooms: 0,
            squareFootage: 0,
          },
          location: {
            address: '',
            city: '',
            state: '',
            zipCode: '',
            country: '',
            latitude: 0,
            longitude: 0,
          },
          pricing: {
            rent: 0,
            deposit: 0,
            utilities: [],
            includedUtilities: [],
          },
          amenities: {
            features: [],
            parking: '',
            pets: false,
            furnished: false,
          },
          media: {
            images: [],
            videos: [],
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