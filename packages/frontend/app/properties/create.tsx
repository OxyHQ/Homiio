import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TextInput, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import Button from '@/components/Button';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { PropertyMap } from '@/components/PropertyMap';
import { useCreateProperty } from '@/hooks/usePropertyQueries';
import { CreatePropertyData } from '@/services/propertyService';
import { useOxy } from '@oxyhq/services';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';

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

  const createPropertyMutation = useCreateProperty();

  // Search handler
  useEffect(() => {
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
  }, [searchQuery]);

  const handleSearchSelect = (result: any) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const address = result.display_name;

    setSelectedLocation({ latitude: lat, longitude: lng, address });
    setSearchQuery(address);
    setShowSearchResults(false);

    // Parse the address to extract components
    const addressParts = address.split(', ');
    if (addressParts.length >= 3) {
      const street = addressParts[0];
      const city = addressParts[1];
      const state = addressParts[2];
      const zipCode = addressParts.length > 3 ? addressParts[3] : '';

      updateAddressField('street', street);
      updateAddressField('city', city);
      updateAddressField('state', state);
      updateAddressField('zipCode', zipCode);
    } else {
      // If we can't parse the address, just use the full address as street
      updateAddressField('street', address);
    }
  };

  const handleLocationSelect = (lat: number, lng: number, address: string) => {
    setSelectedLocation({ latitude: lat, longitude: lng, address });

    // Parse the address to extract components
    const addressParts = address.split(', ');
    if (addressParts.length >= 3) {
      const street = addressParts[0];
      const city = addressParts[1];
      const state = addressParts[2];
      const zipCode = addressParts.length > 3 ? addressParts[3] : '';

      updateAddressField('street', street);
      updateAddressField('city', city);
      updateAddressField('state', state);
      updateAddressField('zipCode', zipCode);
    } else {
      // If we can't parse the address, just use the full address as street
      updateAddressField('street', address);
    }
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

      await createPropertyMutation.mutateAsync(propertyData);
      Alert.alert('Success', 'Property created successfully!', [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]);
    } catch (error: any) {
      console.error('Property creation error:', error);

      let errorMessage = 'Failed to create property. Please try again.';

      // Handle OxyServices authentication errors specifically
      if (error.message && error.message.includes('Authentication')) {
        errorMessage = 'Authentication failed. Please sign in again.';
      } else if (error.status === 401) {
        errorMessage = 'Authentication required. Please sign in with Oxy.';
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
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
    <SafeAreaView style={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText style={styles.title}>Create Property</ThemedText>
        <Button onPress={() => router.back()}>
          Cancel
        </Button>
      </ThemedView>

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
                onChangeText={setSearchQuery}
                placeholder="Search for an address..."
                onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
              />

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
              latitude={selectedLocation?.latitude}
              longitude={selectedLocation?.longitude}
              address={selectedLocation?.address}
              onLocationSelect={handleLocationSelect}
              height={300}
              interactive={true}
            />
            {selectedLocation && (
              <View style={styles.locationInfo}>
                <ThemedText style={styles.locationText}>
                  Selected: {selectedLocation.address}
                </ThemedText>
              </View>
            )}
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
                style={styles.textInput}
                value={formData.rent.amount?.toString() || ''}
                onChangeText={(text) => updateRentField('amount', parseFloat(text) || 0)}
                placeholder="0"
                keyboardType="numeric"
              />
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

          <Button
            onPress={handleSubmit}
            disabled={createPropertyMutation.isPending}
            style={styles.submitButton}
          >
            {createPropertyMutation.isPending ? 'Creating...' : 'Create Property'}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight_1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primaryDark,
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
  submitButton: {
    marginTop: 24,
    paddingVertical: 16,
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
  locationInfo: {
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
  },
  locationText: {
    fontSize: 14,
    color: colors.primaryDark,
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
});
