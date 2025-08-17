import React, { useState, useRef } from 'react';
import { Modal } from 'react-native';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { AmenitiesSelector } from '@/components/AmenitiesSelector';
import Map from '@/components/Map';
import { PropertyPreviewWidget } from '@/components/widgets/PropertyPreviewWidget';
import {
  useCreatePropertyFormStore,
  useCreatePropertyFormSelectors,
} from '@/store/createPropertyFormStore';
import { useCreateProperty, useUpdateProperty, useProperty } from '@/hooks/usePropertyQueries';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SearchablePickerBottomSheet } from '@/components/SearchablePickerBottomSheet';

import * as Location from 'expo-location';
const IconComponent = Ionicons as any;

// Define the property types
const PROPERTY_TYPES = [
  { id: 'apartment', label: 'Apartment' },
  { id: 'house', label: 'House' },
  { id: 'room', label: 'Room' },
  { id: 'studio', label: 'Studio' },
  { id: 'coliving', label: 'Co-living' },
  { id: 'other', label: 'Other' },
];

// Step flows for each property type
const STEP_FLOWS: Record<string, string[]> = {
  apartment: ['Basic Info', 'Location', 'Pricing', 'Amenities', 'Media', 'Preview'],
  house: ['Basic Info', 'Location', 'Pricing', 'Amenities', 'Media', 'Preview'],
  room: ['Basic Info', 'Location', 'Pricing', 'Amenities', 'Media', 'Preview'],
  studio: ['Basic Info', 'Location', 'Pricing', 'Amenities', 'Media', 'Preview'],
  coliving: [
    'Basic Info',
    'Location',
    'Pricing',
    'Amenities',
    'Coliving Features',
    'Media',
    'Preview',
  ],
  other: ['Basic Info', 'Location', 'Pricing', 'Media', 'Preview'],
};

