import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform, Image, Dimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { PropertyMap } from '@/components/PropertyMap';
import { Header } from '@/components/Header';
import { CreatePropertyData } from '@/services/propertyService';
import { useCreatePropertyFormStore } from '@/store/createPropertyFormStore';
import { useOxy } from '@oxyhq/services';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { calculateEthicalRent, validateEthicalPricing, getPricingGuidance } from '@/utils/ethicalPricing';
import { Ionicons } from '@expo/vector-icons';
import { POPULAR_AMENITIES, getAmenityById, getAmenitiesByPropertyType } from '@/constants/amenities';
import { useTranslation } from 'react-i18next';
import { useCreateProperty } from '@/hooks/usePropertyQueries';
import { useLocationSearch, useReverseGeocode } from '@/hooks/useLocationRedux';
import { AmenitiesSelector } from '@/components/AmenitiesSelector';
import { LinearGradient } from 'expo-linear-gradient';
import { toast } from 'sonner';
import { CurrencyFormatter } from '@/components/CurrencyFormatter';
import { propertyService, type EthicalPricingResponse } from '@/services/propertyService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const IconComponent = Ionicons as any;
const { width: screenWidth } = Dimensions.get('window');

export default function CreatePropertyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { oxyServices, activeSessionId } = useOxy();

  // Use Zustand store for create property form
  const { formData: reduxFormData, isVisible, setFormData, setIsVisible } = useCreatePropertyFormStore();

  // Use location hooks (now Zustand-based)
  const { search, results: searchResults, loading: searchLoading, clearResults } = useLocationSearch();
  const { reverseGeocode, result: reverseResult, loading: reverseLoading } = useReverseGeocode();

  // Use property creation hook (now Zustand-based)
  const { create, loading: createLoading } = useCreateProperty();

  const [formData, setLocalFormData] = useState<CreatePropertyData & {
    priceUnit: 'day' | 'night' | 'week' | 'month' | 'year';
    housingType?: 'private' | 'public';
    layoutType?: 'open' | 'shared' | 'partitioned' | 'traditional' | 'studio' | 'other';
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
      maxStay?: number; // For couchsurfing/hostels
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
        communityRent?: number;
        slidingScaleBase?: number;
        slidingScaleMax?: number;
        marketAdjustedRent?: number;
        incomeBasedRent?: number;
        calculations?: {
          monthlyMedianIncome: number;
          rentToIncomeRatio: number;
          standardRentPercentage: number;
          affordableRentPercentage: number;
          communityRentPercentage: number;
        };
      };
    };
  }>({
    address: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'US',
    },
    type: 'apartment',
    description: '',
    squareFootage: 0,
    bedrooms: 1,
    bathrooms: 1,
    rent: {
      amount: 0,
      currency: 'USD',
      paymentFrequency: 'monthly',
      deposit: 0,
      utilities: 'excluded',
      hasIncomeBasedPricing: false,
      hasSlidingScale: false,
      hasUtilitiesIncluded: false,
      hasReducedDeposit: false,
    },
    priceUnit: 'month',
    amenities: [],
    housingType: 'private',
    layoutType: undefined,
    floor: undefined,
    hasElevator: false,
    parkingSpaces: 1,
    yearBuilt: undefined,
    furnishedStatus: 'unfurnished',
    utilitiesIncluded: false,
    petFriendly: false,
    hasBalcony: false,
    hasGarden: false,
    proximityToTransport: false,
    proximityToSchools: false,
    proximityToShopping: false,
    // New fields
    petPolicy: 'not_allowed',
    petFee: 0,
    parkingType: 'none',
    availableFrom: new Date().toISOString().split('T')[0],
    leaseTerm: '12_months',
    smokingAllowed: false,
    partiesAllowed: false,
    guestsAllowed: true,
    maxGuests: 2,
    images: [],
    coverImageIndex: 0,
    isDraft: true,
    lastSaved: new Date(),
  });

  const [selectedLocation, setSelectedLocation] = useState<{
    latitude: number;
    longitude: number;
    address: string;
  } | null>(null);

  // Search functionality
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isMapSelectionRef, setIsMapSelectionRef] = useState(false);

  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSearchQueryWithSource = (query: string, fromMap: boolean = false) => {
    if (fromMap) {
      setIsMapSelectionRef(true);
    }
    setSearchQuery(query);
  };

  // Location state
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [locationPermission, setLocationPermission] = useState<Location.PermissionStatus | null>(null);
  const [currentCoordinates, setCurrentCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [isWatchingLocation, setIsWatchingLocation] = useState(false);
  const [locationSubscription, setLocationSubscription] = useState<Location.LocationSubscription | null>(null);

  // Ethical pricing validation
  const [pricingValidation, setPricingValidation] = useState<any>(null);
  const [showPricingGuidance, setShowPricingGuidance] = useState(false);

  // Auto-save functionality
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const autoSaveTimeoutRef = useRef<any>(null);

  // Image management
  const [imageUploading, setImageUploading] = useState(false);

  // Draft saving state
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedMessage, setDraftSavedMessage] = useState(false);

  // Location intelligence
  const [locationScores, setLocationScores] = useState({
    walkScore: null as number | null,
    transitScore: null as number | null,
    bikeScore: null as number | null,
  });

  // Scroll refs for error handling
  const scrollViewRef = useRef<ScrollView>(null);
  const fieldRefs = useRef<{ [key: string]: any }>({});

  // Error state management
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [hasValidationErrors, setHasValidationErrors] = useState(false);

  const fetchLocationScores = async (zipCode: string) => {
    try {
      const response = await fetch(`https://api.zippopotam.us/us/${zipCode}`);
      const data = await response.json();

      if (data.places && data.places.length > 0) {
        const place = data.places[0];
        setLocalFormData(prev => ({
          ...prev,
          address: {
            ...prev.address,
            city: place['place name'],
            state: place['state abbreviation'],
            zipCode: zipCode,
          },
        }));
      }
    } catch (error) {
      console.error('Error fetching location scores:', error);
    }
  };

  const autoFillFromZipCode = async (zipCode: string) => {
    try {
      const response = await fetch(`https://api.zippopotam.us/us/${zipCode}`);
      const data = await response.json();

      if (data.places && data.places.length > 0) {
        const place = data.places[0];
        setLocalFormData(prev => ({
          ...prev,
          address: {
            ...prev.address,
            city: place['place name'],
            state: place['state abbreviation'],
            zipCode: zipCode,
          },
        }));
      }
    } catch (error) {
      console.error('Error auto-filling from zip code:', error);
    }
  };

  const updateZipCodeWithAutoFill = (zipCode: string) => {
    if (zipCode.length === 5) {
      autoFillFromZipCode(zipCode);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const newImage = result.assets[0].uri;
      setLocalFormData(prev => ({
        ...prev,
        images: [...prev.images, newImage],
      }));
    }
  };

  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const newImage = result.assets[0].uri;
      setLocalFormData(prev => ({
        ...prev,
        images: [...prev.images, newImage],
      }));
    }
  };

  const removeImage = (index: number) => {
    setLocalFormData(prev => {
      const newImages = prev.images.filter((_, i) => i !== index);
      return {
        ...prev,
        images: newImages,
        coverImageIndex: Math.min(prev.coverImageIndex, newImages.length - 1),
      };
    });
  };

  const setCoverImage = (index: number) => {
    setLocalFormData(prev => ({
      ...prev,
      coverImageIndex: index,
    }));
  };

  const reorderImages = (fromIndex: number, toIndex: number) => {
    setLocalFormData(prev => {
      const newImages = [...prev.images];
      const [movedImage] = newImages.splice(fromIndex, 1);
      newImages.splice(toIndex, 0, movedImage);

      // Adjust cover image index if needed
      let newCoverIndex = prev.coverImageIndex;
      if (prev.coverImageIndex === fromIndex) {
        newCoverIndex = toIndex;
      } else if (prev.coverImageIndex > fromIndex && prev.coverImageIndex <= toIndex) {
        newCoverIndex--;
      } else if (prev.coverImageIndex < fromIndex && prev.coverImageIndex >= toIndex) {
        newCoverIndex++;
      }

      return {
        ...prev,
        images: newImages,
        coverImageIndex: newCoverIndex,
      };
    });
  };

  const isFormValid = () => {
    return (
      formData.address.street.trim() !== '' &&
      formData.address.city.trim() !== '' &&
      formData.address.state.trim() !== '' &&
      formData.address.zipCode.trim() !== '' &&
      formData.rent.amount > 0
    );
  };

  // Check location permission on mount
  useEffect(() => {
    const checkLocationPermission = async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      setLocationPermission(status);
    };

    checkLocationPermission();
  }, []);

  // Clear loading state on mount to ensure clean state
  useEffect(() => {
    setErrors({});
    setHasValidationErrors(false);

    // Cleanup when component unmounts
    return () => {
      setErrors({});
      setHasValidationErrors(false);
    };
  }, []);

  // Load draft on mount if available
  useEffect(() => {
    loadDraft();
  }, []);

  // Better address parsing function for OpenStreetMap Nominatim format
  const parseAddress = (fullAddress: string) => {
    console.log('Parsing address:', fullAddress); // Debug log

    // Nominatim typically returns: "Street Number, Street Name, City, State/Province, ZIP, Country"
    const parts = fullAddress.split(', ').map(part => part.trim());
    console.log('Address parts:', parts); // Debug log

    let street = '';
    let city = '';
    let state = '';
    let zipCode = '';

    // More robust parsing based on actual Nominatim format
    if (parts.length >= 5) {
      // Format: "123, Main Street, City, State/Province, ZIP, Country"
      // Street: First two parts (number + street name)
      street = `${parts[0]}, ${parts[1]}`;
      city = parts[2];
      state = parts[3]; // This could be state or province

      // Find ZIP code (look for 5-digit pattern or postal code)
      for (let i = 4; i < parts.length; i++) {
        if (/^\d{5}(-\d{4})?$/.test(parts[i]) || /^[A-Z]\d[A-Z] \d[A-Z]\d$/.test(parts[i])) {
          zipCode = parts[i];
          break;
        }
      }
    } else if (parts.length === 4) {
      // Format: "123 Main Street, City, State/Province, ZIP"
      street = parts[0];
      city = parts[1];
      state = parts[2]; // This could be state or province

      if (/^\d{5}(-\d{4})?$/.test(parts[3]) || /^[A-Z]\d[A-Z] \d[A-Z]\d$/.test(parts[3])) {
        zipCode = parts[3];
      }
    } else if (parts.length === 3) {
      // Format: "Street, City, State/Province"
      street = parts[0];
      city = parts[1];
      state = parts[2]; // This could be state or province
    } else if (parts.length === 2) {
      // Format: "Street, City"
      street = parts[0];
      city = parts[1];
    } else {
      // Single part
      street = fullAddress;
    }

    const result = { street, city, state, zipCode };
    console.log('Parsed result:', result); // Debug log
    return result;
  };

  // Get current location and reverse geocode
  const getCurrentLocation = async () => {
    setIsGettingLocation(true);

    try {
      // Check location permission
      let { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermission(status);

      if (status !== 'granted') {
        toast.error('Location Permission Required', {
          description: 'Please enable location access to use this feature.'
        });
        return;
      }

      // Get current position
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 10,
      });

      const { latitude, longitude } = location.coords;

      // Store current coordinates
      setCurrentCoordinates({ latitude, longitude });
      setLocationAccuracy(location.coords.accuracy);

      // Reverse geocode to get address
      const geocodeResult = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });

      if (geocodeResult.length > 0) {
        const addressInfo = geocodeResult[0];

        // Update form data with location info
        const newAddress = {
          street: addressInfo.street ? `${addressInfo.streetNumber || ''} ${addressInfo.street}`.trim() : '',
          city: addressInfo.city || '',
          state: addressInfo.region || '',
          zipCode: addressInfo.postalCode || '',
          country: addressInfo.country || 'US',
        };

        setLocalFormData(prev => ({
          ...prev,
          address: newAddress,
        }));

        // Update selected location for map
        setSelectedLocation({
          latitude,
          longitude,
          address: `${newAddress.street}, ${newAddress.city}, ${newAddress.state}`,
        });

        // Update search query
        setSearchQuery(`${newAddress.street}, ${newAddress.city}, ${newAddress.state}`);

        toast.success('Location Found', {
          description: `Address updated to: ${newAddress.street}, ${newAddress.city}, ${newAddress.state}`
        });
      } else {
        toast.error('Location Error', {
          description: 'Could not find address for your current location. Please try again or enter address manually.'
        });
      }
    } catch (error) {
      console.error('Error getting current location:', error);

      let errorMessage = 'Failed to get your current location. Please check your location settings or enter address manually.';

      if (error instanceof Error) {
        if (error.message.includes('Location service is disabled')) {
          errorMessage = 'Location services are disabled. Please enable location services in your device settings.';
        } else if (error.message.includes('Network')) {
          errorMessage = 'Network error. Please check your internet connection and try again.';
        } else if (error.message.includes('Timeout')) {
          errorMessage = 'Location request timed out. Please try again.';
        }
      }

      toast.error('Location Error', {
        description: errorMessage
      });
    } finally {
      setIsGettingLocation(false);
    }
  };

  // Start/stop watching location
  const toggleLocationWatching = async () => {
    if (isWatchingLocation) {
      // Stop watching
      if (locationSubscription) {
        locationSubscription.remove();
        setLocationSubscription(null);
      }
      setIsWatchingLocation(false);
    } else {
      // Start watching
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Location permission is required to watch location.');
          return;
        }

        const subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 10000, // Update every 10 seconds
            distanceInterval: 10, // Update when moved 10 meters
          },
          (location) => {
            const { latitude, longitude } = location.coords;
            setCurrentCoordinates({ latitude, longitude });
            setLocationAccuracy(location.coords.accuracy);

            // Update selected location for map
            setSelectedLocation(prev => ({
              latitude,
              longitude,
              address: prev?.address || 'Current Location',
            }));
          }
        );

        setLocationSubscription(subscription);
        setIsWatchingLocation(true);
      } catch (error) {
        console.error('Error starting location watching:', error);
        Alert.alert('Error', 'Failed to start location watching.');
      }
    }
  };

  // Cleanup location subscription on unmount
  useEffect(() => {
    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, [locationSubscription]);

  // Validate pricing when property details change
  useEffect(() => {
    if (formData.rent.amount > 0 && formData.address.city && (formData.squareFootage || 0) > 0) {
      const propertyCharacteristics = {
        type: formData.type,
        bedrooms: formData.bedrooms || 0,
        bathrooms: formData.bathrooms || 0,
        squareFootage: formData.squareFootage || 0,
        amenities: formData.amenities || [],
        location: {
          city: formData.address.city,
          state: formData.address.state,
        },
        // Additional comprehensive details
        floor: formData.floor,
        hasElevator: formData.hasElevator,
        parkingSpaces: formData.parkingSpaces,
        yearBuilt: formData.yearBuilt,
        isFurnished: formData.furnishedStatus === 'furnished',
        utilitiesIncluded: formData.utilitiesIncluded,
        petFriendly: formData.petFriendly,
        hasBalcony: formData.hasBalcony,
        hasGarden: formData.hasGarden,
        proximityToTransport: formData.proximityToTransport,
        proximityToSchools: formData.proximityToSchools,
        proximityToShopping: formData.proximityToShopping,
      };

      const validation = validateEthicalPricing(formData.rent.amount, propertyCharacteristics);
      setPricingValidation(validation);
    } else {
      setPricingValidation(null);
    }
  }, [
    formData.rent.amount,
    formData.type,
    formData.bedrooms,
    formData.bathrooms,
    formData.squareFootage,
    formData.amenities,
    formData.address.city,
    formData.address.state,
    formData.floor,
    formData.hasElevator,
    formData.parkingSpaces,
    formData.yearBuilt,
    formData.furnishedStatus,
    formData.utilitiesIncluded,
    formData.petFriendly,
    formData.hasBalcony,
    formData.hasGarden,
    formData.proximityToTransport,
    formData.proximityToSchools,
    formData.proximityToShopping,
  ]);

  // Get pricing guidance
  const getCurrentPricingGuidance = () => {
    if (!formData.address.city || (formData.squareFootage || 0) <= 0) {
      return 'Please fill in city and square footage to get pricing guidance.';
    }

    const propertyCharacteristics = {
      type: formData.type,
      bedrooms: formData.bedrooms || 0,
      bathrooms: formData.bathrooms || 0,
      squareFootage: formData.squareFootage || 0,
      amenities: formData.amenities || [],
      location: {
        city: formData.address.city,
        state: formData.address.state,
      },
      // Additional comprehensive details
      floor: formData.floor,
      hasElevator: formData.hasElevator,
      parkingSpaces: formData.parkingSpaces,
      yearBuilt: formData.yearBuilt,
      isFurnished: formData.furnishedStatus === 'furnished',
      utilitiesIncluded: formData.utilitiesIncluded,
      petFriendly: formData.petFriendly,
      hasBalcony: formData.hasBalcony,
      hasGarden: formData.hasGarden,
      proximityToTransport: formData.proximityToTransport,
      proximityToSchools: formData.proximityToSchools,
      proximityToShopping: formData.proximityToShopping,
    };

    return getPricingGuidance(propertyCharacteristics);
  };

  // Search handler
  useEffect(() => {
    // Don't search if this is from map selection
    if (isMapSelectionRef) {
      setIsMapSelectionRef(false);
      return;
    }

    if (searchQuery.length < 3) {
      clearResults();
      setShowSearchResults(false);
      return;
    }

    const timeout = setTimeout(() => {
      search(searchQuery);
      setShowSearchResults(true);
    }, 400);

    return () => clearTimeout(timeout);
  }, [searchQuery, isMapSelectionRef, search, clearResults]);

  const handleSearchSelect = (result: any) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const address = result.display_name;

    setSelectedLocation({ latitude: lat, longitude: lng, address });
    setSearchQueryWithSource(address);
    setShowSearchResults(false);

    // Use structured address data from Nominatim if available
    if (result.address) {
      const addr = result.address;
      updateAddressField('street', `${addr.house_number || ''} ${addr.road || addr.street || ''}`.trim());
      updateAddressField('city', addr.city || addr.town || addr.village || addr.county || '');
      // Prioritize province over state for international addresses
      updateAddressField('state', addr.province || addr.state || '');
      updateAddressField('zipCode', addr.postcode || '');
    } else {
      // Fallback to parsing display_name
      const parsedAddress = parseAddress(address);
      updateAddressField('street', parsedAddress.street);
      updateAddressField('city', parsedAddress.city);
      updateAddressField('state', parsedAddress.state);
      updateAddressField('zipCode', parsedAddress.zipCode);
    }
  };

  const handleLocationSelect = (lat: number, lng: number, address: string) => {
    setSelectedLocation({ latitude: lat, longitude: lng, address });

    // Update search field with the selected address (from map)
    setSearchQueryWithSource(address, true);

    // Hide search results when location is selected on map
    setShowSearchResults(false);

    // Use reverse geocoding (now Zustand-based)
    reverseGeocode(lat, lng);
  };

  // Handle reverse geocoding result
  useEffect(() => {
    if (reverseResult && selectedLocation) {
      if (reverseResult.address) {
        const addr = reverseResult.address;
        updateAddressField('street', `${addr.house_number || ''} ${addr.road || ''}`.trim());
        updateAddressField('city', addr.city || '');
        // Prioritize province over state for international addresses
        updateAddressField('state', addr.state || '');
        updateAddressField('zipCode', addr.postcode || '');
      } else {
        // Fallback to parsing display_name
        const parsedAddress = parseAddress(reverseResult.display_name);
        updateAddressField('street', parsedAddress.street);
        updateAddressField('city', parsedAddress.city);
        updateAddressField('state', parsedAddress.state);
        updateAddressField('zipCode', parsedAddress.zipCode);
      }
    }
  }, [reverseResult, selectedLocation]);

  const handleSubmit = async () => {
    // Reset loading state to ensure clean start
    setErrors({});
    setHasValidationErrors(false);

    // Check if user is authenticated
    if (!oxyServices || !activeSessionId) {
      toast.error('Authentication Required', {
        description: 'Please sign in with OxyServices to create a property.'
      });
      return;
    }

    // Validate form
    if (!validateForm()) {
      toast.error('Validation Errors', {
        description: `Please fix ${Object.keys(errors).length} error(s) before submitting.`
      });

      // Scroll to first error after a short delay to ensure toast is shown
      setTimeout(() => {
        scrollToFirstError();
      }, 500);

      return;
    }

    try {
      // Clean ZIP code before submission
      const cleanedPropertyData = {
        ...formData,
        address: {
          ...formData.address,
          zipCode: cleanZipCode(formData.address.zipCode)
        },
        location: selectedLocation ? {
          latitude: selectedLocation.latitude,
          longitude: selectedLocation.longitude,
        } : undefined,
      };

      const propertyToSubmit = {
        ...cleanedPropertyData,
        housingType: 'private', // Always private for user-created
        layoutType: formData.layoutType,
      };

      const result = await create(propertyToSubmit);

      toast.success('Property Created Successfully', {
        description: 'Your property has been listed successfully!'
      });

      router.push(`/properties/${result._id}`);
    } catch (error: any) {
      console.error('Property creation error:', error, JSON.stringify(error));

      let errorMessage = 'Failed to create property. Please try again.';

      // Handle OxyServices authentication errors specifically
      if (typeof error.message === 'string' && error.message.includes('Authentication')) {
        errorMessage = 'Authentication failed. Please sign in again.';
      } else if (error.status === 401) {
        errorMessage = 'Authentication required. Please sign in with Oxy.';
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (typeof error.message === 'string') {
        errorMessage = error.message;
      } else {
        errorMessage = JSON.stringify(error);
      }

      toast.error('Creation Failed', {
        description: errorMessage
      });
    }
  };

  const updateField = (field: keyof (CreatePropertyData & {
    priceUnit: 'day' | 'night' | 'week' | 'month' | 'year';
    housingType?: 'private' | 'public';
    layoutType?: 'open' | 'shared' | 'partitioned' | 'traditional' | 'studio' | 'other';
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
      maxStay?: number; // For couchsurfing/hostels
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
        communityRent?: number;
        slidingScaleBase?: number;
        slidingScaleMax?: number;
        marketAdjustedRent?: number;
        incomeBasedRent?: number;
        calculations?: {
          monthlyMedianIncome: number;
          rentToIncomeRatio: number;
          standardRentPercentage: number;
          affordableRentPercentage: number;
          communityRentPercentage: number;
        };
      };
    };
  }), value: any) => {
    // If property type is changing, call resetFieldsForType to handle amenities filtering
    if (field === 'type' && value !== formData.type) {
      resetFieldsForType(value);
    } else {
      setLocalFormData(prev => ({
        ...prev,
        [field]: value
      }));
    }
  };

  const updateAddressField = (field: keyof CreatePropertyData['address'], value: string) => {
    setLocalFormData(prev => ({
      ...prev,
      address: {
        ...prev.address,
        [field]: value
      }
    }));
  };

  // Clean ZIP code format before submission
  const cleanZipCode = (zipCode: string): string => {
    // Remove all non-digit and non-hyphen characters, then ensure proper format
    const cleaned = zipCode.replace(/[^\d-]/g, '');

    // If it's just digits, ensure it's 5 digits
    if (/^\d+$/.test(cleaned)) {
      return cleaned.slice(0, 5);
    }

    // If it has a hyphen, ensure it's in format 12345-6789
    if (cleaned.includes('-')) {
      const parts = cleaned.split('-');
      const firstPart = parts[0].slice(0, 5);
      const secondPart = parts[1] ? parts[1].slice(0, 4) : '';
      return secondPart ? `${firstPart}-${secondPart}` : firstPart;
    }

    return cleaned;
  };

  const updateRentField = (field: keyof CreatePropertyData['rent'], value: any) => {
    setLocalFormData(prev => ({
      ...prev,
      rent: { ...prev.rent, [field]: value }
    }));
  };

  const updatePriceUnit = (value: 'day' | 'night' | 'week' | 'month' | 'year') => {
    setLocalFormData(prev => ({
      ...prev,
      priceUnit: value
    }));
  };

  const toggleAmenity = (amenity: string) => {
    setLocalFormData(prev => ({
      ...prev,
      amenities: prev.amenities?.includes(amenity)
        ? prev.amenities.filter(a => a !== amenity)
        : [...(prev.amenities || []), amenity]
    }));
  };

  // Auto-save functionality
  useEffect(() => {
    if (!autoSaveEnabled || !isFormValid()) return;

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      saveDraft();
    }, 30000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [formData, autoSaveEnabled]);

  // Save draft to local storage
  const saveDraft = async () => {
    try {
      const draftData = {
        id: `draft_${Date.now()}`,
        title: formData.address.street ? `${formData.address.street}, ${formData.address.city}` : 'Untitled Property',
        address: formData.address,
        type: formData.type,
        rent: formData.rent,
        lastSaved: new Date(), // Ensure it's always a Date object
        isDraft: true,
        formData: {
          ...formData,
          lastSaved: new Date(), // Ensure it's always a Date object in formData too
        },
      };

      console.log('Auto-saving draft:', draftData);

      // Get existing drafts
      const existingDraftsData = await AsyncStorage.getItem('property_drafts');
      const existingDrafts = existingDraftsData ? JSON.parse(existingDraftsData) : [];

      // Check if this is an update to an existing draft (same address and type)
      const existingDraftIndex = existingDrafts.findIndex((draft: any) =>
        draft.address.street === formData.address.street &&
        draft.address.city === formData.address.city &&
        draft.type === formData.type
      );

      if (existingDraftIndex !== -1) {
        // Update existing draft
        existingDrafts[existingDraftIndex] = draftData;
      } else {
        // Add new draft
        existingDrafts.push(draftData);
      }

      // Save updated drafts
      await AsyncStorage.setItem('property_drafts', JSON.stringify(existingDrafts));

      setLocalFormData(prev => ({
        ...prev,
        lastSaved: new Date(),
      }));

      console.log('Draft saved successfully');
    } catch (error) {
      console.error('Error saving draft:', error);
    }
  };

  // Manual save draft function
  const handleSaveDraft = async () => {
    try {
      setSavingDraft(true);
      await saveDraft();
      toast.success('Draft saved successfully');

      // Show brief success message
      setDraftSavedMessage(true);
      setTimeout(() => {
        setDraftSavedMessage(false);
      }, 2000);
    } catch (error) {
      console.error('Error saving draft:', error);
      toast.error('Failed to save draft');
    } finally {
      setSavingDraft(false);
    }
  };

  // Load draft from local storage
  const loadDraft = async () => {
    try {
      console.log('Loading draft...');
      const currentDraftData = await AsyncStorage.getItem('current_draft');
      if (currentDraftData) {
        const draftData = JSON.parse(currentDraftData);

        // Convert lastSaved string back to Date object
        if (draftData.lastSaved && typeof draftData.lastSaved === 'string') {
          draftData.lastSaved = new Date(draftData.lastSaved);
        }

        setLocalFormData(draftData);
        console.log('Draft loaded successfully');

        // Clear the current draft from storage after loading
        await AsyncStorage.removeItem('current_draft');
      }
    } catch (error) {
      console.error('Error loading draft:', error);
    }
  };

  // Clear draft
  const clearDraft = async () => {
    try {
      // In a real app, you'd clear from backend or local storage
      console.log('Clearing draft...');
      setLocalFormData(prev => ({
        ...prev,
        isDraft: false,
      }));
      console.log('Draft cleared successfully');
    } catch (error) {
      console.error('Error clearing draft:', error);
    }
  };

  const calculateEthicalPricing = async () => {
    const { localMedianIncome, areaAverageRent } = formData.rent;

    if (!localMedianIncome || !areaAverageRent) {
      toast.error('Missing Data', {
        description: 'Please enter both local median income and area average rent to calculate ethical pricing.'
      });
      return;
    }

    if (localMedianIncome <= 0 || areaAverageRent <= 0) {
      toast.error('Invalid Data', {
        description: 'Please enter valid positive numbers for income and rent data.'
      });
      return;
    }

    try {
      // Call the backend API for ethical pricing calculation
      const response: EthicalPricingResponse = await propertyService.calculateEthicalPricing({
        localMedianIncome,
        areaAverageRent,
        propertyType: formData.type,
        bedrooms: formData.bedrooms,
        bathrooms: formData.bathrooms,
        squareFootage: formData.squareFootage,
      });

      if (response.success) {
        const { suggestions, marketContext, warnings, calculations } = response.data;

        // Update form with suggestions
        updateField('rent', {
          ...formData.rent,
          ethicalPricingSuggestions: {
            ...suggestions,
            calculations
          }
        });

        // Show warnings if any
        if (warnings.length > 0) {
          warnings.forEach(warning => {
            toast.warning('Market Rate Warning', {
              description: warning
            });
          });
        }

        // Show success message with market context
        toast.success('Ethical Pricing Calculated', {
          description: `Based on local data ($${localMedianIncome.toLocaleString()}/year median income, ${marketContext}):\n\n` +
            `• Standard Rent: $${suggestions.standardRent.toLocaleString()}/month\n` +
            `• Affordable Rent: $${suggestions.affordableRent.toLocaleString()}/month\n` +
            `• Market-Adjusted: $${suggestions.marketAdjustedRent.toLocaleString()}/month\n` +
            `• Income-Based: $${suggestions.incomeBasedRent.toLocaleString()}/month\n` +
            `• Market Rate: $${suggestions.marketRate.toLocaleString()}/month\n` +
            `• Reduced Deposit: $${suggestions.reducedDeposit.toLocaleString()}`
        });
      } else {
        toast.error('Calculation Failed', {
          description: 'Failed to calculate ethical pricing. Please try again.'
        });
      }
    } catch (error) {
      console.error('Error calculating ethical pricing:', error);
      toast.error('Calculation Error', {
        description: 'Failed to calculate ethical pricing. Please check your data and try again.'
      });
    }
  };

  // Error handling and validation functions
  const setFieldError = (fieldName: string, errorMessage: string) => {
    setErrors(prev => ({
      ...prev,
      [fieldName]: errorMessage
    }));
    setHasValidationErrors(true);
  };

  const clearFieldError = (fieldName: string) => {
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });
    setHasValidationErrors(Object.keys(errors).length > 1);
  };

  const clearAllErrors = () => {
    setErrors({});
    setHasValidationErrors(false);
  };

  const scrollToField = (fieldName: string) => {
    if (fieldRefs.current[fieldName]) {
      fieldRefs.current[fieldName].measureLayout(
        scrollViewRef.current?.getInnerViewNode(),
        (x: number, y: number) => {
          scrollViewRef.current?.scrollTo({
            y: y - 100, // Offset to show some context above the field
            animated: true
          });
        },
        () => {
          // Fallback if measureLayout fails
          console.warn(`Could not measure layout for field: ${fieldName}`);
        }
      );
    }
  };

  const scrollToFirstError = () => {
    const firstErrorField = Object.keys(errors)[0];
    if (firstErrorField) {
      scrollToField(firstErrorField);
    }
  };

  const validateForm = () => {
    clearAllErrors();
    const newErrors: { [key: string]: string } = {};

    // Basic required fields for all types
    if (!formData.address.street.trim()) {
      newErrors['address.street'] = 'Street address is required';
    }
    if (!formData.address.city.trim()) {
      newErrors['address.city'] = 'City is required';
    }
    if (!formData.address.state.trim()) {
      newErrors['address.state'] = 'State is required';
    }
    if (!formData.address.zipCode.trim()) {
      newErrors['address.zipCode'] = 'ZIP code is required';
    }

    // Accommodation type-specific validation
    switch (formData.type) {
      case 'apartment':
      case 'house':
      case 'room':
      case 'studio':
        // Standard rental validation
        if (formData.rent.amount <= 0) {
          newErrors['rent.amount'] = 'Rent amount must be greater than 0';
        }
        if ((formData.squareFootage || 0) <= 0) {
          newErrors['squareFootage'] = 'Square footage is required';
        }
        break;

      case 'couchsurfing':
        // Couchsurfing can be free
        if (formData.rent.amount < 0) {
          newErrors['rent.amount'] = 'Contribution cannot be negative';
        }
        if (!formData.accommodationDetails?.maxStay || formData.accommodationDetails.maxStay <= 0) {
          newErrors['accommodationDetails.maxStay'] = 'Maximum stay is required';
        }
        break;

      case 'hostel':
      case 'guesthouse':
      case 'campsite':
        // Daily pricing validation
        if (formData.rent.amount < 0) {
          newErrors['rent.amount'] = 'Price cannot be negative';
        }
        if (formData.rent.amount > 0 && formData.rent.amount < 10) {
          newErrors['rent.amount'] = 'Price seems too low for this type of accommodation';
        }
        break;

      case 'roommates':
      case 'coliving':
        // Shared living validation
        if (formData.rent.amount <= 0) {
          newErrors['rent.amount'] = 'Rent amount must be greater than 0';
        }
        if ((formData.squareFootage || 0) <= 0) {
          newErrors['squareFootage'] = 'Square footage is required';
        }
        break;

      case 'boat':
      case 'treehouse':
      case 'yurt':
      case 'other':
        // Unique accommodation validation
        if (formData.rent.amount <= 0) {
          newErrors['rent.amount'] = 'Rent amount must be greater than 0';
        }
        if ((formData.squareFootage || 0) <= 0) {
          newErrors['squareFootage'] = 'Square footage is required';
        }
        break;
    }

    // Ethical pricing validation for all accommodation types that charge rent
    if (formData.rent.amount > 0 && formData.type !== 'couchsurfing') {
      if (pricingValidation && !pricingValidation.isWithinEthicalRange) {
        newErrors['rent.amount'] = `Rent price exceeds ethical maximum ($${pricingValidation.maxRent})`;
        if (pricingValidation.warnings.length > 0) {
          pricingValidation.warnings.forEach((warning: string) => {
            if (warning.includes('speculative')) {
              newErrors['rent.amount'] = 'Pricing appears to be speculative. Please consider a fair market rate.';
            }
          });
        }
      }
    }

    // Location validation
    if (!selectedLocation && !currentCoordinates) {
      newErrors['location'] = 'Please select a location on the map or use current location';
    }

    // Set errors
    Object.keys(newErrors).forEach(field => {
      setFieldError(field, newErrors[field]);
    });

    return Object.keys(newErrors).length === 0;
  };

  // Reset accommodation-specific fields when property type changes
  const resetFieldsForType = (newType: string) => {
    setLocalFormData(prev => {
      const updates: any = { type: newType };

      // Ensure rent object exists
      const currentRent = prev.rent || {
        amount: 0,
        currency: 'USD',
        paymentFrequency: 'monthly',
        deposit: 0,
        utilities: 'excluded',
        hasIncomeBasedPricing: false,
        hasSlidingScale: false,
        hasUtilitiesIncluded: false,
        hasReducedDeposit: false,
      };

      switch (newType) {
        case 'apartment':
        case 'house':
          // Reset to standard apartment/house defaults
          updates.bedrooms = 1;
          updates.bathrooms = 1;
          updates.layoutType = 'traditional';
          updates.rent = {
            ...currentRent,
            amount: currentRent.amount || 0,
            paymentFrequency: 'monthly',
          };
          updates.priceUnit = 'month';
          break;

        case 'room':
          // Reset to room defaults
          updates.bedrooms = 1;
          updates.bathrooms = 0.5; // Shared bathroom
          updates.layoutType = 'shared';
          updates.rent = {
            ...currentRent,
            amount: currentRent.amount || 0,
            paymentFrequency: 'monthly',
          };
          updates.priceUnit = 'month';
          break;

        case 'studio':
          // Reset to studio defaults
          updates.bedrooms = 0;
          updates.bathrooms = 1;
          updates.layoutType = 'open';
          updates.rent = {
            ...currentRent,
            amount: currentRent.amount || 0,
            paymentFrequency: 'monthly',
          };
          updates.priceUnit = 'month';
          break;

        case 'couchsurfing':
          // Reset to couchsurfing defaults
          updates.bedrooms = 0;
          updates.bathrooms = 0;
          updates.layoutType = 'shared';
          updates.rent = {
            ...currentRent,
            amount: 0, // Free
            paymentFrequency: 'daily',
          };
          updates.priceUnit = 'night';
          updates.accommodationDetails = {
            ...prev.accommodationDetails,
            sleepingArrangement: 'couch',
            culturalExchange: true,
            maxStay: 7,
          };
          break;

        case 'roommates':
          // Reset to roommates defaults
          updates.bedrooms = 1;
          updates.bathrooms = 1;
          updates.layoutType = 'shared';
          updates.rent = {
            ...currentRent,
            amount: currentRent.amount || 0,
            paymentFrequency: 'monthly',
          };
          updates.priceUnit = 'month';
          updates.accommodationDetails = {
            ...prev.accommodationDetails,
            roommatePreferences: [],
          };
          break;

        case 'coliving':
          // Reset to coliving defaults
          updates.bedrooms = 1;
          updates.bathrooms = 1;
          updates.layoutType = 'shared';
          updates.rent = {
            ...currentRent,
            amount: currentRent.amount || 0,
            paymentFrequency: 'monthly',
          };
          updates.priceUnit = 'month';
          updates.accommodationDetails = {
            ...prev.accommodationDetails,
            colivingFeatures: [],
          };
          break;

        case 'hostel':
          // Reset to hostel defaults
          updates.bedrooms = 0;
          updates.bathrooms = 0;
          updates.layoutType = 'shared';
          updates.rent = {
            ...currentRent,
            amount: currentRent.amount || 0,
            paymentFrequency: 'daily',
          };
          updates.priceUnit = 'night';
          updates.accommodationDetails = {
            ...prev.accommodationDetails,
            hostelRoomType: 'dormitory',
            maxStay: 30,
            minAge: 18,
          };
          break;

        case 'guesthouse':
          // Reset to guesthouse defaults
          updates.bedrooms = 1;
          updates.bathrooms = 1;
          updates.layoutType = 'traditional';
          updates.rent = {
            ...currentRent,
            amount: currentRent.amount || 0,
            paymentFrequency: 'daily',
          };
          updates.priceUnit = 'night';
          updates.accommodationDetails = {
            ...prev.accommodationDetails,
            culturalExchange: false,
            mealsIncluded: false,
          };
          break;

        case 'campsite':
          // Reset to campsite defaults
          updates.bedrooms = 0;
          updates.bathrooms = 0;
          updates.layoutType = 'other';
          updates.rent = {
            ...currentRent,
            amount: currentRent.amount || 0,
            paymentFrequency: 'daily',
          };
          updates.priceUnit = 'night';
          updates.accommodationDetails = {
            ...prev.accommodationDetails,
            campsiteType: 'tent_site',
            sleepingArrangement: 'tent',
          };
          break;

        case 'boat':
        case 'treehouse':
        case 'yurt':
          // Reset to unique accommodation defaults
          updates.bedrooms = 1;
          updates.bathrooms = 1;
          updates.layoutType = 'traditional';
          updates.rent = {
            ...currentRent,
            amount: currentRent.amount || 0,
            paymentFrequency: 'monthly',
          };
          updates.priceUnit = 'month';
          break;

        case 'other':
          // Reset to generic defaults
          updates.bedrooms = 1;
          updates.bathrooms = 1;
          updates.layoutType = 'other';
          updates.rent = {
            ...currentRent,
            amount: currentRent.amount || 0,
            paymentFrequency: 'monthly',
          };
          updates.priceUnit = 'month';
          break;
      }

      // Filter amenities to only include those available for the new property type
      const availableAmenities = getAmenitiesByPropertyType(newType);
      const currentAmenities = prev.amenities || [];
      const filteredAmenities = currentAmenities.filter(amenity =>
        availableAmenities.includes(amenity)
      );

      // Only update amenities if there are changes
      if (filteredAmenities.length !== currentAmenities.length) {
        updates.amenities = filteredAmenities;
      }

      // Reset accommodation-specific features based on property type
      const resetAccommodationDetails = () => {
        const currentDetails = prev.accommodationDetails || {};

        // Reset all accommodation-specific features
        const resetDetails: any = {
          sleepingArrangement: undefined,
          roommatePreferences: [],
          colivingFeatures: [],
          hostelRoomType: undefined,
          campsiteType: undefined,
          maxStay: undefined,
          minAge: undefined,
          maxAge: undefined,
          languages: [],
          culturalExchange: false,
          mealsIncluded: false,
          wifiPassword: '',
          houseRules: [],
        };

        // Set property-type specific defaults
        switch (newType) {
          case 'couchsurfing':
            resetDetails.sleepingArrangement = 'couch';
            resetDetails.culturalExchange = true;
            resetDetails.maxStay = 7;
            break;
          case 'roommates':
            resetDetails.roommatePreferences = [];
            resetDetails.minAge = 18;
            break;
          case 'coliving':
            resetDetails.colivingFeatures = [];
            break;
          case 'hostel':
            resetDetails.hostelRoomType = 'dormitory';
            resetDetails.maxStay = 30;
            resetDetails.minAge = 18;
            break;
          case 'guesthouse':
            resetDetails.culturalExchange = false;
            resetDetails.mealsIncluded = false;
            break;
          case 'campsite':
            resetDetails.campsiteType = 'tent_site';
            resetDetails.sleepingArrangement = 'tent';
            break;
        }

        // Only update if there are actual changes
        const hasChanges = JSON.stringify(resetDetails) !== JSON.stringify(currentDetails);
        if (hasChanges) {
          updates.accommodationDetails = resetDetails;
        }
      };

      // Reset accommodation details
      resetAccommodationDetails();

      // Reset advanced features that may not be relevant for certain property types
      const resetAdvancedFeatures = () => {
        switch (newType) {
          case 'couchsurfing':
            // Couchsurfing typically doesn't have traditional property features
            updates.floor = undefined;
            updates.yearBuilt = undefined;
            updates.furnishedStatus = 'unfurnished';
            updates.petPolicy = 'not_allowed';
            updates.petFee = 0;
            updates.parkingType = 'none';
            updates.parkingSpaces = 0;
            break;
          case 'hostel':
            // Hostels may not have individual pet policies or parking
            updates.petPolicy = 'not_allowed';
            updates.petFee = 0;
            updates.parkingType = 'none';
            updates.parkingSpaces = 0;
            break;
          case 'campsite':
            // Campsites don't have traditional building features
            updates.floor = undefined;
            updates.yearBuilt = undefined;
            updates.furnishedStatus = 'unfurnished';
            updates.petPolicy = 'case_by_case';
            updates.petFee = 0;
            updates.parkingType = 'assigned';
            updates.parkingSpaces = 1;
            break;
          case 'room':
            // Rooms typically don't have individual parking
            updates.parkingType = 'none';
            updates.parkingSpaces = 0;
            break;
          case 'studio':
            // Studios may not have parking
            updates.parkingType = 'none';
            updates.parkingSpaces = 0;
            break;
        }
      };

      // Reset advanced features
      resetAdvancedFeatures();

      return { ...prev, ...updates };
    });
  };

  useEffect(() => {
    // Only reset if type actually changed
    if (formData.type) {
      resetFieldsForType(formData.type);
    }
  }, [formData.type]); // Only trigger when type changes

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: 'Create Property',
          titlePosition: 'center',
          rightComponents: [
            // Draft indicator
            formData.isDraft && (
              <View key="draft-indicator" style={styles.headerDraftIndicator}>
                <IconComponent name="save" size={16} color={colors.primaryColor} />
                <ThemedText style={styles.headerDraftText}>
                  Draft saved {formData.lastSaved instanceof Date ? formData.lastSaved.toLocaleTimeString() : 'Unknown'}
                </ThemedText>
              </View>
            ),
            // Drafts button
            <TouchableOpacity
              key="drafts"
              style={styles.headerButton}
              onPress={() => router.push('/properties/drafts')}
            >
              <IconComponent name="folder-open" size={24} color={colors.primaryDark} />
            </TouchableOpacity>,
            // Close button
            <TouchableOpacity
              key="close"
              style={styles.headerButton}
              onPress={() => router.back()}
            >
              <IconComponent name="close" size={24} color={colors.primaryDark} />
            </TouchableOpacity>,
          ],
        }}
      />

      {/* Progress Indicator */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: '25%' }]} />
        </View>
        <View style={styles.progressSteps}>
          <View style={[styles.progressStep, styles.progressStepActive]}>
            <View style={[styles.progressStepDot, styles.progressStepDotActive]} />
            <ThemedText style={[styles.progressStepText, styles.progressStepTextActive]}>Location</ThemedText>
          </View>
          <View style={styles.progressStep}>
            <View style={styles.progressStepDot} />
            <ThemedText style={styles.progressStepText}>Details</ThemedText>
          </View>
          <View style={styles.progressStep}>
            <View style={styles.progressStepDot} />
            <ThemedText style={styles.progressStepText}>Pricing</ThemedText>
          </View>
          <View style={styles.progressStep}>
            <View style={styles.progressStepDot} />
            <ThemedText style={styles.progressStepText}>Review</ThemedText>
          </View>
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.form}>
          {/* Hero Section */}
          <LinearGradient
            colors={[colors.primaryColor, colors.secondaryLight]}
            style={styles.heroSection}
          >
            <View style={styles.heroContent}>
              <ThemedText style={styles.heroTitle}>Create Your Property</ThemedText>
              <ThemedText style={styles.heroSubtitle}>
                List your property with transparent pricing and ethical standards
              </ThemedText>
            </View>
          </LinearGradient>

          {/* Map Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Location</ThemedText>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Search Address</ThemedText>
              <ThemedText style={styles.subLabel}>
                Search for an address or click on the map to select a location
              </ThemedText>

              {/* Search Input */}
              <View style={styles.searchContainer}>
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQueryWithSource}
                  placeholder="Search for an address..."
                  onFocus={() => {
                    // Only show results if user is actively searching (not from map selection)
                    if (searchResults.length > 0 && searchQuery.length >= 3) {
                      setShowSearchResults(true);
                    }
                  }}
                  onBlur={() => {
                    // Hide results when input loses focus
                    setTimeout(() => setShowSearchResults(false), 200);
                  }}
                />

                {/* Use Current Location Button */}
                <TouchableOpacity
                  style={styles.locationButton}
                  onPress={getCurrentLocation}
                  disabled={isGettingLocation}
                >
                  {isGettingLocation ? (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator size="small" color="white" />
                      <ThemedText style={styles.locationButtonText}>Getting Location...</ThemedText>
                    </View>
                  ) : (
                    <ThemedText style={styles.locationButtonText}>📍 Use Current Location</ThemedText>
                  )}
                </TouchableOpacity>

                {/* Location Permission Status */}
                {locationPermission && (
                  <View style={styles.permissionStatus}>
                    <ThemedText style={[
                      styles.permissionStatusText,
                      locationPermission === 'granted' ? styles.permissionGranted : styles.permissionDenied
                    ]}>
                      {locationPermission === 'granted'
                        ? '✅ Location access granted'
                        : locationPermission === 'denied'
                          ? '❌ Location access denied'
                          : '⏳ Location permission pending'
                      }
                    </ThemedText>
                  </View>
                )}

                {/* Current Coordinates Display */}
                {currentCoordinates && (
                  <View style={styles.coordinatesContainer}>
                    <ThemedText style={styles.coordinatesTitle}>Current Location:</ThemedText>
                    <ThemedText style={styles.coordinatesText}>
                      Lat: {currentCoordinates.latitude.toFixed(6)},
                      Lng: {currentCoordinates.longitude.toFixed(6)}
                    </ThemedText>
                    {locationAccuracy && (
                      <ThemedText style={styles.accuracyText}>
                        Accuracy: ±{locationAccuracy.toFixed(1)} meters
                      </ThemedText>
                    )}

                    {/* Location Watching Toggle */}
                    <TouchableOpacity
                      style={[
                        styles.watchLocationButton,
                        isWatchingLocation && styles.watchLocationButtonActive
                      ]}
                      onPress={toggleLocationWatching}
                    >
                      <ThemedText style={[
                        styles.watchLocationButtonText,
                        isWatchingLocation && styles.watchLocationButtonTextActive
                      ]}>
                        {isWatchingLocation ? '🛑 Stop Tracking' : '📍 Start Tracking'}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Search Results */}
                {showSearchResults && searchResults.length > 0 && (
                  <View style={styles.searchResults}>
                    {searchResults.map((result, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.searchResult}
                        onPress={() => handleSearchSelect(result)}
                      >
                        <ThemedText style={styles.searchResultText}>
                          {result.display_name}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <PropertyMap
                latitude={selectedLocation?.latitude || currentCoordinates?.latitude}
                longitude={selectedLocation?.longitude || currentCoordinates?.longitude}
                address={selectedLocation?.address}
                onLocationSelect={handleLocationSelect}
                height={300}
                interactive={true}
              />

              {errors['location'] && (
                <View style={styles.locationErrorContainer}>
                  <ThemedText style={styles.errorText}>{errors['location']}</ThemedText>
                </View>
              )}
            </View>
          </View>

          {/* Address Details Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Address Details</ThemedText>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Street Address *</ThemedText>
              <TextInput
                ref={(ref) => { fieldRefs.current['address.street'] = ref; }}
                style={[
                  styles.textInput,
                  errors['address.street'] && styles.textInputError
                ]}
                value={formData.address.street}
                onChangeText={(text) => {
                  updateAddressField('street', text);
                  if (errors['address.street']) {
                    clearFieldError('address.street');
                  }
                }}
                placeholder="Enter street address"
              />
              {errors['address.street'] && (
                <ThemedText style={styles.errorText}>{errors['address.street']}</ThemedText>
              )}
            </View>

            <View style={styles.row}>
              <View style={styles.halfInput}>
                <ThemedText style={styles.label}>City *</ThemedText>
                <TextInput
                  ref={(ref) => { fieldRefs.current['address.city'] = ref; }}
                  style={[
                    styles.textInput,
                    errors['address.city'] && styles.textInputError
                  ]}
                  value={formData.address.city}
                  onChangeText={(text) => {
                    updateAddressField('city', text);
                    if (errors['address.city']) {
                      clearFieldError('address.city');
                    }
                  }}
                  placeholder="Enter city"
                />
                {errors['address.city'] && (
                  <ThemedText style={styles.errorText}>{errors['address.city']}</ThemedText>
                )}
              </View>

              <View style={styles.halfInput}>
                <ThemedText style={styles.label}>State *</ThemedText>
                <TextInput
                  ref={(ref) => { fieldRefs.current['address.state'] = ref; }}
                  style={[
                    styles.textInput,
                    errors['address.state'] && styles.textInputError
                  ]}
                  value={formData.address.state}
                  onChangeText={(text) => {
                    updateAddressField('state', text);
                    if (errors['address.state']) {
                      clearFieldError('address.state');
                    }
                  }}
                  placeholder="Enter state"
                />
                {errors['address.state'] && (
                  <ThemedText style={styles.errorText}>{errors['address.state']}</ThemedText>
                )}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>ZIP Code *</ThemedText>
              <TextInput
                ref={(ref) => { fieldRefs.current['address.zipCode'] = ref; }}
                style={[
                  styles.textInput,
                  errors['address.zipCode'] && styles.textInputError
                ]}
                value={formData.address.zipCode}
                onChangeText={(text) => {
                  updateAddressField('zipCode', cleanZipCode(text));
                  if (errors['address.zipCode']) {
                    clearFieldError('address.zipCode');
                  }
                }}
                placeholder="Enter ZIP code"
              />
              {errors['address.zipCode'] && (
                <ThemedText style={styles.errorText}>{errors['address.zipCode']}</ThemedText>
              )}
            </View>
          </View>

          {/* Property Details Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Property Details</ThemedText>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Accommodation Type *</ThemedText>
              <View style={styles.pickerContainer}>
                {([
                  { id: 'apartment', label: 'Apartment', icon: 'business-outline' },
                  { id: 'house', label: 'House', icon: 'home-outline' },
                  { id: 'room', label: 'Room', icon: 'bed-outline' },
                  { id: 'studio', label: 'Studio', icon: 'home-outline' },
                  { id: 'couchsurfing', label: 'Couchsurfing', icon: 'people-outline' },
                  { id: 'roommates', label: 'Roommates', icon: 'people-circle-outline' },
                  { id: 'coliving', label: 'Co-Living', icon: 'home-outline' },
                  { id: 'hostel', label: 'Hostel', icon: 'bed-outline' },
                  { id: 'guesthouse', label: 'Guesthouse', icon: 'home-outline' },
                  { id: 'campsite', label: 'Campsite', icon: 'leaf-outline' },
                  { id: 'boat', label: 'Boat/Houseboat', icon: 'boat-outline' },
                  { id: 'treehouse', label: 'Treehouse', icon: 'leaf-outline' },
                  { id: 'yurt', label: 'Yurt/Tent', icon: 'home-outline' },
                  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' }
                ] as const).map((type) => (
                  <TouchableOpacity
                    key={type.id}
                    style={[
                      styles.pickerOption,
                      formData.type === type.id && styles.pickerOptionSelected
                    ]}
                    onPress={() => updateField('type', type.id)}
                  >
                    <IconComponent
                      name={type.icon as any}
                      size={16}
                      color={formData.type === type.id ? colors.primaryLight : colors.COLOR_BLACK}
                    />
                    <ThemedText
                      style={[
                        styles.pickerOptionText,
                        formData.type === type.id && styles.pickerOptionTextSelected
                      ]}
                    >
                      {type.label}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Bedrooms and Bathrooms - only for apartment, house, room, studio */}
            {(formData.type === 'apartment' || formData.type === 'house') && (
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <ThemedText style={styles.label}>Bedrooms</ThemedText>
                  <View style={styles.pickerContainer}>
                    {[1, 2, 3, 4, 5].map((num) => (
                      <TouchableOpacity
                        key={num}
                        style={[
                          styles.pickerOption,
                          formData.bedrooms === num && styles.pickerOptionSelected
                        ]}
                        onPress={() => updateField('bedrooms', num)}
                      >
                        <ThemedText
                          style={[
                            styles.pickerOptionText,
                            formData.bedrooms === num && styles.pickerOptionTextSelected
                          ]}
                        >
                          {num}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.halfInput}>
                  <ThemedText style={styles.label}>Bathrooms</ThemedText>
                  <View style={styles.pickerContainer}>
                    {[1, 1.5, 2, 2.5, 3].map((num) => (
                      <TouchableOpacity
                        key={num}
                        style={[
                          styles.pickerOption,
                          formData.bathrooms === num && styles.pickerOptionSelected
                        ]}
                        onPress={() => updateField('bathrooms', num)}
                      >
                        <ThemedText
                          style={[
                            styles.pickerOptionText,
                            formData.bathrooms === num && styles.pickerOptionTextSelected
                          ]}
                        >
                          {num}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {/* Room-specific fields */}
            {formData.type === 'room' && (
              <>
                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Room Type</ThemedText>
                  <View style={styles.pickerContainer}>
                    {(['private', 'shared'] as const).map((roomType) => (
                      <TouchableOpacity
                        key={roomType}
                        style={[
                          styles.pickerOption,
                          formData.layoutType === roomType && styles.pickerOptionSelected
                        ]}
                        onPress={() => updateField('layoutType', roomType)}
                      >
                        <ThemedText
                          style={[
                            styles.pickerOptionText,
                            formData.layoutType === roomType && styles.pickerOptionTextSelected
                          ]}
                        >
                          {roomType.charAt(0).toUpperCase() + roomType.slice(1)} Room
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Bathroom Access</ThemedText>
                  <View style={styles.pickerContainer}>
                    {(['private', 'shared'] as const).map((bathroomType) => (
                      <TouchableOpacity
                        key={bathroomType}
                        style={[
                          styles.pickerOption,
                          formData.bathrooms === (bathroomType === 'private' ? 1 : 0.5) && styles.pickerOptionSelected
                        ]}
                        onPress={() => updateField('bathrooms', bathroomType === 'private' ? 1 : 0.5)}
                      >
                        <ThemedText
                          style={[
                            styles.pickerOptionText,
                            formData.bathrooms === (bathroomType === 'private' ? 1 : 0.5) && styles.pickerOptionTextSelected
                          ]}
                        >
                          {bathroomType.charAt(0).toUpperCase() + bathroomType.slice(1)} Bathroom
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </>
            )}

            {/* Studio-specific fields */}
            {formData.type === 'studio' && (
              <>
                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Studio Layout</ThemedText>
                  <View style={styles.pickerContainer}>
                    {(['open', 'partitioned'] as const).map((layout) => (
                      <TouchableOpacity
                        key={layout}
                        style={[
                          styles.pickerOption,
                          formData.layoutType === layout && styles.pickerOptionSelected
                        ]}
                        onPress={() => updateField('layoutType', layout)}
                      >
                        <ThemedText
                          style={[
                            styles.pickerOptionText,
                            formData.layoutType === layout && styles.pickerOptionTextSelected
                          ]}
                        >
                          {layout.charAt(0).toUpperCase() + layout.slice(1)} Layout
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Bathrooms</ThemedText>
                  <View style={styles.pickerContainer}>
                    {[1, 1.5, 2].map((num) => (
                      <TouchableOpacity
                        key={num}
                        style={[
                          styles.pickerOption,
                          formData.bathrooms === num && styles.pickerOptionSelected
                        ]}
                        onPress={() => updateField('bathrooms', num)}
                      >
                        <ThemedText
                          style={[
                            styles.pickerOptionText,
                            formData.bathrooms === num && styles.pickerOptionTextSelected
                          ]}
                        >
                          {num}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </>
            )}

            {/* Square footage - hidden for couchsurfing, campsite */}
            {formData.type !== 'couchsurfing' && formData.type !== 'campsite' && (
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>
                  {formData.type === 'room' ? 'Room Size (sq ft)' :
                    formData.type === 'studio' ? 'Studio Size (sq ft)' :
                      'Square Footage'}
                </ThemedText>
                <TextInput
                  style={styles.textInput}
                  value={formData.squareFootage?.toString() || ''}
                  onChangeText={(text) => updateField('squareFootage', parseInt(text) || 0)}
                  placeholder={`Enter ${formData.type} size`}
                  keyboardType="numeric"
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Description</ThemedText>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={formData.description}
                onChangeText={(text) => updateField('description', text)}
                placeholder={`Describe your ${formData.type}...`}
                multiline
                numberOfLines={4}
              />
            </View>
          </View>

          {/* Advanced Property Features Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Advanced Features</ThemedText>
            </View>

            <View style={styles.row}>
              <View style={styles.halfInput}>
                <ThemedText style={styles.label}>Floor/Level</ThemedText>
                <TextInput
                  style={styles.textInput}
                  value={formData.floor?.toString() || ''}
                  onChangeText={(text) => updateField('floor', parseInt(text) || undefined)}
                  placeholder="e.g., 3"
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.halfInput}>
                <ThemedText style={styles.label}>Year Built</ThemedText>
                <TextInput
                  style={styles.textInput}
                  value={formData.yearBuilt?.toString() || ''}
                  onChangeText={(text) => updateField('yearBuilt', parseInt(text) || undefined)}
                  placeholder="e.g., 2020"
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Furnished Status</ThemedText>
              <View style={styles.pickerContainer}>
                {(['furnished', 'unfurnished', 'partially_furnished'] as const).map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.pickerOption,
                      formData.furnishedStatus === status && styles.pickerOptionSelected
                    ]}
                    onPress={() => updateField('furnishedStatus', status)}
                  >
                    <ThemedText
                      style={[
                        styles.pickerOptionText,
                        formData.furnishedStatus === status && styles.pickerOptionTextSelected
                      ]}
                    >
                      {status.replace('_', ' ').charAt(0).toUpperCase() + status.replace('_', ' ').slice(1)}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Pet Policy</ThemedText>
              <View style={styles.pickerContainer}>
                {(['allowed', 'not_allowed', 'case_by_case'] as const).map((policy) => (
                  <TouchableOpacity
                    key={policy}
                    style={[
                      styles.pickerOption,
                      formData.petPolicy === policy && styles.pickerOptionSelected
                    ]}
                    onPress={() => updateField('petPolicy', policy)}
                  >
                    <ThemedText
                      style={[
                        styles.pickerOptionText,
                        formData.petPolicy === policy && styles.pickerOptionTextSelected
                      ]}
                    >
                      {policy.replace('_', ' ').charAt(0).toUpperCase() + policy.replace('_', ' ').slice(1)}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {formData.petPolicy === 'allowed' && (
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Pet Fee (per month)</ThemedText>
                <TextInput
                  style={styles.textInput}
                  value={formData.petFee?.toString() || ''}
                  onChangeText={(text) => updateField('petFee', parseFloat(text) || 0)}
                  placeholder="e.g., 50"
                  keyboardType="numeric"
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Parking</ThemedText>
              <View style={styles.pickerContainer}>
                {(['none', 'street', 'assigned', 'garage'] as const).map((parking) => (
                  <TouchableOpacity
                    key={parking}
                    style={[
                      styles.pickerOption,
                      formData.parkingType === parking && styles.pickerOptionSelected
                    ]}
                    onPress={() => updateField('parkingType', parking)}
                  >
                    <ThemedText
                      style={[
                        styles.pickerOptionText,
                        formData.parkingType === parking && styles.pickerOptionTextSelected
                      ]}
                    >
                      {parking.charAt(0).toUpperCase() + parking.slice(1)}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {formData.parkingType !== 'none' && (
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Number of Parking Spaces</ThemedText>
                <View style={styles.pickerContainer}>
                  {[1, 2, 3, 4].map((num) => (
                    <TouchableOpacity
                      key={num}
                      style={[
                        styles.pickerOption,
                        formData.parkingSpaces === num && styles.pickerOptionSelected
                      ]}
                      onPress={() => updateField('parkingSpaces', num)}
                    >
                      <ThemedText
                        style={[
                          styles.pickerOptionText,
                          formData.parkingSpaces === num && styles.pickerOptionTextSelected
                        ]}
                      >
                        {num}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* Pricing Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Rental Pricing</ThemedText>
            </View>

            <View style={styles.row}>
              <View style={styles.halfInput}>
                <ThemedText style={styles.label}>
                  {formData.type === 'couchsurfing' ? 'Contribution (Optional)' :
                    formData.type === 'hostel' || formData.type === 'guesthouse' || formData.type === 'campsite' ? 'Price per Night ($)' :
                      'Monthly Rent ($)'}
                </ThemedText>
                <TextInput
                  ref={(ref) => { fieldRefs.current['rent.amount'] = ref; }}
                  style={[
                    styles.textInput,
                    (errors['rent.amount'] || (pricingValidation && !pricingValidation.isWithinEthicalRange)) && styles.textInputError
                  ]}
                  value={formData.rent.amount.toString()}
                  onChangeText={(text) => {
                    updateField('rent', { ...formData.rent, amount: parseFloat(text) || 0 });
                    if (errors['rent.amount']) {
                      clearFieldError('rent.amount');
                    }
                  }}
                  keyboardType="numeric"
                  placeholder={formData.type === 'couchsurfing' ? "0 (Free)" : "0"}
                />
                {errors['rent.amount'] && (
                  <ThemedText style={styles.errorText}>{errors['rent.amount']}</ThemedText>
                )}
                {formData.type === 'couchsurfing' && (
                  <ThemedText style={styles.subLabel}>
                    Couchsurfing is typically free, but you can ask for a small contribution
                  </ThemedText>
                )}
              </View>

              <View style={styles.halfInput}>
                <ThemedText style={styles.label}>
                  {formData.type === 'couchsurfing' ? 'Max Stay (Days)' :
                    formData.type === 'hostel' || formData.type === 'guesthouse' || formData.type === 'campsite' ? 'Security Deposit ($)' :
                      'Security Deposit ($)'}
                </ThemedText>
                {formData.type === 'couchsurfing' ? (
                  <TextInput
                    ref={(ref) => { fieldRefs.current['accommodationDetails.maxStay'] = ref; }}
                    style={styles.textInput}
                    value={(formData.accommodationDetails?.maxStay || 0).toString()}
                    onChangeText={(text) => updateField('accommodationDetails', {
                      ...formData.accommodationDetails,
                      maxStay: parseInt(text) || 0
                    })}
                    keyboardType="numeric"
                    placeholder="7"
                  />
                ) : (
                  <TextInput
                    ref={(ref) => { fieldRefs.current['rent.deposit'] = ref; }}
                    style={[
                      styles.textInput,
                      errors['rent.deposit'] && styles.textInputError
                    ]}
                    value={(formData.rent.deposit || 0).toString()}
                    onChangeText={(text) => {
                      updateField('rent', { ...formData.rent, deposit: parseFloat(text) || 0 });
                      if (errors['rent.deposit']) {
                        clearFieldError('rent.deposit');
                      }
                    }}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                )}
                {errors['rent.deposit'] && (
                  <ThemedText style={styles.errorText}>{errors['rent.deposit']}</ThemedText>
                )}
              </View>
            </View>

            {/* Pricing Validation Display */}
            {pricingValidation && (
              <View style={[
                styles.pricingValidationContainer,
                pricingValidation.isWithinEthicalRange ? styles.pricingValidationGood : styles.pricingValidationWarning
              ]}>
                <ThemedText style={styles.pricingValidationText}>
                  {pricingValidation.isWithinEthicalRange
                    ? `✅ Pricing is within ethical range (max: $${pricingValidation.maxRent})`
                    : `⚠️ Pricing exceeds ethical maximum (max: $${pricingValidation.maxRent})`
                  }
                </ThemedText>
                {pricingValidation.warnings && pricingValidation.warnings.length > 0 && (
                  <View style={styles.pricingWarningsContainer}>
                    {pricingValidation.warnings.map((warning: string, index: number) => (
                      <ThemedText key={index} style={styles.pricingWarningText}>
                        • {warning}
                      </ThemedText>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Pricing Guidance */}
            <View style={styles.inputGroup}>
              <TouchableOpacity
                style={styles.pricingGuidanceButton}
                onPress={() => setShowPricingGuidance(!showPricingGuidance)}
              >
                <ThemedText style={styles.pricingGuidanceButtonText}>
                  💡 Get Pricing Guidance
                </ThemedText>
              </TouchableOpacity>

              {showPricingGuidance && (
                <View style={styles.pricingGuidanceContainer}>
                  <ThemedText style={styles.pricingGuidanceText}>
                    {getCurrentPricingGuidance()}
                  </ThemedText>
                </View>
              )}
            </View>

            {/* Ethical Pricing Calculator */}
            <View style={styles.ethicalPricingSection}>
              <View style={styles.ethicalPricingHeader}>
                <IconComponent name="heart" size={20} color={colors.primaryColor} />
                <ThemedText style={styles.ethicalPricingTitle}>Ethical Pricing Calculator</ThemedText>
              </View>

              <View style={styles.ethicalPricingContent}>
                <ThemedText style={styles.ethicalPricingDescription}>
                  Set fair, community-focused pricing based on local economic data. This ensures your property is accessible to the community while maintaining sustainable returns.
                </ThemedText>

                <View style={styles.row}>
                  <View style={styles.halfInput}>
                    <ThemedText style={styles.label}>Local Median Income ($/year)</ThemedText>
                    <TextInput
                      style={styles.textInput}
                      value={(formData.rent.localMedianIncome || 0).toString()}
                      onChangeText={(text) => {
                        const value = parseFloat(text) || 0;
                        updateField('rent', { ...formData.rent, localMedianIncome: value });
                        if (errors['rent.localMedianIncome']) {
                          clearFieldError('rent.localMedianIncome');
                        }
                      }}
                      keyboardType="numeric"
                      placeholder="e.g., 75000"
                    />
                  </View>

                  <View style={styles.halfInput}>
                    <ThemedText style={styles.label}>Area Average Rent ($/month)</ThemedText>
                    <TextInput
                      style={styles.textInput}
                      value={(formData.rent.areaAverageRent || 0).toString()}
                      onChangeText={(text) => {
                        const value = parseFloat(text) || 0;
                        updateField('rent', { ...formData.rent, areaAverageRent: value });
                        if (errors['rent.areaAverageRent']) {
                          clearFieldError('rent.areaAverageRent');
                        }
                      }}
                      keyboardType="numeric"
                      placeholder="e.g., 2000"
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.calculateEthicalButton}
                  onPress={calculateEthicalPricing}
                >
                  <IconComponent name="calculator" size={16} color="white" />
                  <ThemedText style={styles.calculateEthicalButtonText}>
                    Calculate Ethical Pricing
                  </ThemedText>
                </TouchableOpacity>

                {/* Display Ethical Pricing Suggestions */}
                {formData.rent.ethicalPricingSuggestions && (
                  <View style={styles.ethicalSuggestionsContainer}>
                    <ThemedText style={styles.ethicalSuggestionsTitle}>
                      💚 Ethical Pricing Suggestions
                    </ThemedText>

                    <View style={styles.ethicalSuggestionsGrid}>
                      <View style={styles.ethicalSuggestionCard}>
                        <ThemedText style={styles.ethicalSuggestionLabel}>Standard Rent</ThemedText>
                        <ThemedText style={styles.ethicalSuggestionValue}>
                          ${formData.rent.ethicalPricingSuggestions.standardRent?.toLocaleString()}/month
                        </ThemedText>
                        <ThemedText style={styles.ethicalSuggestionDesc}>
                          {formData.rent.ethicalPricingSuggestions.calculations?.standardRentPercentage || '40'}% of monthly median income
                        </ThemedText>
                      </View>

                      <View style={styles.ethicalSuggestionCard}>
                        <ThemedText style={styles.ethicalSuggestionLabel}>Affordable Rent</ThemedText>
                        <ThemedText style={styles.ethicalSuggestionValue}>
                          ${formData.rent.ethicalPricingSuggestions.affordableRent?.toLocaleString()}/month
                        </ThemedText>
                        <ThemedText style={styles.ethicalSuggestionDesc}>
                          {formData.rent.ethicalPricingSuggestions.calculations?.affordableRentPercentage || '35'}% of monthly median income
                        </ThemedText>
                      </View>

                      <View style={styles.ethicalSuggestionCard}>
                        <ThemedText style={styles.ethicalSuggestionLabel}>Market-Adjusted</ThemedText>
                        <ThemedText style={styles.ethicalSuggestionValue}>
                          ${formData.rent.ethicalPricingSuggestions.marketAdjustedRent?.toLocaleString()}/month
                        </ThemedText>
                        <ThemedText style={styles.ethicalSuggestionDesc}>
                          90% of market rate or 70% of income
                        </ThemedText>
                      </View>

                      <View style={styles.ethicalSuggestionCard}>
                        <ThemedText style={styles.ethicalSuggestionLabel}>Income-Based</ThemedText>
                        <ThemedText style={styles.ethicalSuggestionValue}>
                          ${formData.rent.ethicalPricingSuggestions.incomeBasedRent?.toLocaleString()}/month
                        </ThemedText>
                        <ThemedText style={styles.ethicalSuggestionDesc}>
                          70% of monthly median income
                        </ThemedText>
                      </View>

                      <View style={styles.ethicalSuggestionCard}>
                        <ThemedText style={styles.ethicalSuggestionLabel}>Community Rent</ThemedText>
                        <ThemedText style={styles.ethicalSuggestionValue}>
                          ${formData.rent.ethicalPricingSuggestions.communityRent?.toLocaleString()}/month
                        </ThemedText>
                        <ThemedText style={styles.ethicalSuggestionDesc}>
                          {formData.rent.ethicalPricingSuggestions.calculations?.communityRentPercentage || '30'}% of monthly median income
                        </ThemedText>
                      </View>

                      <View style={styles.ethicalSuggestionCard}>
                        <ThemedText style={styles.ethicalSuggestionLabel}>Sliding Scale</ThemedText>
                        <ThemedText style={styles.ethicalSuggestionValue}>
                          ${formData.rent.ethicalPricingSuggestions.slidingScaleBase?.toLocaleString()} - ${formData.rent.ethicalPricingSuggestions.slidingScaleMax?.toLocaleString()}/month
                        </ThemedText>
                        <ThemedText style={styles.ethicalSuggestionDesc}>
                          {(formData.rent.ethicalPricingSuggestions.calculations?.communityRentPercentage || 30) - 10}-{(formData.rent.ethicalPricingSuggestions.calculations?.standardRentPercentage || 40) + 10}% of monthly median income
                        </ThemedText>
                      </View>

                      <View style={styles.ethicalSuggestionCard}>
                        <ThemedText style={styles.ethicalSuggestionLabel}>Market Rate</ThemedText>
                        <ThemedText style={styles.ethicalSuggestionValue}>
                          ${formData.rent.ethicalPricingSuggestions.marketRate?.toLocaleString()}/month
                        </ThemedText>
                        <ThemedText style={styles.ethicalSuggestionDesc}>
                          Area average rent
                        </ThemedText>
                      </View>

                      <View style={styles.ethicalSuggestionCard}>
                        <ThemedText style={styles.ethicalSuggestionLabel}>Reduced Deposit</ThemedText>
                        <ThemedText style={styles.ethicalSuggestionValue}>
                          ${formData.rent.ethicalPricingSuggestions.reducedDeposit?.toLocaleString()}
                        </ThemedText>
                        <ThemedText style={styles.ethicalSuggestionDesc}>
                          One month of standard rent
                        </ThemedText>
                      </View>
                    </View>

                    <View style={styles.ethicalPricingBenefits}>
                      <ThemedText style={styles.ethicalPricingBenefitsTitle}>
                        Benefits of Ethical Pricing:
                      </ThemedText>
                      <View style={styles.ethicalPricingBenefitsList}>
                        <ThemedText style={styles.ethicalPricingBenefit}>• Ensures housing accessibility for the community</ThemedText>
                        <ThemedText style={styles.ethicalPricingBenefit}>• Reduces tenant turnover and vacancy periods</ThemedText>
                        <ThemedText style={styles.ethicalPricingBenefit}>• Builds trust and long-term relationships</ThemedText>
                        <ThemedText style={styles.ethicalPricingBenefit}>• Supports sustainable community development</ThemedText>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </View>

            {/* Accommodation-Specific Details Section */}
            {(formData.type === 'couchsurfing' || formData.type === 'roommates' || formData.type === 'coliving' ||
              formData.type === 'hostel' || formData.type === 'guesthouse' || formData.type === 'campsite') && (
                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeader}>
                    <ThemedText style={styles.sectionTitle}>
                      {formData.type === 'couchsurfing' ? 'Couchsurfing Details' :
                        formData.type === 'roommates' ? 'Roommate Preferences' :
                          formData.type === 'coliving' ? 'Co-Living Features' :
                            formData.type === 'hostel' ? 'Hostel Details' :
                              formData.type === 'guesthouse' ? 'Guesthouse Details' :
                                'Campsite Details'}
                    </ThemedText>
                  </View>

                  {/* Cultural Exchange */}
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Cultural Exchange</ThemedText>
                    <View style={styles.pickerContainer}>
                      <TouchableOpacity
                        style={[
                          styles.pickerOption,
                          formData.accommodationDetails?.culturalExchange && styles.pickerOptionSelected
                        ]}
                        onPress={() => updateField('accommodationDetails', {
                          ...formData.accommodationDetails,
                          culturalExchange: !formData.accommodationDetails?.culturalExchange
                        })}
                      >
                        <IconComponent
                          name="heart-outline"
                          size={16}
                          color={formData.accommodationDetails?.culturalExchange ? colors.primaryLight : colors.COLOR_BLACK}
                        />
                        <ThemedText
                          style={[
                            styles.pickerOptionText,
                            formData.accommodationDetails?.culturalExchange && styles.pickerOptionTextSelected
                          ]}
                        >
                          Cultural Exchange Welcome
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Languages */}
                  {(formData.type === 'couchsurfing' || formData.type === 'hostel' || formData.type === 'guesthouse') && (
                    <View style={styles.inputGroup}>
                      <ThemedText style={styles.label}>Languages Spoken</ThemedText>
                      <View style={styles.pickerContainer}>
                        {([
                          'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
                          'Chinese', 'Japanese', 'Korean', 'Arabic', 'Russian', 'Hindi'
                        ] as const).map((language) => (
                          <TouchableOpacity
                            key={language}
                            style={[
                              styles.pickerOption,
                              formData.accommodationDetails?.languages?.includes(language) && styles.pickerOptionSelected
                            ]}
                            onPress={() => {
                              const current = formData.accommodationDetails?.languages || [];
                              const updated = current.includes(language)
                                ? current.filter(l => l !== language)
                                : [...current, language];
                              updateField('accommodationDetails', {
                                ...formData.accommodationDetails,
                                languages: updated
                              });
                            }}
                          >
                            <ThemedText
                              style={[
                                styles.pickerOptionText,
                                formData.accommodationDetails?.languages?.includes(language) && styles.pickerOptionTextSelected
                              ]}
                            >
                              {language}
                            </ThemedText>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Meals Included */}
                  {(formData.type === 'couchsurfing' || formData.type === 'hostel' || formData.type === 'guesthouse') && (
                    <View style={styles.inputGroup}>
                      <ThemedText style={styles.label}>Meals Included</ThemedText>
                      <View style={styles.pickerContainer}>
                        <TouchableOpacity
                          style={[
                            styles.pickerOption,
                            formData.accommodationDetails?.mealsIncluded && styles.pickerOptionSelected
                          ]}
                          onPress={() => updateField('accommodationDetails', {
                            ...formData.accommodationDetails,
                            mealsIncluded: !formData.accommodationDetails?.mealsIncluded
                          })}
                        >
                          <IconComponent
                            name="restaurant-outline"
                            size={16}
                            color={formData.accommodationDetails?.mealsIncluded ? colors.primaryLight : colors.COLOR_BLACK}
                          />
                          <ThemedText
                            style={[
                              styles.pickerOptionText,
                              formData.accommodationDetails?.mealsIncluded && styles.pickerOptionTextSelected
                            ]}
                          >
                            Meals Included
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* Age restrictions */}
                  {(formData.type === 'hostel' || formData.type === 'roommates') && (
                    <View style={styles.row}>
                      <View style={styles.halfInput}>
                        <ThemedText style={styles.label}>Minimum Age</ThemedText>
                        <TextInput
                          style={styles.textInput}
                          value={(formData.accommodationDetails?.minAge || 18).toString()}
                          onChangeText={(text) => updateField('accommodationDetails', {
                            ...formData.accommodationDetails,
                            minAge: parseInt(text) || 18
                          })}
                          keyboardType="numeric"
                          placeholder="18"
                        />
                      </View>

                      <View style={styles.halfInput}>
                        <ThemedText style={styles.label}>Maximum Age</ThemedText>
                        <TextInput
                          style={styles.textInput}
                          value={(formData.accommodationDetails?.maxAge || 0).toString()}
                          onChangeText={(text) => updateField('accommodationDetails', {
                            ...formData.accommodationDetails,
                            maxAge: parseInt(text) || 0
                          })}
                          keyboardType="numeric"
                          placeholder="No limit"
                        />
                      </View>
                    </View>
                  )}

                  {/* WiFi Password */}
                  {(formData.type === 'couchsurfing' || formData.type === 'hostel' || formData.type === 'guesthouse') && (
                    <View style={styles.inputGroup}>
                      <ThemedText style={styles.label}>WiFi Password (Optional)</ThemedText>
                      <TextInput
                        style={styles.textInput}
                        value={formData.accommodationDetails?.wifiPassword || ''}
                        onChangeText={(text) => updateField('accommodationDetails', {
                          ...formData.accommodationDetails,
                          wifiPassword: text
                        })}
                        placeholder="Enter WiFi password"
                        secureTextEntry={true}
                      />
                      <ThemedText style={styles.subLabel}>
                        This will be shared with guests after booking
                      </ThemedText>
                    </View>
                  )}

                  {/* House Rules */}
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>House Rules</ThemedText>
                    <View style={styles.pickerContainer}>
                      {([
                        'No smoking', 'No parties', 'No pets', 'Quiet hours', 'No shoes inside',
                        'Kitchen access', 'Laundry access', 'Cleaning required', 'Respect privacy',
                        'Cultural sensitivity', 'Sustainable practices', 'Community participation'
                      ] as const).map((rule) => (
                        <TouchableOpacity
                          key={rule}
                          style={[
                            styles.pickerOption,
                            formData.accommodationDetails?.houseRules?.includes(rule) && styles.pickerOptionSelected
                          ]}
                          onPress={() => {
                            const current = formData.accommodationDetails?.houseRules || [];
                            const updated = current.includes(rule)
                              ? current.filter(r => r !== rule)
                              : [...current, rule];
                            updateField('accommodationDetails', {
                              ...formData.accommodationDetails,
                              houseRules: updated
                            });
                          }}
                        >
                          <ThemedText
                            style={[
                              styles.pickerOptionText,
                              formData.accommodationDetails?.houseRules?.includes(rule) && styles.pickerOptionTextSelected
                            ]}
                          >
                            {rule}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
              )}

            {/* Amenities Section */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <ThemedText style={styles.sectionTitle}>Amenities & Features</ThemedText>
                <ThemedText style={styles.sectionSubtitle}>
                  Select the amenities and features available at your property
                </ThemedText>
              </View>
              <AmenitiesSelector
                selectedAmenities={formData.amenities || []}
                onAmenityToggle={toggleAmenity}
                propertyType={formData.type}
              />
            </View>

            {/* Property Photos Section */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <ThemedText style={styles.sectionTitle}>Property Photos</ThemedText>
                <ThemedText style={styles.sectionSubtitle}>
                  Add high-quality photos to attract potential tenants
                </ThemedText>
              </View>

              {/* Image Upload Buttons */}
              <View style={styles.imageUploadButtons}>
                <TouchableOpacity style={styles.imageUploadButton} onPress={pickImage}>
                  <IconComponent name="images-outline" size={24} color={colors.primaryColor} />
                  <ThemedText style={styles.imageUploadButtonText}>Choose Photos</ThemedText>
                </TouchableOpacity>

                <TouchableOpacity style={styles.imageUploadButton} onPress={takePhoto}>
                  <IconComponent name="camera-outline" size={24} color={colors.primaryColor} />
                  <ThemedText style={styles.imageUploadButtonText}>Take Photo</ThemedText>
                </TouchableOpacity>
              </View>

              {/* Image Gallery */}
              {formData.images.length > 0 && (
                <View style={styles.imageGallery}>
                  <ThemedText style={styles.imageGalleryTitle}>
                    Photos ({formData.images.length})
                  </ThemedText>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {formData.images.map((image, index) => (
                      <View key={index} style={styles.imageContainer}>
                        <Image source={{ uri: image }} style={styles.propertyImage} />

                        {/* Cover Image Badge */}
                        {index === formData.coverImageIndex && (
                          <View style={styles.coverImageBadge}>
                            <ThemedText style={styles.coverImageBadgeText}>Cover</ThemedText>
                          </View>
                        )}

                        {/* Image Actions */}
                        <View style={styles.imageActions}>
                          <TouchableOpacity
                            style={styles.imageActionButton}
                            onPress={() => setCoverImage(index)}
                          >
                            <IconComponent name="star" size={16} color="white" />
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.imageActionButton, styles.deleteButton]}
                            onPress={() => removeImage(index)}
                          >
                            <IconComponent name="trash" size={16} color="white" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Image Tips */}
              <View style={styles.imageTips}>
                <ThemedText style={styles.imageTipsTitle}>Photo Tips:</ThemedText>
                <ThemedText style={styles.imageTipsText}>
                  • Include photos of all rooms and key features{'\n'}
                  • Use good lighting and clear angles{'\n'}
                  • Show the property at its best{'\n'}
                  • First photo will be the cover image
                </ThemedText>
              </View>
            </View>

            {/* Property Preview - Mobile Only */}
            {screenWidth < 768 && (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <ThemedText style={styles.sectionTitle}>Property Preview</ThemedText>
                </View>

                <View style={styles.previewCard}>
                  {formData.images.length > 0 && (
                    <Image
                      source={{ uri: formData.images[formData.coverImageIndex] }}
                      style={styles.previewImage}
                    />
                  )}

                  <View style={styles.previewContent}>
                    <ThemedText style={styles.previewTitle}>
                      {formData.address.street || 'Property Address'}
                    </ThemedText>

                    <ThemedText style={styles.previewLocation}>
                      {formData.address.city}, {formData.address.state}
                    </ThemedText>

                    <View style={styles.previewDetails}>
                      <View style={styles.previewDetail}>
                        <IconComponent name="bed" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
                        <ThemedText style={styles.previewDetailText}>{formData.bedrooms} bed</ThemedText>
                      </View>
                      <View style={styles.previewDetail}>
                        <IconComponent name="water" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
                        <ThemedText style={styles.previewDetailText}>{formData.bathrooms} bath</ThemedText>
                      </View>
                      <View style={styles.previewDetail}>
                        <IconComponent name="resize" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
                        <ThemedText style={styles.previewDetailText}>{formData.squareFootage} sqft</ThemedText>
                      </View>
                    </View>

                    <View style={styles.previewPricing}>
                      <ThemedText style={styles.previewPrice}>
                        ${formData.rent.amount.toLocaleString()}
                      </ThemedText>
                      <ThemedText style={styles.previewPriceUnit}>/month</ThemedText>
                    </View>

                    <View style={styles.previewFeatures}>
                      {formData.furnishedStatus === 'furnished' && (
                        <View style={styles.previewFeature}>
                          <ThemedText style={styles.previewFeatureText}>Furnished</ThemedText>
                        </View>
                      )}
                      {formData.furnishedStatus === 'partially_furnished' && (
                        <View style={styles.previewFeature}>
                          <ThemedText style={styles.previewFeatureText}>Partially Furnished</ThemedText>
                        </View>
                      )}
                      {formData.petPolicy === 'allowed' && (
                        <View style={styles.previewFeature}>
                          <ThemedText style={styles.previewFeatureText}>Pet Friendly</ThemedText>
                        </View>
                      )}
                      {formData.parkingType !== 'none' && (
                        <View style={styles.previewFeature}>
                          <ThemedText style={styles.previewFeatureText}>Parking</ThemedText>
                        </View>
                      )}
                      {formData.leaseTerm && (
                        <View style={styles.previewFeature}>
                          <ThemedText style={styles.previewFeatureText}>
                            {formData.leaseTerm === '6_months' ? '6 Month Lease' :
                              formData.leaseTerm === '12_months' ? '12 Month Lease' :
                                formData.leaseTerm === 'monthly' ? 'Monthly Lease' : 'Flexible Lease'}
                          </ThemedText>
                        </View>
                      )}
                    </View>

                    <ThemedText style={styles.previewDescription}>
                      {formData.description || 'No description provided'}
                    </ThemedText>
                  </View>
                </View>
              </View>
            )}

            {/* Smart Suggestions */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <ThemedText style={styles.sectionTitle}>Smart Suggestions</ThemedText>
              </View>

              <View style={styles.suggestionsContainer}>
                <View style={styles.suggestionItem}>
                  <IconComponent name="bulb" size={20} color={colors.primaryColor} />
                  <View style={styles.suggestionContent}>
                    <ThemedText style={styles.suggestionTitle}>Competitive Pricing</ThemedText>
                    <ThemedText style={styles.suggestionText}>
                      Based on similar properties in your area, consider pricing between $1,200 - $1,800/month
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.suggestionItem}>
                  <IconComponent name="star" size={20} color={colors.primaryColor} />
                  <View style={styles.suggestionContent}>
                    <ThemedText style={styles.suggestionTitle}>High-Demand Features</ThemedText>
                    <ThemedText style={styles.suggestionText}>
                      Properties with parking, in-unit laundry, and pet-friendly policies rent 15% faster
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.suggestionItem}>
                  <IconComponent name="location" size={20} color={colors.primaryColor} />
                  <View style={styles.suggestionContent}>
                    <ThemedText style={styles.suggestionTitle}>Location Benefits</ThemedText>
                    <ThemedText style={styles.suggestionText}>
                      Highlight proximity to public transport, schools, and shopping centers
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.suggestionItem}>
                  <IconComponent name="camera" size={20} color={colors.primaryColor} />
                  <View style={styles.suggestionContent}>
                    <ThemedText style={styles.suggestionTitle}>Professional Photos</ThemedText>
                    <ThemedText style={styles.suggestionText}>
                      Properties with high-quality photos receive 40% more inquiries
                    </ThemedText>
                  </View>
                </View>
              </View>
            </View>

            {/* Availability & Rules Section */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <ThemedText style={styles.sectionTitle}>Availability & Lease Terms</ThemedText>
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Available From</ThemedText>
                <TextInput
                  style={styles.textInput}
                  value={formData.availableFrom}
                  onChangeText={(text) => updateField('availableFrom', text)}
                  placeholder="YYYY-MM-DD"
                />
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Lease Term</ThemedText>
                <View style={styles.pickerContainer}>
                  {(['monthly', '6_months', '12_months', 'flexible'] as const).map((term) => (
                    <TouchableOpacity
                      key={term}
                      style={[
                        styles.pickerOption,
                        formData.leaseTerm === term && styles.pickerOptionSelected
                      ]}
                      onPress={() => updateField('leaseTerm', term)}
                    >
                      <ThemedText
                        style={[
                          styles.pickerOptionText,
                          formData.leaseTerm === term && styles.pickerOptionTextSelected
                        ]}
                      >
                        {term === '6_months' ? '6 Months' :
                          term === '12_months' ? '12 Months' :
                            term.charAt(0).toUpperCase() + term.slice(1)}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>House Rules</ThemedText>

                <View style={styles.ruleItem}>
                  <TouchableOpacity
                    style={styles.ruleToggle}
                    onPress={() => updateField('smokingAllowed', !formData.smokingAllowed)}
                  >
                    <IconComponent
                      name={formData.smokingAllowed ? "checkmark-circle" : "close-circle"}
                      size={24}
                      color={formData.smokingAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
                    />
                    <ThemedText style={styles.ruleText}>Smoking Allowed</ThemedText>
                  </TouchableOpacity>
                </View>

                <View style={styles.ruleItem}>
                  <TouchableOpacity
                    style={styles.ruleToggle}
                    onPress={() => updateField('partiesAllowed', !formData.partiesAllowed)}
                  >
                    <IconComponent
                      name={formData.partiesAllowed ? "checkmark-circle" : "close-circle"}
                      size={24}
                      color={formData.partiesAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
                    />
                    <ThemedText style={styles.ruleText}>Parties Allowed</ThemedText>
                  </TouchableOpacity>
                </View>

                <View style={styles.ruleItem}>
                  <TouchableOpacity
                    style={styles.ruleToggle}
                    onPress={() => updateField('guestsAllowed', !formData.guestsAllowed)}
                  >
                    <IconComponent
                      name={formData.guestsAllowed ? "checkmark-circle" : "close-circle"}
                      size={24}
                      color={formData.guestsAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
                    />
                    <ThemedText style={styles.ruleText}>Guests Allowed</ThemedText>
                  </TouchableOpacity>
                </View>

                {formData.guestsAllowed && (
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Maximum Overnight Guests</ThemedText>
                    <View style={styles.pickerContainer}>
                      {[1, 2, 3, 4, 5].map((num) => (
                        <TouchableOpacity
                          key={num}
                          style={[
                            styles.pickerOption,
                            formData.maxGuests === num && styles.pickerOptionSelected
                          ]}
                          onPress={() => updateField('maxGuests', num)}
                        >
                          <ThemedText
                            style={[
                              styles.pickerOptionText,
                              formData.maxGuests === num && styles.pickerOptionTextSelected
                            ]}
                          >
                            {num}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[
                styles.submitButton,
                !isFormValid() && styles.submitButtonDisabled
              ]}
              onPress={handleSubmit}
              disabled={!isFormValid() || createLoading}
            >
              {createLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="white" />
                  <ThemedText style={styles.submitButtonText}>Creating Property...</ThemedText>
                </View>
              ) : (
                <ThemedText style={[
                  styles.submitButtonText,
                  !isFormValid() && styles.submitButtonTextDisabled
                ]}>
                  Create Property
                </ThemedText>
              )}
            </TouchableOpacity>

            {/* Save Draft Button */}
            <TouchableOpacity
              style={styles.saveDraftButton}
              onPress={handleSaveDraft}
              disabled={savingDraft}
            >
              {savingDraft ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={colors.primaryColor} />
                  <ThemedText style={styles.saveDraftButtonText}>Saving Draft...</ThemedText>
                </View>
              ) : (
                <View style={styles.saveDraftButtonContent}>
                  <IconComponent name="save-outline" size={20} color={colors.primaryColor} />
                  <ThemedText style={styles.saveDraftButtonText}>Save Draft</ThemedText>
                </View>
              )}
            </TouchableOpacity>

            {/* Draft Saved Indicator */}
            {draftSavedMessage && (
              <View style={styles.draftSavedIndicator}>
                <IconComponent name="checkmark-circle" size={16} color={colors.primaryColor} />
                <ThemedText style={styles.draftSavedText}>
                  Draft saved successfully!
                </ThemedText>
              </View>
            )}

            {/* Last Saved Info */}
            {formData.isDraft && formData.lastSaved && (
              <View style={styles.lastSavedInfo}>
                <ThemedText style={styles.lastSavedText}>
                  Last saved: {formData.lastSaved instanceof Date ? formData.lastSaved.toLocaleTimeString() : 'Unknown'}
                </ThemedText>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  form: {
    padding: 16,
  },
  heroSection: {
    height: 200,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderRadius: 35,
    marginBottom: 24,
    borderColor: colors.COLOR_BLACK,
    borderWidth: 1,
  },
  heroContent: {
    width: '100%',
    maxWidth: 800,
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    fontFamily: 'Phudu',
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 16,
    color: 'white',
    opacity: 0.9,
    textAlign: 'center',
    maxWidth: 400,
  },
  progressContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight_1,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.primaryLight_1,
    borderRadius: 2,
    marginBottom: 16,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primaryColor,
    borderRadius: 2,
  },
  progressSteps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressStep: {
    alignItems: 'center',
    flex: 1,
  },
  progressStepActive: {
    alignItems: 'center',
    flex: 1,
  },
  progressStepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primaryLight_1,
    marginBottom: 4,
  },
  progressStepDotActive: {
    backgroundColor: colors.primaryColor,
  },
  progressStepText: {
    fontSize: 12,
    color: colors.primaryDark_1,
    textAlign: 'center',
  },
  progressStepTextActive: {
    color: colors.primaryColor,
  },
  sectionCard: {
    backgroundColor: 'white',
    borderRadius: 25,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionHeader: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    fontFamily: 'Phudu',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: 'white',
    color: colors.COLOR_BLACK,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  halfInput: {
    flex: 0.48,
  },
  pickerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    backgroundColor: 'white',
  },
  pickerOptionSelected: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  pickerOptionText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  pickerOptionTextSelected: {
    color: 'white',
    fontWeight: '600',
  },
  searchContainer: {
    position: 'relative',
    marginBottom: 12,
    zIndex: 1000,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: colors.primaryLight,
    color: colors.primaryDark,
  },
  searchResults: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
    maxHeight: 200,
    zIndex: 1001,
  },
  searchResult: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight_1,
  },
  searchResultText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  locationButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.primaryColor,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  permissionStatus: {
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
  },
  permissionStatusText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  permissionGranted: {
    color: colors.primaryLight_1,
  },
  permissionDenied: {
    color: '#ff6b6b',
  },
  coordinatesContainer: {
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
  },
  coordinatesTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.primaryDark,
    marginBottom: 8,
  },
  coordinatesText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  accuracyText: {
    fontSize: 12,
    color: colors.primaryDark_1,
  },
  watchLocationButton: {
    padding: 8,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
  },
  watchLocationButtonActive: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  watchLocationButtonText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  watchLocationButtonTextActive: {
    color: 'white',
  },
  ruleItem: {
    marginBottom: 12,
  },
  ruleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  ruleText: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
    marginLeft: 12,
  },
  imageUploadButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  imageUploadButton: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.primaryColor,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  imageUploadButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryColor,
    marginTop: 4,
  },
  imageGallery: {
    marginBottom: 24,
  },
  imageGalleryTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
  },
  imageContainer: {
    width: 100,
    height: 100,
    marginRight: 8,
    position: 'relative',
  },
  propertyImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  coverImageBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 4,
    backgroundColor: colors.primaryColor,
    borderRadius: 8,
  },
  coverImageBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: 'white',
  },
  imageActions: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  imageActionButton: {
    padding: 4,
    borderRadius: 20,
    backgroundColor: colors.primaryColor,
    marginRight: 4,
  },
  deleteButton: {
    backgroundColor: '#ff6b6b',
  },
  imageTips: {
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
  },
  imageTipsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
  },
  imageTipsText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  previewSection: {
    marginBottom: 24,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
  },
  previewCard: {
    backgroundColor: 'white',
    borderRadius: 25,
    padding: 16,
    shadowColor: colors.COLOR_BLACK,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  previewPropertyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  previewPrice: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  previewLocation: {
    marginBottom: 8,
  },
  previewAddress: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  previewDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  previewDetail: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewDetailLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginRight: 8,
  },
  previewDetailValue: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  previewDescription: {
    marginBottom: 8,
  },
  previewDescriptionText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  previewAmenities: {
    marginBottom: 8,
  },
  previewAmenitiesTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
  },
  previewAmenitiesList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  previewAmenityTag: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    borderRadius: 25,
  },
  previewAmenityText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  previewDeposit: {
    marginTop: 8,
  },
  previewDepositText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  draftStatus: {
    backgroundColor: colors.primaryLight,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  draftStatusText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  submitButton: {
    backgroundColor: colors.primaryColor,
    borderRadius: 25,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
  },
  submitButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  submitButtonDisabled: {
    backgroundColor: colors.primaryLight_1,
  },
  submitButtonTextDisabled: {
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  saveDraftButton: {
    backgroundColor: 'white',
    borderRadius: 25,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: colors.primaryColor,
    borderStyle: 'dashed',
  },
  saveDraftButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveDraftButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryColor,
  },
  headerButton: {
    padding: 8,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    backgroundColor: 'white',
  },
  headerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  pricingGuidanceButton: {
    padding: 8,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
  },
  pricingGuidanceButtonText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  pricingGuidanceContainer: {
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
  },
  pricingGuidanceText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  pricingValidationContainer: {
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
  },
  pricingValidationGood: {
    backgroundColor: colors.primaryLight_1,
  },
  pricingValidationWarning: {
    backgroundColor: colors.primaryLight_1,
  },
  pricingValidationText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  pricingWarningsContainer: {
    marginTop: 8,
  },
  pricingWarningText: {
    fontSize: 12,
    color: colors.primaryDark_1,
    marginBottom: 2,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  textInputError: {
    borderColor: '#ff6b6b',
    borderWidth: 2,
  },
  locationErrorContainer: {
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: '#ff6b6b',
    borderRadius: 8,
  },
  previewImage: {
    width: '100%',
    height: 150,
    borderRadius: 8,
    marginBottom: 16,
  },
  previewContent: {
    padding: 16,
  },
  previewPricing: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  previewPriceUnit: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  previewFeatures: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  previewFeature: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewFeatureText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    marginLeft: 8,
  },
  previewDetailText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    marginLeft: 8,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  suggestionContent: {
    marginLeft: 8,
  },
  suggestionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  suggestionText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  suggestionsContainer: {
    marginBottom: 16,
  },
  ethicalPricingSection: {
    marginBottom: 20,
  },
  ethicalPricingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  ethicalPricingTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginLeft: 8,
  },
  ethicalPricingContent: {
    backgroundColor: colors.primaryLight,
    padding: 12,
    borderRadius: 8,
  },
  ethicalPricingDescription: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    marginBottom: 8,
  },
  ethicalPricingOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  ethicalPricingOption: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.primaryColor,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  ethicalPricingToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ethicalPricingOptionText: {
    flex: 1,
    marginLeft: 8,
  },
  ethicalPricingOptionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  ethicalPricingOptionDescription: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  ethicalCalculatorSection: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: colors.COLOR_BLACK_LIGHT_4,
  },
  ethicalCalculatorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  ethicalCalculatorTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginLeft: 8,
  },
  ethicalCalculatorContent: {
    backgroundColor: colors.primaryLight,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_4,
  },
  ethicalCalculatorDescription: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    marginBottom: 16,
  },
  subLabel: {
    fontSize: 14,
    color: colors.primaryDark_1,
    marginBottom: 8,
  },
  calculateEthicalButton: {
    backgroundColor: colors.primaryColor,
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  calculateEthicalButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  ethicalSuggestionsContainer: {
    marginTop: 16,
  },
  ethicalSuggestionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 12,
  },
  ethicalSuggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  ethicalSuggestionCard: {
    flex: 1,
    minWidth: '48%',
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
  },
  ethicalSuggestionLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 4,
  },
  ethicalSuggestionValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.primaryColor,
    marginBottom: 4,
  },
  ethicalSuggestionDesc: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  ethicalPricingBenefits: {
    marginTop: 12,
    padding: 12,
    backgroundColor: colors.primaryLight_1,
    borderRadius: 8,
  },
  ethicalPricingBenefitsTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
  },
  ethicalPricingBenefitsList: {
    gap: 4,
  },
  ethicalPricingBenefit: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 2,
  },
  headerDraftIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    gap: 4,
  },
  headerDraftText: {
    fontSize: 12,
    color: colors.primaryDark_1,
    fontWeight: '500',
  },
  draftSavedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginTop: 8,
    gap: 6,
  },
  draftSavedText: {
    fontSize: 14,
    color: colors.primaryColor,
    fontWeight: '500',
  },
  lastSavedInfo: {
    alignItems: 'center',
    marginTop: 8,
  },
  lastSavedText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontStyle: 'italic',
  },
});
