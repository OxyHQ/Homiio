import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, TextInput, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { PropertyMap } from '@/components/PropertyMap';
import { Header } from '@/components/Header';
import { CreatePropertyData } from '@/services/propertyService';
import { useDispatch, useSelector } from 'react-redux';
import { createProperty } from '@/store/reducers/propertyReducer';
import type { RootState, AppDispatch } from '@/store/store';
import { useOxy } from '@oxyhq/services';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { calculateEthicalRent, validateEthicalPricing, getPricingGuidance } from '@/utils/ethicalPricing';
import { Ionicons } from '@expo/vector-icons';

const IconComponent = Ionicons as any;

export default function CreatePropertyScreen() {
  const router = useRouter();
  const { oxyServices, activeSessionId } = useOxy();

  const [formData, setFormData] = useState<CreatePropertyData>({
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
    },
    amenities: [],
    floor: undefined,
    hasElevator: false,
    parkingSpaces: 1,
    yearBuilt: undefined,
    isFurnished: false,
    utilitiesIncluded: false,
    petFriendly: false,
    hasBalcony: false,
    hasGarden: false,
    proximityToTransport: false,
    proximityToSchools: false,
    proximityToShopping: false,
  });

  const [selectedLocation, setSelectedLocation] = useState<{
    latitude: number;
    longitude: number;
    address: string;
  } | null>(null);

  // Search functionality
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const isMapSelectionRef = useRef(false);

  // Custom search query setter
  const setSearchQueryWithSource = (query: string, fromMap: boolean = false) => {
    if (fromMap) {
      isMapSelectionRef.current = true;
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

  const dispatch = useDispatch<AppDispatch>();
  const isLoading = useSelector((state: RootState) => state.properties.isLoading);

  // Check location permission on mount
  useEffect(() => {
    const checkLocationPermission = async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      setLocationPermission(status);
    };

    checkLocationPermission();
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
        Alert.alert(
          'Location Permission Required',
          'Please enable location access to use this feature.',
          [{ text: 'OK' }]
        );
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

        setFormData(prev => ({
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

        Alert.alert(
          'Location Found',
          `Address updated to: ${newAddress.street}, ${newAddress.city}, ${newAddress.state}`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Location Error',
          'Could not find address for your current location. Please try again or enter address manually.',
          [{ text: 'OK' }]
        );
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

      Alert.alert('Location Error', errorMessage, [{ text: 'OK' }]);
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
        isFurnished: formData.isFurnished,
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
    formData.isFurnished,
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
      isFurnished: formData.isFurnished,
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
    if (isMapSelectionRef.current) {
      isMapSelectionRef.current = false;
      return;
    }

    if (searchQuery.length < 3) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const timeout = setTimeout(() => {
      fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`)
        .then(res => res.json())
        .then(data => {
          setSearchResults(data);
          setShowSearchResults(true);
        })
        .catch(() => {
          setSearchResults([]);
          setShowSearchResults(false);
        });
    }, 400);

    return () => clearTimeout(timeout);
  }, [searchQuery, isMapSelectionRef]);

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

    // For map clicks, we need to fetch the structured address data
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`)
      .then(response => response.json())
      .then(data => {
        if (data.address) {
          const addr = data.address;
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
      })
      .catch(() => {
        // Fallback to parsing display_name if API call fails
        const parsedAddress = parseAddress(address);
        updateAddressField('street', parsedAddress.street);
        updateAddressField('city', parsedAddress.city);
        updateAddressField('state', parsedAddress.state);
        updateAddressField('zipCode', parsedAddress.zipCode);
      });
  };

  const handleSubmit = async () => {
    // Check if user is authenticated
    if (!oxyServices || !activeSessionId) {
      Alert.alert(
        'Authentication Required',
        'Please sign in with OxyServices to create a property.',
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
      return;
    }

    // Validation
    const errors = [];

    // Title is now generated dynamically when displaying properties

    if (!formData.address.street.trim()) {
      errors.push('Street address is required');
    }

    if (!formData.address.city.trim()) {
      errors.push('City is required');
    }

    if (!formData.address.state.trim()) {
      errors.push('State is required');
    }

    if (!formData.address.zipCode.trim()) {
      errors.push('ZIP code is required');
    }

    if (formData.rent.amount <= 0) {
      errors.push('Rent amount must be greater than 0');
    }

    // Ethical pricing validation
    if (pricingValidation && !pricingValidation.isWithinEthicalRange) {
      errors.push(`Rent price exceeds ethical maximum ($${pricingValidation.maxRent})`);
      if (pricingValidation.warnings.length > 0) {
        pricingValidation.warnings.forEach((warning: string) => {
          if (warning.includes('speculative')) {
            errors.push('Pricing appears to be speculative. Please consider a fair market rate.');
          }
        });
      }
    }

    if (formData.bedrooms !== undefined && formData.bedrooms < 0) {
      errors.push('Bedrooms cannot be negative');
    }

    if (formData.bathrooms !== undefined && formData.bathrooms < 0) {
      errors.push('Bathrooms cannot be negative');
    }

    if (formData.squareFootage !== undefined && formData.squareFootage < 0) {
      errors.push('Square footage cannot be negative');
    }

    if (formData.rent.deposit !== undefined && formData.rent.deposit < 0) {
      errors.push('Security deposit cannot be negative');
    }

    if (errors.length > 0) {
      Alert.alert('Validation Error', errors.join('\n'));
      return;
    }

    try {
      // Add location data to the form data
      const propertyData = {
        ...formData,
        location: selectedLocation ? {
          latitude: selectedLocation.latitude,
          longitude: selectedLocation.longitude,
        } : undefined,
      };

      const resultAction = await dispatch(createProperty({ data: propertyData, oxyServices, activeSessionId }));
      if (createProperty.fulfilled.match(resultAction)) {
        const createdProperty = resultAction.payload;
        router.push(`/properties/${createdProperty._id}`);
      } else {
        throw resultAction.error;
      }
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

      Alert.alert('Error', errorMessage);
    }
  };

  const updateField = (field: keyof CreatePropertyData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateAddressField = (field: keyof CreatePropertyData['address'], value: string) => {
    setFormData(prev => ({
      ...prev,
      address: { ...prev.address, [field]: value }
    }));
  };

  const updateRentField = (field: keyof CreatePropertyData['rent'], value: any) => {
    setFormData(prev => ({
      ...prev,
      rent: { ...prev.rent, [field]: value }
    }));
  };

  const toggleAmenity = (amenity: string) => {
    setFormData(prev => ({
      ...prev,
      amenities: prev.amenities?.includes(amenity)
        ? prev.amenities.filter(a => a !== amenity)
        : [...(prev.amenities || []), amenity]
    }));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: 'Create Property',
          titlePosition: 'center',
          rightComponents: [
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

      <ScrollView style={styles.scrollView}>
        <View style={styles.form}>
          {/* Map Section */}
          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Location *</ThemedText>
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
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Street Address *</ThemedText>
            <TextInput
              style={styles.textInput}
              value={formData.address.street}
              onChangeText={(text) => updateAddressField('street', text)}
              placeholder="Enter street address"
            />
          </View>

          <View style={styles.row}>
            <View style={styles.halfInput}>
              <ThemedText style={styles.label}>City *</ThemedText>
              <TextInput
                style={styles.textInput}
                value={formData.address.city}
                onChangeText={(text) => updateAddressField('city', text)}
                placeholder="Enter city"
              />
            </View>

            <View style={styles.halfInput}>
              <ThemedText style={styles.label}>State *</ThemedText>
              <TextInput
                style={styles.textInput}
                value={formData.address.state}
                onChangeText={(text) => updateAddressField('state', text)}
                placeholder="Enter state"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>ZIP Code *</ThemedText>
            <TextInput
              style={styles.textInput}
              value={formData.address.zipCode}
              onChangeText={(text) => updateAddressField('zipCode', text)}
              placeholder="Enter ZIP code"
            />
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Property Type *</ThemedText>
            <View style={styles.pickerContainer}>
              {(['apartment', 'house', 'room', 'studio'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.pickerOption,
                    formData.type === type && styles.pickerOptionSelected
                  ]}
                  onPress={() => updateField('type', type)}
                >
                  <ThemedText
                    style={[
                      styles.pickerOptionText,
                      formData.type === type && styles.pickerOptionTextSelected
                    ]}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Description</ThemedText>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={formData.description}
              onChangeText={(text) => updateField('description', text)}
              placeholder="Enter property description"
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.row}>
            <View style={styles.halfInput}>
              <ThemedText style={styles.label}>Bedrooms</ThemedText>
              <TextInput
                style={styles.textInput}
                value={formData.bedrooms?.toString() || ''}
                onChangeText={(text) => updateField('bedrooms', parseInt(text) || 0)}
                placeholder="0"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.halfInput}>
              <ThemedText style={styles.label}>Bathrooms</ThemedText>
              <TextInput
                style={styles.textInput}
                value={formData.bathrooms?.toString() || ''}
                onChangeText={(text) => updateField('bathrooms', parseInt(text) || 0)}
                placeholder="0"
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.halfInput}>
              <ThemedText style={styles.label}>Size (sq ft)</ThemedText>
              <TextInput
                style={styles.textInput}
                value={formData.squareFootage?.toString() || ''}
                onChangeText={(text) => updateField('squareFootage', parseInt(text) || 0)}
                placeholder="0"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.halfInput}>
              <ThemedText style={styles.label}>Monthly Rent *</ThemedText>
              <TextInput
                style={[
                  styles.textInput,
                  pricingValidation && !pricingValidation.isWithinEthicalRange && styles.textInputError
                ]}
                value={formData.rent.amount?.toString() || ''}
                onChangeText={(text) => updateRentField('amount', parseFloat(text) || 0)}
                placeholder="0"
                keyboardType="numeric"
              />

              {/* Pricing Guidance */}
              <TouchableOpacity
                style={styles.pricingGuidanceButton}
                onPress={() => setShowPricingGuidance(!showPricingGuidance)}
              >
                <ThemedText style={styles.pricingGuidanceButtonText}>
                  💡 Get Ethical Pricing Guidance
                </ThemedText>
              </TouchableOpacity>

              {showPricingGuidance && (
                <View style={styles.pricingGuidanceContainer}>
                  <ThemedText style={styles.pricingGuidanceText}>
                    {getCurrentPricingGuidance()}
                  </ThemedText>
                </View>
              )}

              {/* Pricing Validation Feedback */}
              {pricingValidation && (
                <View style={[
                  styles.pricingValidationContainer,
                  pricingValidation.isWithinEthicalRange
                    ? styles.pricingValidationGood
                    : styles.pricingValidationWarning
                ]}>
                  <ThemedText style={styles.pricingValidationText}>
                    {pricingValidation.isWithinEthicalRange
                      ? '✅ Price is within ethical range'
                      : '⚠️ Price exceeds ethical maximum'
                    }
                  </ThemedText>
                  {pricingValidation.warnings.length > 0 && (
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
            </View>
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Security Deposit</ThemedText>
            <TextInput
              style={styles.textInput}
              value={formData.rent.deposit?.toString() || ''}
              onChangeText={(text) => updateRentField('deposit', parseFloat(text) || 0)}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Utilities</ThemedText>
            <View style={styles.pickerContainer}>
              {(['included', 'excluded', 'partial'] as const).map((utility) => (
                <TouchableOpacity
                  key={utility}
                  style={[
                    styles.pickerOption,
                    formData.rent.utilities === utility && styles.pickerOptionSelected
                  ]}
                  onPress={() => updateRentField('utilities', utility)}
                >
                  <ThemedText
                    style={[
                      styles.pickerOptionText,
                      formData.rent.utilities === utility && styles.pickerOptionTextSelected
                    ]}
                  >
                    {utility.charAt(0).toUpperCase() + utility.slice(1)}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Amenities</ThemedText>
            <View style={styles.pickerContainer}>
              {['wifi', 'parking', 'gym', 'pool', 'laundry', 'dishwasher', 'air_conditioning', 'heating', 'balcony', 'garden'].map((amenity) => (
                <TouchableOpacity
                  key={amenity}
                  style={[
                    styles.pickerOption,
                    formData.amenities?.includes(amenity) && styles.pickerOptionSelected
                  ]}
                  onPress={() => toggleAmenity(amenity)}
                >
                  <ThemedText
                    style={[
                      styles.pickerOptionText,
                      formData.amenities?.includes(amenity) && styles.pickerOptionTextSelected
                    ]}
                  >
                    {amenity.charAt(0).toUpperCase() + amenity.slice(1).replace('_', ' ')}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Property Preview Card */}
          <View style={styles.previewSection}>
            <ThemedText style={styles.previewTitle}>Property Preview</ThemedText>
            <View style={styles.previewCard}>
              <View style={styles.previewHeader}>
                <ThemedText style={styles.previewPropertyTitle}>
                  {generatePropertyTitle({
                    type: formData.type,
                    address: formData.address,
                    bedrooms: formData.bedrooms,
                    bathrooms: formData.bathrooms
                  })}
                </ThemedText>
                <ThemedText style={styles.previewPrice}>
                  ${formData.rent.amount?.toLocaleString() || '0'}/month
                </ThemedText>
              </View>

              <View style={styles.previewLocation}>
                <ThemedText style={styles.previewAddress}>
                  {formData.address.street && formData.address.city
                    ? `${formData.address.street}, ${formData.address.city}, ${formData.address.state}`
                    : 'Address not specified'
                  }
                </ThemedText>
              </View>

              <View style={styles.previewDetails}>
                <View style={styles.previewDetail}>
                  <ThemedText style={styles.previewDetailLabel}>Bedrooms:</ThemedText>
                  <ThemedText style={styles.previewDetailValue}>
                    {formData.bedrooms || 0}
                  </ThemedText>
                </View>
                <View style={styles.previewDetail}>
                  <ThemedText style={styles.previewDetailLabel}>Bathrooms:</ThemedText>
                  <ThemedText style={styles.previewDetailValue}>
                    {formData.bathrooms || 0}
                  </ThemedText>
                </View>
                {formData.squareFootage && formData.squareFootage > 0 && (
                  <View style={styles.previewDetail}>
                    <ThemedText style={styles.previewDetailLabel}>Size:</ThemedText>
                    <ThemedText style={styles.previewDetailValue}>
                      {formData.squareFootage} sq ft
                    </ThemedText>
                  </View>
                )}
              </View>

              {formData.description && (
                <View style={styles.previewDescription}>
                  <ThemedText style={styles.previewDescriptionText}>
                    {formData.description.length > 100
                      ? `${formData.description.substring(0, 100)}...`
                      : formData.description
                    }
                  </ThemedText>
                </View>
              )}

              {formData.amenities && formData.amenities.length > 0 && (
                <View style={styles.previewAmenities}>
                  <ThemedText style={styles.previewAmenitiesTitle}>Amenities:</ThemedText>
                  <View style={styles.previewAmenitiesList}>
                    {formData.amenities.slice(0, 4).map((amenity, index) => (
                      <View key={index} style={styles.previewAmenityTag}>
                        <ThemedText style={styles.previewAmenityText}>
                          {amenity.charAt(0).toUpperCase() + amenity.slice(1).replace('_', ' ')}
                        </ThemedText>
                      </View>
                    ))}
                    {formData.amenities.length > 4 && (
                      <View style={styles.previewAmenityTag}>
                        <ThemedText style={styles.previewAmenityText}>
                          +{formData.amenities.length - 4} more
                        </ThemedText>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {formData.rent.deposit && formData.rent.deposit > 0 && (
                <View style={styles.previewDeposit}>
                  <ThemedText style={styles.previewDepositText}>
                    Security Deposit: ${formData.rent.deposit.toLocaleString()}
                  </ThemedText>
                </View>
              )}
            </View>
          </View>

          <TouchableOpacity
            onPress={handleSubmit}
            disabled={isLoading}
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="white" />
                <ThemedText style={[styles.submitButtonText, { marginLeft: 8 }]}>
                  Creating...
                </ThemedText>
              </View>
            ) : (
              <ThemedText style={styles.submitButtonText}>
                Create Property
              </ThemedText>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  form: {
    padding: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: colors.primaryLight,
    color: colors.primaryDark,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    backgroundColor: colors.primaryLight,
  },
  pickerOptionSelected: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  pickerOptionText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  pickerOptionTextSelected: {
    color: 'white',
    fontWeight: '600',
  },
  subLabel: {
    fontSize: 14,
    color: colors.primaryDark_1,
    marginBottom: 8,
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
  headerButton: {
    padding: 8,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    backgroundColor: colors.primaryLight,
  },
  headerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  previewSection: {
    marginBottom: 24,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primaryDark,
    marginBottom: 8,
  },
  previewCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: 25,
    padding: 16,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
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
    color: colors.primaryDark,
  },
  previewPrice: {
    fontSize: 14,
    color: colors.primaryDark_1,
  },
  previewLocation: {
    marginBottom: 8,
  },
  previewAddress: {
    fontSize: 14,
    color: colors.primaryDark,
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
    color: colors.primaryDark_1,
    marginRight: 8,
  },
  previewDetailValue: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  previewDescription: {
    marginBottom: 8,
  },
  previewDescriptionText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  previewAmenities: {
    marginBottom: 8,
  },
  previewAmenitiesTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.primaryDark,
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
    borderColor: colors.primaryLight_1,
    borderRadius: 25,
  },
  previewAmenityText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  previewDeposit: {
    marginTop: 8,
  },
  previewDepositText: {
    fontSize: 14,
    color: colors.primaryDark_1,
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
  textInputError: {
    borderColor: '#ff6b6b',
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
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
  submitButton: {
    marginTop: 24,
    paddingVertical: 16,
    backgroundColor: colors.primaryColor,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: colors.primaryLight_1,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    textAlign: 'center',
  },
});