// Field configuration for each property type and step
// Carefully tailored to real-world property listing needs
const FIELD_CONFIG: Record<string, Record<string, string[]>> = {
  apartment: {
    // Apartment: all main fields
    'Basic Info': [
      'propertyType',
      'bedrooms',
      'bathrooms',
      'squareFootage',
      'floor',
      'yearBuilt',
      'description',
    ],
    Location: [
      'address',
      'city',
      'state',
      'zipCode',
      'country',
      'latitude',
      'longitude',
      'availableFrom',
      'leaseTerm',
    ],
    Pricing: ['monthlyRent', 'currency', 'securityDeposit', 'applicationFee', 'lateFee'],
    Amenities: [
      'amenities',
      'petsAllowed',
      'smokingAllowed',
      'partiesAllowed',
      'guestsAllowed',
      'maxGuests',
    ],
    Media: ['images'],
    Preview: [],
  },
  house: {
    // House: same as apartment
    'Basic Info': [
      'propertyType',
      'bedrooms',
      'bathrooms',
      'squareFootage',
      'floor',
      'yearBuilt',
      'description',
    ],
    Location: [
      'address',
      'city',
      'state',
      'zipCode',
      'country',
      'latitude',
      'longitude',
      'availableFrom',
      'leaseTerm',
    ],
    Pricing: ['monthlyRent', 'currency', 'securityDeposit', 'applicationFee', 'lateFee'],
    Amenities: [
      'amenities',
      'petsAllowed',
      'smokingAllowed',
      'partiesAllowed',
      'guestsAllowed',
      'maxGuests',
    ],
    Media: ['images'],
    Preview: [],
  },
  studio: {
    // Studio: no bedrooms
    'Basic Info': [
      'propertyType',
      'bathrooms',
      'squareFootage',
      'floor',
      'yearBuilt',
      'description',
    ],
    Location: ['address', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude'],
    Pricing: ['monthlyRent', 'currency', 'securityDeposit'],
    Amenities: ['amenities'],
    Media: ['images'],
    Preview: [],
  },
  room: {
    // Room: no bedrooms, but has bathrooms, squareFootage, floor, yearBuilt
    'Basic Info': [
      'propertyType',
      'bathrooms',
      'squareFootage',
      'floor',
      'yearBuilt',
      'description',
    ],
    Location: ['address', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude'],
    Pricing: ['monthlyRent', 'currency', 'securityDeposit'],
    Amenities: ['amenities'],
    Media: ['images'],
    Preview: [],
  },
  coliving: {
    // Coliving: no bedrooms, optional bathrooms, coliving features
    'Basic Info': ['propertyType', 'bathrooms', 'squareFootage', 'yearBuilt', 'description'],
    Location: ['address', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude'],
    Pricing: ['monthlyRent', 'currency', 'securityDeposit'],
    Amenities: ['amenities'],
    'Coliving Features': ['sharedSpaces', 'communityEvents'],
    Media: ['images'],
    Preview: [],
  },
  other: {
    // Other: minimal fields
    'Basic Info': [
      'propertyType',
      'bathrooms',
      'squareFootage',
      'floor',
      'yearBuilt',
      'description',
    ],
    Location: ['address', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude'],
    Pricing: ['monthlyRent', 'currency', 'securityDeposit'],
    Media: ['images'],
    Preview: [],
  },
};



export default function CreatePropertyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const isEditMode = !!id;

  const { create, loading, error } = useCreateProperty();
  const { update, loading: updateLoading, error: updateError } = useUpdateProperty();
  const {
    property,
    loading: propertyLoading,
    error: propertyError,
    loadProperty,
  } = useProperty(id as string);

  // Get form state and actions from Zustand store
  const {
    setFormData,
    updateFormField,
    nextStep,
    prevStep,
    setLoading,
    setError,
    setCurrentStep,
    resetForm,
  } = useCreatePropertyFormStore();

  const { formData, currentStep, isDirty, isLoading } = useCreatePropertyFormSelectors();

  // Dynamic steps state
  const [steps, setSteps] = useState<string[]>(STEP_FLOWS['apartment']);

  // Track previous propertyType to reset step if changed
  const prevPropertyTypeRef = React.useRef<string | undefined>(formData.basicInfo.propertyType);

  // Load property data if in edit mode
  React.useEffect(() => {
    if (isEditMode && id) {
      loadProperty();
    }
  }, [isEditMode, id, loadProperty]);

  // Populate form data when property is loaded in edit mode
  React.useEffect(() => {
    if (isEditMode && property) {
      setFormData('basicInfo', {
        propertyType: property.type || 'apartment',
        bedrooms: property.bedrooms || 1,
        bathrooms: property.bathrooms || 1,
        squareFootage: property.squareFootage || 0,
        floor: property.floor,
        yearBuilt: property.yearBuilt,
        description: property.description || '',
      });

      setFormData('location', {
        address: property.address?.street || '',
        addressLine2: '',
        addressNumber: '',
        showAddressNumber: false,
        floor: property.floor,
        showFloor: !!property.floor,
        city: property.address?.city || '',
        state: property.address?.state || '',
        zipCode: property.address?.zipCode || '',
        country: property.address?.country || 'Spain',
        latitude: property.location?.coordinates?.[1] || 40.7128,
        longitude: property.location?.coordinates?.[0] || -74.006,
        availableFrom: '',
        leaseTerm: '',
      });

      setFormData('pricing', {
        monthlyRent: property.rent?.amount || 0,
        currency: property.rent?.currency || 'USD',
        securityDeposit: 0,
        applicationFee: 0,
        lateFee: 0,
      });

      setFormData('amenities', {
        selectedAmenities: property.amenities || [],
        petsAllowed: property.petFriendly || false,
        smokingAllowed: false,
        partiesAllowed: false,
        guestsAllowed: false,
        maxGuests: undefined,
      });

      setFormData('media', {
        images: property.images || [],
      });

      setFormData('colivingFeatures', {
        sharedSpaces: false,
        communityEvents: false,
        sharedSpacesList: [],
        otherFeatures: '',
      });
    }
  }, [isEditMode, property, setFormData]);

  // Get user's current location on component mount
  React.useEffect(() => {
    const getUserLocation = async () => {
      try {
        // Request location permissions
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.log('Location permission denied');
          return;
        }

        // Get current position
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        console.log('User location obtained:', {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });

        // Update form with user's location
        setFormData('location', {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
      } catch (error) {
        console.error('Error getting user location:', error);
      }
    };

    // Only get location if we're on the location step and don't have coordinates set
    if (
      currentStep === 1 &&
      (!formData.location.latitude ||
        !formData.location.longitude ||
        (formData.location.latitude === 40.7128 && formData.location.longitude === -74.006))
    ) {
      getUserLocation();
    }
  }, [currentStep, formData.location.latitude, formData.location.longitude, setFormData]);

  React.useEffect(() => {
    const type = formData.basicInfo.propertyType || 'apartment';
    setSteps(STEP_FLOWS[type] || STEP_FLOWS['other']);
    // Reset to first step if property type changes after first step
    if (
      prevPropertyTypeRef.current &&
      prevPropertyTypeRef.current !== type &&
      currentStep > 0 &&
      typeof setCurrentStep === 'function'
    ) {
      setCurrentStep(0);
    }
    prevPropertyTypeRef.current = type;
  }, [formData.basicInfo.propertyType, setCurrentStep, currentStep]);

  // Local state for form validation
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  const mapRef = useRef<any>(null);
  const fullscreenMapRef = useRef<any>(null);

  // Memoize the address selection callback to prevent unnecessary re-renders
  const handleAddressSelect = React.useCallback((address: any, coordinates: [number, number]) => {
    // Update form with coordinates
    updateFormField('location', 'latitude', coordinates[1]);
    updateFormField('location', 'longitude', coordinates[0]);

    // Auto-fill address fields
    if (address.street) {
      updateFormField('location', 'address', address.street);
    }
    if (address.houseNumber) {
      updateFormField('location', 'addressNumber', address.houseNumber);
    }
    if (address.city) {
      updateFormField('location', 'city', address.city);
    }
    if (address.state) {
      updateFormField('location', 'state', address.state);
    }
    if (address.country) {
      updateFormField('location', 'country', address.country);
    }
    if (address.postalCode) {
      updateFormField('location', 'zipCode', address.postalCode);
    }

    // Move map to selected location
    if (mapRef.current) {
      mapRef.current.navigateToLocation(coordinates, 15);
    }
  }, [updateFormField]);

  // Memoize the fullscreen address selection callback
  const handleFullscreenAddressSelect = React.useCallback((address: any, coordinates: [number, number]) => {
    // Update form with coordinates
    updateFormField('location', 'latitude', coordinates[1]);
    updateFormField('location', 'longitude', coordinates[0]);

    // Auto-fill address fields
    if (address.street) {
      updateFormField('location', 'address', address.street);
    }
    if (address.houseNumber) {
      updateFormField('location', 'addressNumber', address.houseNumber);
    }
    if (address.city) {
      updateFormField('location', 'city', address.city);
    }
    if (address.state) {
      updateFormField('location', 'state', address.state);
    }
    if (address.country) {
      updateFormField('location', 'country', address.country);
    }
    if (address.postalCode) {
      updateFormField('location', 'zipCode', address.postalCode);
    }

    // Move main map to selected location
    if (mapRef.current) {
      mapRef.current.navigateToLocation(coordinates, 15);
    }

    // Close modal after selection
    setShowFullscreenMap(false);
  }, [updateFormField]);

  // Handle form submission
  const handleSubmit = async () => {
    try {
      setLoading(true);
      // Transform formData to match API requirements
      const propertyData: any = {
        address: {
          street: formData.location.address,
          city: formData.location.city,
          state: formData.location.state,
          zipCode: formData.location.zipCode,
          country: formData.location.country || 'US',
          showAddressNumber: formData.location.showAddressNumber ?? true,
        },
        type: formData.basicInfo.propertyType as
          | 'apartment'
          | 'house'
          | 'room'
          | 'studio'
          | 'coliving'
          | 'other',
        description: formData.basicInfo.description,
        bedrooms: formData.basicInfo.bedrooms
          ? parseInt(formData.basicInfo.bedrooms.toString())
          : undefined,
        bathrooms: formData.basicInfo.bathrooms
          ? parseFloat(formData.basicInfo.bathrooms.toString())
          : undefined,
        squareFootage: formData.basicInfo.squareFootage
          ? parseInt(formData.basicInfo.squareFootage.toString())
          : undefined,
        floor: formData.location.floor ? parseInt(formData.location.floor.toString()) : undefined,
        yearBuilt: formData.basicInfo.yearBuilt
          ? parseInt(formData.basicInfo.yearBuilt.toString())
          : undefined,
        rent: {
          amount: formData.pricing.monthlyRent
            ? parseFloat(formData.pricing.monthlyRent.toString())
            : 0,
          currency: formData.pricing.currency || 'USD',
          paymentFrequency: 'monthly' as 'monthly',
          deposit: formData.pricing.securityDeposit
            ? parseFloat(formData.pricing.securityDeposit.toString())
            : 0,
          utilities:
            typeof formData.pricing.utilities === 'string' &&
              ['included', 'excluded', 'partial'].includes(formData.pricing.utilities)
              ? (formData.pricing.utilities as 'included' | 'excluded' | 'partial')
              : 'excluded',
        },
        amenities: formData.amenities.selectedAmenities || [],
        images: formData.media.images || [],
        location:
          formData.location.latitude && formData.location.longitude
            ? {
              type: 'Point',
              coordinates: [formData.location.longitude, formData.location.latitude], // [longitude, latitude]
            }
            : undefined,
      };
      if (formData.basicInfo.propertyType === 'coliving') {
        propertyData.colivingFeatures = formData.colivingFeatures;
      }
      if (isEditMode && id) {
        // Update existing property
        const result = await update(id as string, propertyData);
        if (result && typeof result === 'object') {
          console.log('Property update result:', JSON.stringify(result));
          router.push(`/properties/${id}`);
        } else {
          setError('Updated property but received unexpected response format');
        }
      } else {
        // Create new property
        const result = await create(propertyData);
        if (result && typeof result === 'object') {
          console.log('Property creation result:', JSON.stringify(result));
          if (result._id) {
            router.push(`/properties/${result._id}`);
          } else {
            setError('Created property but received unexpected response format');
          }
        } else {
          setError(`Unexpected response format: ${JSON.stringify(result)}`);
        }
      }
    } catch (err: any) {
      setError(
        err.message || (isEditMode ? 'Failed to update property' : 'Failed to create property'),
      );
    } finally {
      setLoading(false);
    }
  };

  // Helper to get fields for current type/step
  const currentType = formData.basicInfo.propertyType || 'apartment';
  const stepName = steps[currentStep];
  const fieldsToShow = FIELD_CONFIG[currentType]?.[stepName] || [];

  // Adjust validation logic to only require visible fields
  const validateCurrentStep = () => {
    const errors: Record<string, string> = {};
    if (stepName === 'Basic Info') {
      if (fieldsToShow.includes('propertyType') && !formData.basicInfo.propertyType)
        errors.propertyType = 'Property type is required';
      if (
        fieldsToShow.includes('bedrooms') &&
        (formData.basicInfo.bedrooms === undefined ||
          formData.basicInfo.bedrooms === null ||
          Number.isNaN(formData.basicInfo.bedrooms))
      )
        errors.bedrooms = 'Number of bedrooms is required';
      if (
        fieldsToShow.includes('bathrooms') &&
        (formData.basicInfo.bathrooms === undefined ||
          formData.basicInfo.bathrooms === null ||
          Number.isNaN(formData.basicInfo.bathrooms))
      )
        errors.bathrooms = 'Number of bathrooms is required';
      if (fieldsToShow.includes('squareFootage') && !formData.basicInfo.squareFootage)
        errors.squareFootage = 'Square footage is required';

      // Additional validation for different property types
      if (formData.basicInfo.propertyType === 'apartment') {
        if (
          fieldsToShow.includes('bedrooms') &&
          (formData.basicInfo.bedrooms === undefined ||
            formData.basicInfo.bedrooms === null ||
            formData.basicInfo.bedrooms < 1)
        ) {
          errors.bedrooms = 'Apartments must have at least 1 bedroom';
        }
        if (
          fieldsToShow.includes('bathrooms') &&
          (formData.basicInfo.bathrooms === undefined ||
            formData.basicInfo.bathrooms === null ||
            formData.basicInfo.bathrooms < 1)
        ) {
          errors.bathrooms = 'Apartments must have at least 1 bathroom';
        }
      } else if (formData.basicInfo.propertyType === 'house') {
        if (
          fieldsToShow.includes('bedrooms') &&
          (formData.basicInfo.bedrooms === undefined ||
            formData.basicInfo.bedrooms === null ||
            formData.basicInfo.bedrooms < 0)
        ) {
          errors.bedrooms = 'Houses can have 0 or more bedrooms';
        }
        if (
          fieldsToShow.includes('bathrooms') &&
          (formData.basicInfo.bathrooms === undefined ||
            formData.basicInfo.bathrooms === null ||
            formData.basicInfo.bathrooms < 1)
        ) {
          errors.bathrooms = 'Houses must have at least 1 bathroom';
        }
      } else if (formData.basicInfo.propertyType === 'studio') {
        if (
          fieldsToShow.includes('bedrooms') &&
          (formData.basicInfo.bedrooms === undefined ||
            formData.basicInfo.bedrooms === null ||
            formData.basicInfo.bedrooms < 0)
        ) {
          errors.bedrooms = 'Studios can have 0 or more bedrooms';
        }
        if (
          fieldsToShow.includes('bathrooms') &&
          (formData.basicInfo.bathrooms === undefined ||
            formData.basicInfo.bathrooms === null ||
            formData.basicInfo.bathrooms < 1)
        ) {
          errors.bathrooms = 'Studios must have at least 1 bathroom';
        }
      } else if (formData.basicInfo.propertyType === 'room') {
        if (
          fieldsToShow.includes('bedrooms') &&
          (formData.basicInfo.bedrooms === undefined ||
            formData.basicInfo.bedrooms === null ||
            formData.basicInfo.bedrooms < 1)
        ) {
          errors.bedrooms = 'Rooms must have at least 1 bedroom';
        }
        if (
          fieldsToShow.includes('bathrooms') &&
          (formData.basicInfo.bathrooms === undefined ||
            formData.basicInfo.bathrooms === null ||
            formData.basicInfo.bathrooms < 0)
        ) {
          errors.bathrooms = 'Rooms can have 0 or more bathrooms (shared or private)';
        }
      } else if (
        formData.basicInfo.propertyType === 'duplex' ||
        formData.basicInfo.propertyType === 'penthouse'
      ) {
        if (
          fieldsToShow.includes('bedrooms') &&
          (formData.basicInfo.bedrooms === undefined ||
            formData.basicInfo.bedrooms === null ||
            formData.basicInfo.bedrooms < 1)
        ) {
          errors.bedrooms = `${formData.basicInfo.propertyType.charAt(0).toUpperCase() + formData.basicInfo.propertyType.slice(1)}s must have at least 1 bedroom`;
        }
        if (
          fieldsToShow.includes('bathrooms') &&
          (formData.basicInfo.bathrooms === undefined ||
            formData.basicInfo.bathrooms === null ||
            formData.basicInfo.bathrooms < 1)
        ) {
          errors.bathrooms = `${formData.basicInfo.propertyType.charAt(0).toUpperCase() + formData.basicInfo.propertyType.slice(1)}s must have at least 1 bathroom`;
        }
      }
    } else if (stepName === 'Location') {
      if (fieldsToShow.includes('address') && !formData.location.address)
        errors.address = 'Address is required';
      if (fieldsToShow.includes('city') && !formData.location.city)
        errors.city = 'City is required';
      if (fieldsToShow.includes('state') && !formData.location.state)
        errors.state = 'State is required';
      if (fieldsToShow.includes('zipCode') && !formData.location.zipCode)
        errors.zipCode = 'ZIP code is required';
      if (fieldsToShow.includes('latitude') && !formData.location.latitude)
        errors.coordinates = 'Please select a location on the map';
      if (fieldsToShow.includes('longitude') && !formData.location.longitude)
        errors.coordinates = 'Please select a location on the map';
    } else if (stepName === 'Pricing') {
      if (fieldsToShow.includes('monthlyRent') && !formData.pricing.monthlyRent)
        errors.monthlyRent = 'Monthly rent is required';
    } else if (stepName === 'Amenities') {
      // Validation for amenities and rules combined
      if (
        fieldsToShow.includes('maxGuests') &&
        formData.rules.guestsAllowed &&
        (formData.rules.maxGuests === undefined || formData.rules.maxGuests < 1)
      ) {
        errors.maxGuests = 'Maximum guests must be at least 1';
      }
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle next step with validation
  const handleNextStep = () => {
    if (validateCurrentStep()) {
      nextStep();
    }
  };

  // Handle showAddressNumber toggle
  const handleShowAddressNumberToggle = (show: boolean) => {
    const currentLocation = formData.location;

    // Update the showAddressNumber setting only
    setFormData('location', {
      ...currentLocation,
      showAddressNumber: show,
    });
  };

  // Handle showFloor toggle
  const handleShowFloorToggle = (show: boolean) => {
    const currentLocation = formData.location;

    // Update the showFloor setting
    setFormData('location', {
      ...currentLocation,
      showFloor: show,
    });
  };

  // Handle location selection from map
  const handleLocationSelect = async (lat: number, lng: number, address: string) => {
    console.log('Location selected:', { lat, lng, address });

    // Normalize coordinates to valid ranges
    const normalizedLat = Math.max(-90, Math.min(90, lat));
    const normalizedLng = ((lng + 180) % 360) - 180; // Normalize longitude to -180 to 180

    console.log('Normalized coordinates:', { normalizedLat, normalizedLng });

    // Check if address is a JSON string with detailed data from Nominatim API
    if (address.startsWith('{') && address.endsWith('}')) {
      try {
        const detailedData = JSON.parse(address);
        console.log('Parsed detailed data from API:', detailedData);

        // Get the current privacy settings
        const showAddressNumber = formData.location.showAddressNumber ?? true;
        const showFloor = formData.location.showFloor ?? true;

        // Always keep address as street name only, handle number and floor separately
        const streetName = detailedData.street || '';
        const addressNumber = detailedData.house_number || '';
        const floor = detailedData.floor || undefined;

        // Use the structured address data directly from the API
        setFormData('location', {
          address: streetName,
          addressLine2: formData.location.addressLine2 || '',
          addressNumber: addressNumber,
          floor: floor,
          city: detailedData.city || '',
          state: detailedData.state || '',
          zipCode: detailedData.postcode || '',
          country: detailedData.country || 'Spain',
          latitude: normalizedLat,
          longitude: normalizedLng,
          showAddressNumber: showAddressNumber,
          showFloor: showFloor,
        });
        console.log('Updated form with API data (showAddressNumber:', showAddressNumber, ')');
        return;
      } catch (error) {
        console.error('Failed to parse detailed address data:', error);
        // Fall back to reverse geocoding
      }
    }

    // If we don't have detailed data, perform reverse geocoding to get it
    try {
      console.log('Performing reverse geocoding to get detailed address data...');
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${normalizedLat}&lon=${normalizedLng}&addressdetails=1`,
      );
      const data = await response.json();

      console.log('Reverse geocoding result:', data);

      if (data.address) {
        // Get the current privacy settings
        const showAddressNumber = formData.location.showAddressNumber ?? true;
        const showFloor = formData.location.showFloor ?? true;

        // Always keep address as street name only, handle number and floor separately
        const streetName = data.address.road || '';
        const addressNumber = data.address.house_number || '';
        const floor = data.address.floor || undefined;

        // Use the structured address data from reverse geocoding
        setFormData('location', {
          address: streetName,
          addressLine2: formData.location.addressLine2 || '',
          addressNumber: addressNumber,
          floor: floor,
          city: data.address.city || data.address.town || data.address.village || '',
          state: data.address.state || data.address.province || '',
          zipCode: data.address.postcode || '',
          country: data.address.country || 'Spain',
          latitude: normalizedLat,
          longitude: normalizedLng,
          showAddressNumber: showAddressNumber,
          showFloor: showFloor,
        });
        console.log(
          'Updated form with reverse geocoded data (showAddressNumber:',
          showAddressNumber,
          ')',
        );
        return;
      }
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
    }

    // Last resort: use the simple address string
    console.log('Using simple address string as fallback:', address);
    setFormData('location', {
      address: address,
      addressLine2: formData.location.addressLine2 || '',
      addressNumber: formData.location.addressNumber || '',
      city: formData.location.city || '',
      state: formData.location.state || '',
      zipCode: formData.location.zipCode || '',
      country: formData.location.country || 'Spain',
      latitude: normalizedLat,
      longitude: normalizedLng,
      showAddressNumber: formData.location.showAddressNumber ?? true,
    });
    console.log('Updated form with fallback data');
  };

  // Handle amenity selection
  const handleAmenityToggle = (amenityId: string) => {
    const currentAmenities = formData.amenities.selectedAmenities || [];
    const updatedAmenities = currentAmenities.includes(amenityId)
      ? currentAmenities.filter((id) => id !== amenityId)
      : [...currentAmenities, amenityId];

    setFormData('amenities', { selectedAmenities: updatedAmenities });
  };

  const bottomSheet = React.useContext(BottomSheetContext);

  // Predefined options
  const COUNTRY_OPTIONS = [
    'Spain',
    'United States',
    'Canada',
    'Mexico',
    'United Kingdom',
    'France',
    'Germany',
    'Italy',
    'Portugal',
    'Netherlands',
    'Belgium',
    'Switzerland',
    'Austria',
    'Other',
  ];
  const STATE_OPTIONS = [
    // Spanish provinces
    'Madrid',
    'Barcelona',
    'Valencia',
    'Sevilla',
    'Zaragoza',
    'Málaga',
    'Murcia',
    'Palma',
    'Las Palmas',
    'Bilbao',
    'Alicante',
    'Córdoba',
    'Valladolid',
    'Vigo',
    'Gijón',
    "L'Hospitalet de Llobregat",
    'A Coruña',
    'Vitoria-Gasteiz',
    'Granada',
    'Elche',
    'Tarrasa',
    'Badalona',
    'Oviedo',
    'Cartagena',
    'Jerez de la Frontera',
    'Sabadell',
    'Móstoles',
    'Alcalá de Henares',
    'Pamplona',
    'Fuenlabrada',
    'Almería',
    'Leganés',
    'San Sebastián',
    'Santander',
    'Castellón de la Plana',
    'Burgos',
    'Albacete',
    'Alcorcón',
    'Getafe',
    'Salamanca',
    'Logroño',
    'Huelva',
    'Marbella',
    'Lleida',
    'Tarragona',
    'León',
    'Cádiz',
    'Jaén',
    'Girona',
    'Lugo',
    'Cáceres',
    'Toledo',
    'Ceuta',
    'Melilla',
    // US states
    'CA',
    'NY',
    'TX',
    'FL',
    'IL',
    'Other',
  ];

  // Render step content based on current step name
  const renderStepContent = () => {
    const stepName = steps[currentStep];
    switch (stepName) {
      case 'Basic Info':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Basic Information
            </ThemedText>

            {/* Property title is auto-generated */}

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Property Type</ThemedText>
              <View style={styles.propertyTypeContainer}>
                {PROPERTY_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type.id}
                    style={[
                      styles.propertyTypeButton,
                      formData.basicInfo.propertyType === type.id &&
                      styles.propertyTypeButtonSelected,
                    ]}
                    onPress={() => updateFormField('basicInfo', 'propertyType', type.id)}
                  >
                    <ThemedText
                      style={[
                        styles.propertyTypeText,
                        formData.basicInfo.propertyType === type.id &&
                        styles.propertyTypeTextSelected,
                      ]}
                    >
                      {type.label}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
              {validationErrors.propertyType && (
                <ThemedText style={styles.errorText}>{validationErrors.propertyType}</ThemedText>
              )}
            </View>

            {/* Conditionally render Bedrooms */}
            {fieldsToShow.includes('bedrooms') && (
              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                  <ThemedText style={styles.label}>Bedrooms</ThemedText>
                  <TextInput
                    style={[styles.input, validationErrors.bedrooms && styles.inputError]}
                    value={formData.basicInfo.bedrooms?.toString() || ''}
                    onChangeText={(text) =>
                      updateFormField('basicInfo', 'bedrooms', parseInt(text) || 0)
                    }
                    keyboardType="numeric"
                    placeholder="0"
                  />
                  {validationErrors.bedrooms && (
                    <ThemedText style={styles.errorText}>{validationErrors.bedrooms}</ThemedText>
                  )}
                </View>

                {/* Conditionally render Bathrooms */}
                {fieldsToShow.includes('bathrooms') && (
                  <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                    <ThemedText style={styles.label}>Bathrooms</ThemedText>
                    <TextInput
                      style={[styles.input, validationErrors.bathrooms && styles.inputError]}
                      value={formData.basicInfo.bathrooms?.toString() || ''}
                      onChangeText={(text) =>
                        updateFormField('basicInfo', 'bathrooms', parseFloat(text) || 0)
                      }
                      keyboardType="numeric"
                      placeholder="0"
                    />
                    {validationErrors.bathrooms && (
                      <ThemedText style={styles.errorText}>{validationErrors.bathrooms}</ThemedText>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Conditionally render Square Footage, Floor, Year Built */}
            <View style={styles.formRow}>
              {fieldsToShow.includes('squareFootage') && (
                <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                  <ThemedText style={styles.label}>Square Footage</ThemedText>
                  <TextInput
                    style={[styles.input, validationErrors.squareFootage && styles.inputError]}
                    value={formData.basicInfo.squareFootage?.toString() || ''}
                    onChangeText={(text) =>
                      updateFormField('basicInfo', 'squareFootage', parseInt(text) || 0)
                    }
                    keyboardType="numeric"
                    placeholder="0"
                  />
                  {validationErrors.squareFootage && (
                    <ThemedText style={styles.errorText}>
                      {validationErrors.squareFootage}
                    </ThemedText>
                  )}
                </View>
              )}
            </View>
            {fieldsToShow.includes('yearBuilt') && (
              <View style={styles.formGroup}>
                <ThemedText style={styles.label}>Year Built (optional)</ThemedText>
                <TextInput
                  style={styles.input}
                  value={formData.basicInfo.yearBuilt?.toString() || ''}
                  onChangeText={(text) =>
                    updateFormField('basicInfo', 'yearBuilt', parseInt(text) || undefined)
                  }
                  keyboardType="numeric"
                  placeholder="2023"
                />
              </View>
            )}

            {/* Description always shown if in fieldsToShow */}
            {fieldsToShow.includes('description') && (
              <View style={styles.formGroup}>
                <ThemedText style={styles.label}>Description</ThemedText>
                <TextInput
                  style={[styles.textArea]}
                  value={formData.basicInfo.description}
                  onChangeText={(text) => updateFormField('basicInfo', 'description', text)}
                  placeholder="Describe your property..."
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                />
              </View>
            )}
          </View>
        );

      case 'Location':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Location
            </ThemedText>

            <View style={styles.formGroup}>
              <ThemedText
                style={[
                  styles.errorText,
                  {
                    fontSize: 14,
                    color: colors.COLOR_BLACK_LIGHT_4,
                    marginBottom: 16,
                    lineHeight: 20,
                  },
                ]}
              >
                📍 Please fill in the complete address details including exact number and floor. You
                can toggle privacy settings to control whether this detailed information is shown
                publicly.
              </ThemedText>
            </View>

            <View style={styles.mapContainer}>
              <View style={styles.mapWrapper}>
                <Map
                  ref={mapRef}
                  style={{ height: 400 }}
                  enableAddressLookup={true}
                  showAddressInstructions={true}
                  onAddressSelect={handleAddressSelect}
                  screenId="create-property"
                />
                <TouchableOpacity
                  style={styles.fullscreenButton}
                  onPress={() => setShowFullscreenMap(true)}
                >
                  <IconComponent name="expand" size={20} color={colors.primaryDark} />
                </TouchableOpacity>
              </View>
              {validationErrors.coordinates && (
                <ThemedText style={styles.errorText}>{validationErrors.coordinates}</ThemedText>
              )}
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Country or Region</ThemedText>
              <TouchableOpacity
                style={[styles.input, { justifyContent: 'center' }]}
                onPress={() =>
                  bottomSheet.openBottomSheet(
                    <SearchablePickerBottomSheet
                      options={COUNTRY_OPTIONS}
                      selected={formData.location.country || ''}
                      onSelect={(value) => updateFormField('location', 'country', value)}
                      title="Country or Region"
                      onClose={() => { }}
                    />,
                  )
                }
              >
                <ThemedText
                  style={{
                    color: formData.location.country
                      ? colors.primaryDark
                      : colors.COLOR_BLACK_LIGHT_4,
                  }}
                >
                  {formData.location.country || 'Select country or region'}
                </ThemedText>
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Address</ThemedText>
              <TextInput
                style={[styles.input, validationErrors.address && styles.inputError]}
                value={formData.location.address}
                onChangeText={(text) => updateFormField('location', 'address', text)}
                placeholder="Street name"
              />
              {validationErrors.address && (
                <ThemedText style={styles.errorText}>{validationErrors.address}</ThemedText>
              )}
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Address line 2 (optional)</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.location.addressLine2 || ''}
                onChangeText={(text) => updateFormField('location', 'addressLine2', text)}
                placeholder="Apartment, suite, etc. (optional)"
              />
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <ThemedText style={styles.label}>Address Number</ThemedText>
                <View style={styles.addressNumberContainer}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginRight: 8 }]}
                    value={formData.location.addressNumber || ''}
                    onChangeText={(text) => updateFormField('location', 'addressNumber', text)}
                    placeholder="Number"
                    keyboardType="numeric"
                  />
                  <TouchableOpacity
                    style={[
                      styles.toggleButton,
                      formData.location.showAddressNumber && styles.toggleButtonActive,
                    ]}
                    onPress={() =>
                      handleShowAddressNumberToggle(!formData.location.showAddressNumber)
                    }
                  >
                    <ThemedText
                      style={[
                        styles.toggleButtonText,
                        formData.location.showAddressNumber && styles.toggleButtonTextActive,
                      ]}
                    >
                      {formData.location.showAddressNumber ? 'Hide' : 'Show'}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                <ThemedText style={styles.label}>Floor</ThemedText>
                <View style={styles.addressNumberContainer}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginRight: 8 }]}
                    value={formData.location.floor?.toString() || ''}
                    onChangeText={(text) =>
                      updateFormField('location', 'floor', parseInt(text) || undefined)
                    }
                    placeholder="Floor"
                    keyboardType="numeric"
                  />
                  <TouchableOpacity
                    style={[
                      styles.toggleButton,
                      formData.location.showFloor && styles.toggleButtonActive,
                    ]}
                    onPress={() => handleShowFloorToggle(!formData.location.showFloor)}
                  >
                    <ThemedText
                      style={[
                        styles.toggleButtonText,
                        formData.location.showFloor && styles.toggleButtonTextActive,
                      ]}
                    >
                      {formData.location.showFloor ? 'Hide' : 'Show'}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Privacy message - show when either number or floor is hidden */}
            {(formData.location.addressNumber && !formData.location.showAddressNumber) ||
              (formData.location.floor && !formData.location.showFloor) ? (
              <View style={styles.formGroup}>
                <ThemedText
                  style={[
                    styles.errorText,
                    { fontSize: 12, color: colors.COLOR_BLACK_LIGHT_4, marginTop: 4 },
                  ]}
                >
                  ℹ️ Approximate address shown for privacy
                </ThemedText>
              </View>
            ) : null}

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <ThemedText style={styles.label}>City/District</ThemedText>
                <TextInput
                  style={[styles.input, validationErrors.city && styles.inputError]}
                  value={formData.location.city}
                  onChangeText={(text) => updateFormField('location', 'city', text)}
                  placeholder="City or district"
                />
                {validationErrors.city && (
                  <ThemedText style={styles.errorText}>{validationErrors.city}</ThemedText>
                )}
              </View>

              <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                <ThemedText style={styles.label}>State/Province/Region</ThemedText>
                <TouchableOpacity
                  style={[styles.input, { justifyContent: 'center' }]}
                  onPress={() =>
                    bottomSheet.openBottomSheet(
                      <SearchablePickerBottomSheet
                        options={STATE_OPTIONS}
                        selected={formData.location.state || ''}
                        onSelect={(value) => updateFormField('location', 'state', value)}
                        title="State/Province/Region"
                        onClose={() => { }}
                      />,
                    )
                  }
                >
                  <ThemedText
                    style={{
                      color: formData.location.state
                        ? colors.primaryDark
                        : colors.COLOR_BLACK_LIGHT_4,
                    }}
                  >
                    {formData.location.state || 'Select state/province/region'}
                  </ThemedText>
                </TouchableOpacity>
                {validationErrors.state && (
                  <ThemedText style={styles.errorText}>{validationErrors.state}</ThemedText>
                )}
              </View>
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>ZIP/Postal Code</ThemedText>
              <TextInput
                style={[styles.input, validationErrors.zipCode && styles.inputError]}
                value={formData.location.zipCode}
                onChangeText={(text) => updateFormField('location', 'zipCode', text)}
                placeholder="ZIP or postal code"
                keyboardType="numeric"
              />
              {validationErrors.zipCode && (
                <ThemedText style={styles.errorText}>{validationErrors.zipCode}</ThemedText>
              )}
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <ThemedText style={styles.label}>Available From</ThemedText>
                <TextInput
                  style={styles.input}
                  value={formData.location.availableFrom}
                  onChangeText={(text) => updateFormField('location', 'availableFrom', text)}
                  placeholder="Available from date"
                />
              </View>

              <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                <ThemedText style={styles.label}>Lease Term</ThemedText>
                <TextInput
                  style={styles.input}
                  value={formData.location.leaseTerm}
                  onChangeText={(text) => updateFormField('location', 'leaseTerm', text)}
                  placeholder="Lease term"
                />
              </View>
            </View>
          </View>
        );

      case 'Pricing':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Pricing
            </ThemedText>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <ThemedText style={styles.label}>Monthly Rent</ThemedText>
                <TextInput
                  style={[styles.input, validationErrors.monthlyRent && styles.inputError]}
                  value={formData.pricing.monthlyRent?.toString() || ''}
                  onChangeText={(text) =>
                    updateFormField('pricing', 'monthlyRent', parseFloat(text) || 0)
                  }
                  keyboardType="numeric"
                  placeholder="0"
                />
                {validationErrors.monthlyRent && (
                  <ThemedText style={styles.errorText}>{validationErrors.monthlyRent}</ThemedText>
                )}
              </View>

              <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                <ThemedText style={styles.label}>Currency</ThemedText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(
                    ['USD', 'EUR', 'GBP', 'CAD', 'MXN', 'FAIR (FairCoin)', 'Other'] as string[]
                  ).map((currency: string) => (
                    <TouchableOpacity
                      key={currency}
                      style={[
                        styles.propertyTypeButton,
                        formData.pricing.currency === currency && styles.propertyTypeButtonSelected,
                      ]}
                      onPress={() => updateFormField('pricing', 'currency', currency)}
                    >
                      <ThemedText
                        style={[
                          styles.propertyTypeText,
                          formData.pricing.currency === currency && styles.propertyTypeTextSelected,
                        ]}
                      >
                        {currency}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Security Deposit</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.pricing.securityDeposit?.toString() || ''}
                onChangeText={(text) =>
                  updateFormField('pricing', 'securityDeposit', parseFloat(text) || 0)
                }
                keyboardType="numeric"
                placeholder="0"
              />
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Application Fee</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.pricing.applicationFee?.toString() || ''}
                onChangeText={(text) =>
                  updateFormField('pricing', 'applicationFee', parseFloat(text) || 0)
                }
                keyboardType="numeric"
                placeholder="0"
              />
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Late Fee</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.pricing.lateFee?.toString() || ''}
                onChangeText={(text) =>
                  updateFormField('pricing', 'lateFee', parseFloat(text) || 0)
                }
                keyboardType="numeric"
                placeholder="0"
              />
            </View>
          </View>
        );

      case 'Amenities':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Amenities & Rules
            </ThemedText>

            <AmenitiesSelector
              selectedAmenities={formData.amenities.selectedAmenities || []}
              onAmenityToggle={handleAmenityToggle}
              propertyType={formData.basicInfo.propertyType}
              style={styles.amenitiesSelector}
            />

            {/* Rules Section */}
            <View style={styles.formSection}>
              <ThemedText
                type="subtitle"
                style={[styles.sectionTitle, { marginTop: 24, marginBottom: 16 }]}
              >
                House Rules
              </ThemedText>

              <View style={styles.toggleContainer}>
                <ThemedText style={styles.label}>Pets Allowed</ThemedText>
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    formData.rules?.petsAllowed ? styles.toggleButtonActive : {},
                  ]}
                  onPress={() =>
                    updateFormField('rules', 'petsAllowed', !formData.rules?.petsAllowed)
                  }
                >
                  <IconComponent
                    name={formData.rules?.petsAllowed ? 'checkmark-circle' : 'close-circle'}
                    size={24}
                    color={
                      formData.rules?.petsAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4
                    }
                  />
                  <ThemedText style={styles.toggleText}>
                    {formData.rules?.petsAllowed ? 'Yes' : 'No'}
                  </ThemedText>
                </TouchableOpacity>
              </View>

              <View style={styles.toggleContainer}>
                <ThemedText style={styles.label}>Smoking Allowed</ThemedText>
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    formData.rules?.smokingAllowed ? styles.toggleButtonActive : {},
                  ]}
                  onPress={() =>
                    updateFormField('rules', 'smokingAllowed', !formData.rules?.smokingAllowed)
                  }
                >
                  <IconComponent
                    name={formData.rules?.smokingAllowed ? 'checkmark-circle' : 'close-circle'}
                    size={24}
                    color={
                      formData.rules?.smokingAllowed
                        ? colors.primaryColor
                        : colors.COLOR_BLACK_LIGHT_4
                    }
                  />
                  <ThemedText style={styles.toggleText}>
                    {formData.rules?.smokingAllowed ? 'Yes' : 'No'}
                  </ThemedText>
                </TouchableOpacity>
              </View>

              <View style={styles.toggleContainer}>
                <ThemedText style={styles.label}>Parties Allowed</ThemedText>
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    formData.rules?.partiesAllowed ? styles.toggleButtonActive : {},
                  ]}
                  onPress={() =>
                    updateFormField('rules', 'partiesAllowed', !formData.rules?.partiesAllowed)
                  }
                >
                  <IconComponent
                    name={formData.rules?.partiesAllowed ? 'checkmark-circle' : 'close-circle'}
                    size={24}
                    color={
                      formData.rules?.partiesAllowed
                        ? colors.primaryColor
                        : colors.COLOR_BLACK_LIGHT_4
                    }
                  />
                  <ThemedText style={styles.toggleText}>
                    {formData.rules?.partiesAllowed ? 'Yes' : 'No'}
                  </ThemedText>
                </TouchableOpacity>
              </View>

              <View style={styles.toggleContainer}>
                <ThemedText style={styles.label}>Guests Allowed</ThemedText>
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    formData.rules?.guestsAllowed ? styles.toggleButtonActive : {},
                  ]}
                  onPress={() =>
                    updateFormField('rules', 'guestsAllowed', !formData.rules?.guestsAllowed)
                  }
                >
                  <IconComponent
                    name={formData.rules?.guestsAllowed ? 'checkmark-circle' : 'close-circle'}
                    size={24}
                    color={
                      formData.rules?.guestsAllowed
                        ? colors.primaryColor
                        : colors.COLOR_BLACK_LIGHT_4
                    }
                  />
                  <ThemedText style={styles.toggleText}>
                    {formData.rules?.guestsAllowed ? 'Yes' : 'No'}
                  </ThemedText>
                </TouchableOpacity>
              </View>

              {formData.rules?.guestsAllowed && (
                <View style={styles.formGroup}>
                  <ThemedText style={styles.label}>Maximum Number of Guests</ThemedText>
                  <TextInput
                    style={[styles.input, validationErrors.maxGuests && styles.inputError]}
                    value={formData.rules.maxGuests?.toString() || ''}
                    onChangeText={(text) =>
                      updateFormField('rules', 'maxGuests', parseInt(text) || undefined)
                    }
                    placeholder="e.g., 2"
                    keyboardType="numeric"
                  />
                  {validationErrors.maxGuests && (
                    <ThemedText style={styles.errorText}>{validationErrors.maxGuests}</ThemedText>
                  )}
                </View>
              )}
            </View>
          </View>
        );

      case 'Coliving Features':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Coliving Features
            </ThemedText>

            <View style={styles.toggleContainer}>
              <ThemedText style={styles.label}>Shared Spaces</ThemedText>
              <TouchableOpacity
                style={[
                  styles.toggleButton,
                  formData.colivingFeatures?.sharedSpaces ? styles.toggleButtonActive : {},
                ]}
                onPress={() =>
                  updateFormField(
                    'colivingFeatures',
                    'sharedSpaces',
                    !formData.colivingFeatures?.sharedSpaces,
                  )
                }
              >
                <IconComponent
                  name={
                    formData.colivingFeatures?.sharedSpaces ? 'checkmark-circle' : 'close-circle'
                  }
                  size={24}
                  color={
                    formData.colivingFeatures?.sharedSpaces
                      ? colors.primaryColor
                      : colors.COLOR_BLACK_LIGHT_4
                  }
                />
                <ThemedText style={styles.toggleText}>
                  {formData.colivingFeatures?.sharedSpaces ? 'Yes' : 'No'}
                </ThemedText>
              </TouchableOpacity>
            </View>

            {/* If sharedSpaces is true, show additional fields */}
            {formData.colivingFeatures?.sharedSpaces && (
              <View style={styles.formGroup}>
                <ThemedText style={styles.label}>Which shared spaces?</ThemedText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {[
                    'Kitchen',
                    'Living Room',
                    'Coworking Area',
                    'Gym',
                    'Laundry',
                    'Garden',
                    'Terrace',
                    'Dining Room',
                  ].map((space) => {
                    const selected = formData.colivingFeatures?.sharedSpacesList?.includes(space);
                    return (
                      <TouchableOpacity
                        key={space}
                        style={[
                          styles.propertyTypeButton,
                          selected && styles.propertyTypeButtonSelected,
                        ]}
                        onPress={() => {
                          const current = formData.colivingFeatures?.sharedSpacesList || [];
                          const updated = selected
                            ? current.filter((s: string) => s !== space)
                            : [...current, space];
                          updateFormField('colivingFeatures', 'sharedSpacesList', updated);
                        }}
                      >
                        <ThemedText
                          style={[
                            styles.propertyTypeText,
                            selected && styles.propertyTypeTextSelected,
                          ]}
                        >
                          {space}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <ThemedText style={[styles.label, { marginTop: 16 }]}>
                  Other shared spaces or features
                </ThemedText>
                <TextInput
                  style={styles.input}
                  value={formData.colivingFeatures?.otherFeatures || ''}
                  onChangeText={(text) =>
                    updateFormField('colivingFeatures', 'otherFeatures', text)
                  }
                  placeholder="e.g., Rooftop, Cinema Room, Pool, etc."
                />
              </View>
            )}

            <View style={styles.toggleContainer}>
              <ThemedText style={styles.label}>Community Events</ThemedText>
              <TouchableOpacity
                style={[
                  styles.toggleButton,
                  formData.colivingFeatures?.communityEvents ? styles.toggleButtonActive : {},
                ]}
                onPress={() =>
                  updateFormField(
                    'colivingFeatures',
                    'communityEvents',
                    !formData.colivingFeatures?.communityEvents,
                  )
                }
              >
                <IconComponent
                  name={
                    formData.colivingFeatures?.communityEvents ? 'checkmark-circle' : 'close-circle'
                  }
                  size={24}
                  color={
                    formData.colivingFeatures?.communityEvents
                      ? colors.primaryColor
                      : colors.COLOR_BLACK_LIGHT_4
                  }
                />
                <ThemedText style={styles.toggleText}>
                  {formData.colivingFeatures?.communityEvents ? 'Yes' : 'No'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'Media':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Media
            </ThemedText>

            <View style={styles.mediaUploadContainer}>
              <TouchableOpacity style={styles.uploadButton}>
                <IconComponent name="cloud-upload-outline" size={32} color={colors.primaryLight} />
                <ThemedText style={styles.uploadText}>Upload Images</ThemedText>
              </TouchableOpacity>

              <ThemedText style={styles.helperText}>
                Upload high-quality images of your property. Include photos of all rooms, exterior,
                and any special features.
              </ThemedText>
            </View>

            {/* Image preview would go here */}
            <View style={styles.imagePreviewContainer}>
              {formData.media.images && formData.media.images.length > 0 ? (
                <ThemedText>Image preview would go here</ThemedText>
              ) : (
                <ThemedText style={styles.noImagesText}>No images uploaded yet</ThemedText>
              )}
            </View>
          </View>
        );

      case 'Preview':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Preview
            </ThemedText>
            <PropertyPreviewWidget />

            <View style={styles.submitContainer}>
              <ThemedText style={styles.helperText}>
                Review your property listing before submitting. Make sure all information is
                accurate and complete.
              </ThemedText>

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmit}
                disabled={isLoading || (isEditMode && propertyLoading)}
              >
                {isLoading ? (
                  <ThemedText style={styles.submitButtonText}>
                    {isEditMode ? 'Updating...' : 'Creating...'}
                  </ThemedText>
                ) : (
                  <ThemedText style={styles.submitButtonText}>
                    {isEditMode ? 'Update Property' : 'Create Property'}
                  </ThemedText>
                )}
              </TouchableOpacity>

              {error && <ThemedText style={styles.errorText}>{error}</ThemedText>}
            </View>
          </View>
        );

      default:
        return (
          <View style={styles.formSection}>
            <ThemedText>Unknown step: {stepName}</ThemedText>
          </View>
        );
    }
  };

  // Debug section for development
  const renderDebugInfo = () => {
    if (!__DEV__) return null;

    return (
      <View style={styles.debugContainer}>
        <ThemedText type="subtitle" style={styles.debugTitle}>
          Debug Info
        </ThemedText>
        <ThemedText style={styles.debugText}>
          Current Step: {currentStep} ({steps[currentStep]})
        </ThemedText>
        <ThemedText style={styles.debugText}>
          Location Data: {JSON.stringify(formData.location, null, 2)}
        </ThemedText>
        <ThemedText style={styles.debugText}>
          Validation Errors: {JSON.stringify(validationErrors, null, 2)}
        </ThemedText>
      </View>
    );
  };

  // Show loading state when in edit mode and property is loading
  if (isEditMode && propertyLoading) {
    return (
      <View style={styles.container}>
        <Header options={{ title: 'Edit Property', showBackButton: true }} />
        <View style={styles.loadingContainer}>
          <ThemedText>Loading property...</ThemedText>
        </View>
      </View>
    );
  }

  // Show error state if property failed to load in edit mode
  if (isEditMode && propertyError) {
    return (
      <View style={styles.container}>
        <Header options={{ title: 'Edit Property', showBackButton: true }} />
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>{propertyError || 'Property not found'}</ThemedText>
          <TouchableOpacity style={styles.errorButton} onPress={() => router.back()}>
            <ThemedText style={styles.errorButtonText}>Go Back</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <Header
        options={{ title: isEditMode ? 'Edit Property' : 'Create Property', showBackButton: true }}
      />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Step indicators */}
        <View style={styles.stepsContainer}>
          {steps.map((stepName, index) => (
            <View key={index} style={styles.stepItem}>
              <View
                style={[
                  styles.stepIndicator,
                  index === currentStep && styles.stepIndicatorActive,
                  index < currentStep && styles.stepIndicatorCompleted,
                ]}
              >
                {index < currentStep ? (
                  <IconComponent name="checkmark" size={16} color="white" />
                ) : (
                  <ThemedText
                    style={[styles.stepNumber, index === currentStep && styles.stepNumberActive]}
                  >
                    {index + 1}
                  </ThemedText>
                )}
              </View>
              <ThemedText
                style={[styles.stepLabel, index === currentStep && styles.stepLabelActive]}
              >
                {stepName}
              </ThemedText>
            </View>
          ))}
        </View>

        {/* Form content */}
        <View style={styles.formContainer}>
          {renderStepContent()}
          {renderDebugInfo()}
        </View>

        {/* Navigation buttons */}
        <View style={styles.navigationContainer}>
          {currentStep > 0 && (
            <TouchableOpacity style={styles.navigationButton} onPress={prevStep}>
              <IconComponent name="arrow-back" size={20} color={colors.primaryColor} />
              <ThemedText style={styles.navigationButtonText}>Previous</ThemedText>
            </TouchableOpacity>
          )}

          {currentStep < steps.length - 1 && (
            <TouchableOpacity
              style={[styles.navigationButton, styles.navigationButtonNext]}
              onPress={handleNextStep}
            >
              <ThemedText style={styles.navigationButtonTextNext}>Next</ThemedText>
              <IconComponent name="arrow-forward" size={20} color="white" />
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Fullscreen Map Modal */}
      <Modal
        visible={showFullscreenMap}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowFullscreenMap(false)}
      >
        <View style={styles.fullscreenMapContainer}>
          <View style={styles.fullscreenMapHeader}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowFullscreenMap(false)}
            >
              <IconComponent name="close" size={24} color={colors.primaryDark} />
            </TouchableOpacity>
            <ThemedText style={styles.fullscreenMapTitle}>Select Location</ThemedText>
            <TouchableOpacity
              style={styles.confirmButton}
              onPress={() => setShowFullscreenMap(false)}
            >
              <ThemedText style={styles.confirmButtonText}>Confirm</ThemedText>
            </TouchableOpacity>
          </View>
          <Map
            ref={fullscreenMapRef}
            style={{ flex: 1 }}
            enableAddressLookup={true}
            onAddressSelect={handleFullscreenAddressSelect}
            screenId="create-property-fullscreen"
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.COLOR_BACKGROUND,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  stepsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  stepItem: {
    alignItems: 'center',
    width: '14%', // 7 steps
  },
  stepIndicator: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepIndicatorActive: {
    backgroundColor: colors.primaryColor,
  },
  stepIndicatorCompleted: {
    backgroundColor: colors.primaryColor,
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  stepNumberActive: {
    color: 'white',
  },
  stepLabel: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    textAlign: 'center',
  },
  stepLabelActive: {
    color: colors.primaryColor,
    fontWeight: 'bold',
  },
  formSection: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    marginBottom: 16,
    color: colors.primaryDark,
  },
  formGroup: {
    marginBottom: 16,
  },
  formRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  input: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.primaryDark,
  },
  inputError: {
    borderColor: 'red',
  },
  textArea: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.primaryDark,
    minHeight: 120,
  },
  errorText: {
    color: 'red',
    fontSize: 12,
    marginTop: 4,
  },
  propertyTypeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  propertyTypeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    marginBottom: 8,
  },
  propertyTypeButtonSelected: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  propertyTypeText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  propertyTypeTextSelected: {
    color: 'white',
    fontWeight: 'bold',
  },
  mapContainer: {
    marginBottom: 16,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
  },
  mapWrapper: {
    position: 'relative',
  },
  fullscreenButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  fullscreenMapContainer: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  fullscreenMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenMapTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  confirmButton: {
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  confirmButtonText: {
    color: colors.primaryLight,
    fontSize: 14,
    fontWeight: '600',
  },
  amenitiesSelector: {
    marginTop: 8,
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
  },
  toggleButtonActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primaryColor,
  },
  toggleText: {
    marginLeft: 8,
    fontSize: 14,
  },
  toggleButtonText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  toggleButtonTextActive: {
    color: colors.primaryColor,
    fontWeight: 'bold',
  },
  addressNumberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mediaUploadContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    marginVertical: 16,
  },
  uploadButton: {
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  uploadText: {
    color: colors.primaryLight,
    fontSize: 16,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    marginBottom: 16,
  },
  imagePreviewContainer: {
    minHeight: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noImagesText: {
    color: colors.COLOR_BLACK_LIGHT_4,
    fontStyle: 'italic',
  },
  submitContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  submitButton: {
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 16,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  navigationContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  navigationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.primaryColor,
  },
  navigationButtonNext: {
    backgroundColor: colors.primaryColor,
    marginLeft: 'auto',
  },
  navigationButtonText: {
    marginLeft: 8,
    color: colors.primaryColor,
    fontWeight: 'bold',
  },
  navigationButtonTextNext: {
    marginRight: 8,
    color: 'white',
    fontWeight: 'bold',
  },
  debugContainer: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  debugTitle: {
    marginBottom: 12,
    color: colors.primaryDark,
  },
  debugText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 8,
  },
  formContainer: {
    // This style is used to contain the form content and debug info
    // It's not directly applied to the form content or debug info,
    // but it helps in organizing the layout.
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },

  errorButton: {
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  errorButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
