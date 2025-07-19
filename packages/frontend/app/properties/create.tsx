import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, TouchableOpacity, Platform, KeyboardAvoidingView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
const IconComponent = Ionicons as any;
import { colors } from '@/styles/colors';
import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { AmenitiesSelector } from '@/components/AmenitiesSelector';
import { PropertyMap } from '@/components/PropertyMap';
import { PropertyPreviewWidget } from '@/components/widgets/PropertyPreviewWidget';
import { useCreatePropertyFormStore, useCreatePropertyFormSelectors } from '@/store/createPropertyFormStore';
import { useCreateProperty } from '@/hooks/usePropertyQueries';
import { BottomSheetContext } from '@/app/_layout';
import { SearchablePickerBottomSheet } from '@/components/SearchablePickerBottomSheet';
import { PropertyService } from '@/services/propertyService';

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
  apartment: [
    'Basic Info',
    'Location',
    'Pricing',
    'Amenities',
    'Rules',
    'Media',
    'Preview',
  ],
  house: [
    'Basic Info',
    'Location',
    'Pricing',
    'Amenities',
    'Rules',
    'Media',
    'Preview',
  ],
  room: [
    'Basic Info',
    'Location',
    'Pricing',
    'Amenities',
    'Media',
    'Preview',
  ],
  studio: [
    'Basic Info',
    'Location',
    'Pricing',
    'Amenities',
    'Media',
    'Preview',
  ],
  coliving: [
    'Basic Info',
    'Location',
    'Pricing',
    'Amenities',
    'Coliving Features',
    'Media',
    'Preview',
  ],
  other: [
    'Basic Info',
    'Location',
    'Pricing',
    'Media',
    'Preview',
  ],
};

// Field configuration for each property type and step
// Carefully tailored to real-world property listing needs
const FIELD_CONFIG: Record<string, Record<string, string[]>> = {
  apartment: {
    // Apartment: all main fields
    'Basic Info': ['propertyType', 'bedrooms', 'bathrooms', 'squareFootage', 'floor', 'yearBuilt', 'description'],
    'Location': ['address', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude', 'availableFrom', 'leaseTerm'],
    'Pricing': ['monthlyRent', 'currency', 'securityDeposit', 'applicationFee', 'lateFee'],
    'Amenities': ['amenities'],
    'Rules': ['petsAllowed', 'smokingAllowed', 'partiesAllowed', 'guestsAllowed', 'maxGuests'],
    'Media': ['images'],
    'Preview': [],
  },
  house: {
    // House: same as apartment
    'Basic Info': ['propertyType', 'bedrooms', 'bathrooms', 'squareFootage', 'floor', 'yearBuilt', 'description'],
    'Location': ['address', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude', 'availableFrom', 'leaseTerm'],
    'Pricing': ['monthlyRent', 'currency', 'securityDeposit', 'applicationFee', 'lateFee'],
    'Amenities': ['amenities'],
    'Rules': ['petsAllowed', 'smokingAllowed', 'partiesAllowed', 'guestsAllowed', 'maxGuests'],
    'Media': ['images'],
    'Preview': [],
  },
  studio: {
    // Studio: no bedrooms
    'Basic Info': ['propertyType', 'bathrooms', 'squareFootage', 'floor', 'yearBuilt', 'description'],
    'Location': ['address', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude'],
    'Pricing': ['monthlyRent', 'currency', 'securityDeposit'],
    'Amenities': ['amenities'],
    'Media': ['images'],
    'Preview': [],
  },
  room: {
    // Room: no bedrooms, but has bathrooms, squareFootage, floor, yearBuilt
    'Basic Info': ['propertyType', 'bathrooms', 'squareFootage', 'floor', 'yearBuilt', 'description'],
    'Location': ['address', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude'],
    'Pricing': ['monthlyRent', 'currency', 'securityDeposit'],
    'Amenities': ['amenities'],
    'Media': ['images'],
    'Preview': [],
  },
  coliving: {
    // Coliving: no bedrooms, optional bathrooms, coliving features
    'Basic Info': ['propertyType', 'bathrooms', 'squareFootage', 'yearBuilt', 'description'],
    'Location': ['address', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude'],
    'Pricing': ['monthlyRent', 'currency', 'securityDeposit'],
    'Amenities': ['amenities'],
    'Coliving Features': ['sharedSpaces', 'communityEvents'],
    'Media': ['images'],
    'Preview': [],
  },
  other: {
    // Other: minimal fields
    'Basic Info': ['propertyType', 'bathrooms', 'squareFootage', 'floor', 'yearBuilt', 'description'],
    'Location': ['address', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude'],
    'Pricing': ['monthlyRent', 'currency', 'securityDeposit'],
    'Media': ['images'],
    'Preview': [],
  },
};

export default function CreatePropertyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { create, loading, error } = useCreateProperty();

  // Get form state and actions from Zustand store
  const {
    setFormData,
    updateFormField,
    nextStep,
    prevStep,
    setLoading,
    setError,
    setCurrentStep
  } = useCreatePropertyFormStore();

  const { formData, currentStep, isDirty, isLoading } = useCreatePropertyFormSelectors();

  // Dynamic steps state
  const [steps, setSteps] = useState<string[]>(STEP_FLOWS['apartment']);

  // Track previous propertyType to reset step if changed
  const prevPropertyTypeRef = React.useRef<string | undefined>(formData.basicInfo.propertyType);

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
        },
        type: formData.basicInfo.propertyType as
          | 'apartment'
          | 'house'
          | 'room'
          | 'studio'
          | 'coliving'
          | 'other',
        description: formData.basicInfo.description,
        bedrooms: formData.basicInfo.bedrooms ? parseInt(formData.basicInfo.bedrooms.toString()) : undefined,
        bathrooms: formData.basicInfo.bathrooms ? parseFloat(formData.basicInfo.bathrooms.toString()) : undefined,
        squareFootage: formData.basicInfo.squareFootage ? parseInt(formData.basicInfo.squareFootage.toString()) : undefined,
        floor: formData.basicInfo.floor ? parseInt(formData.basicInfo.floor.toString()) : undefined,
        yearBuilt: formData.basicInfo.yearBuilt ? parseInt(formData.basicInfo.yearBuilt.toString()) : undefined,
        rent: {
          amount: formData.pricing.monthlyRent ? parseFloat(formData.pricing.monthlyRent.toString()) : 0,
          currency: PropertyService.getCurrencyCode(formData.pricing.currency || 'USD'),
          paymentFrequency: 'monthly' as 'monthly',
          deposit: formData.pricing.securityDeposit ? parseFloat(formData.pricing.securityDeposit.toString()) : 0,
          utilities:
            typeof formData.pricing.utilities === 'string' &&
              ['included', 'excluded', 'partial'].includes(formData.pricing.utilities)
              ? (formData.pricing.utilities as 'included' | 'excluded' | 'partial')
              : 'excluded',
        },
        amenities: formData.amenities.selectedAmenities || [],
        images: formData.media.images || [],
        location: (formData.location.latitude && formData.location.longitude)
          ? {
            type: 'Point',
            coordinates: [formData.location.longitude, formData.location.latitude], // [longitude, latitude]
          }
          : undefined,
      };
      if (formData.basicInfo.propertyType === 'coliving') {
        propertyData.colivingFeatures = formData.colivingFeatures;
      }
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
    } catch (err: any) {
      setError(err.message || 'Failed to create property');
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
      if (fieldsToShow.includes('propertyType') && !formData.basicInfo.propertyType) errors.propertyType = 'Property type is required';
      if (fieldsToShow.includes('bedrooms') && (formData.basicInfo.bedrooms === undefined || formData.basicInfo.bedrooms === null || Number.isNaN(formData.basicInfo.bedrooms))) errors.bedrooms = 'Number of bedrooms is required';
      if (fieldsToShow.includes('bathrooms') && (formData.basicInfo.bathrooms === undefined || formData.basicInfo.bathrooms === null || Number.isNaN(formData.basicInfo.bathrooms))) errors.bathrooms = 'Number of bathrooms is required';
      if (fieldsToShow.includes('squareFootage') && !formData.basicInfo.squareFootage) errors.squareFootage = 'Square footage is required';
    } else if (stepName === 'Location') {
      if (fieldsToShow.includes('address') && !formData.location.address) errors.address = 'Address is required';
      if (fieldsToShow.includes('city') && !formData.location.city) errors.city = 'City is required';
      if (fieldsToShow.includes('state') && !formData.location.state) errors.state = 'State is required';
      if (fieldsToShow.includes('zipCode') && !formData.location.zipCode) errors.zipCode = 'ZIP code is required';
      if (fieldsToShow.includes('latitude') && !formData.location.latitude) errors.coordinates = 'Please select a location on the map';
      if (fieldsToShow.includes('longitude') && !formData.location.longitude) errors.coordinates = 'Please select a location on the map';
    } else if (stepName === 'Pricing') {
      if (fieldsToShow.includes('monthlyRent') && !formData.pricing.monthlyRent) errors.monthlyRent = 'Monthly rent is required';
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

  // Handle location selection from map
  const handleLocationSelect = (lat: number, lng: number, address: string) => {
    // Parse address components
    const addressParts = address.split(',').map(part => part.trim());
    const zipCodeMatch = address.match(/\b\d{5}(?:-\d{4})?\b/);
    const zipCode = zipCodeMatch ? zipCodeMatch[0] : '';

    // Update location data
    setFormData('location', {
      address: addressParts[0] || '',
      city: addressParts[1] || '',
      state: addressParts[2] || '',
      zipCode,
      latitude: lat,
      longitude: lng,
    });
  };

  // Handle amenity selection
  const handleAmenityToggle = (amenityId: string) => {
    const currentAmenities = formData.amenities.selectedAmenities || [];
    const updatedAmenities = currentAmenities.includes(amenityId)
      ? currentAmenities.filter(id => id !== amenityId)
      : [...currentAmenities, amenityId];

    setFormData('amenities', { selectedAmenities: updatedAmenities });
  };

  const bottomSheet = React.useContext(BottomSheetContext);

  // Predefined options
  const COUNTRY_OPTIONS = ['US', 'Canada', 'Mexico', 'Other'];
  const STATE_OPTIONS = ['CA', 'NY', 'TX', 'FL', 'IL', 'Other'];

  // Render step content based on current step name
  const renderStepContent = () => {
    const stepName = steps[currentStep];
    switch (stepName) {
      case 'Basic Info':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>Basic Information</ThemedText>

            {/* Property title is auto-generated */}

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Property Type</ThemedText>
              <View style={styles.propertyTypeContainer}>
                {PROPERTY_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type.id}
                    style={[
                      styles.propertyTypeButton,
                      formData.basicInfo.propertyType === type.id && styles.propertyTypeButtonSelected
                    ]}
                    onPress={() => updateFormField('basicInfo', 'propertyType', type.id)}
                  >
                    <ThemedText
                      style={[
                        styles.propertyTypeText,
                        formData.basicInfo.propertyType === type.id && styles.propertyTypeTextSelected
                      ]}
                    >
                      {type.label}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
              {validationErrors.propertyType && <ThemedText style={styles.errorText}>{validationErrors.propertyType}</ThemedText>}
            </View>

            {/* Conditionally render Bedrooms */}
            {fieldsToShow.includes('bedrooms') && (
              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                  <ThemedText style={styles.label}>Bedrooms</ThemedText>
                  <TextInput
                    style={[styles.input, validationErrors.bedrooms && styles.inputError]}
                    value={formData.basicInfo.bedrooms?.toString() || ''}
                    onChangeText={(text) => updateFormField('basicInfo', 'bedrooms', parseInt(text) || 0)}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                  {validationErrors.bedrooms && <ThemedText style={styles.errorText}>{validationErrors.bedrooms}</ThemedText>}
                </View>

                {/* Conditionally render Bathrooms */}
                {fieldsToShow.includes('bathrooms') && (
                  <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                    <ThemedText style={styles.label}>Bathrooms</ThemedText>
                    <TextInput
                      style={[styles.input, validationErrors.bathrooms && styles.inputError]}
                      value={formData.basicInfo.bathrooms?.toString() || ''}
                      onChangeText={(text) => updateFormField('basicInfo', 'bathrooms', parseFloat(text) || 0)}
                      keyboardType="numeric"
                      placeholder="0"
                    />
                    {validationErrors.bathrooms && <ThemedText style={styles.errorText}>{validationErrors.bathrooms}</ThemedText>}
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
                    onChangeText={(text) => updateFormField('basicInfo', 'squareFootage', parseInt(text) || 0)}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                  {validationErrors.squareFootage && <ThemedText style={styles.errorText}>{validationErrors.squareFootage}</ThemedText>}
                </View>
              )}
              {fieldsToShow.includes('floor') && (
                <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                  <ThemedText style={styles.label}>Floor (optional)</ThemedText>
                  <TextInput
                    style={styles.input}
                    value={formData.basicInfo.floor?.toString() || ''}
                    onChangeText={(text) => updateFormField('basicInfo', 'floor', parseInt(text) || undefined)}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                </View>
              )}
            </View>
            {fieldsToShow.includes('yearBuilt') && (
              <View style={styles.formGroup}>
                <ThemedText style={styles.label}>Year Built (optional)</ThemedText>
                <TextInput
                  style={styles.input}
                  value={formData.basicInfo.yearBuilt?.toString() || ''}
                  onChangeText={(text) => updateFormField('basicInfo', 'yearBuilt', parseInt(text) || undefined)}
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
            <ThemedText type="subtitle" style={styles.sectionTitle}>Location</ThemedText>

            <View style={styles.mapContainer}>
              <PropertyMap
                latitude={formData.location.latitude}
                longitude={formData.location.longitude}
                address={formData.location.address}
                onLocationSelect={handleLocationSelect}
                height={300}
                interactive={true}
              />
              {validationErrors.coordinates && <ThemedText style={styles.errorText}>{validationErrors.coordinates}</ThemedText>}
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Address</ThemedText>
              <TextInput
                style={[styles.input, validationErrors.address && styles.inputError]}
                value={formData.location.address}
                onChangeText={(text) => updateFormField('location', 'address', text)}
                placeholder="Street address"
              />
              {validationErrors.address && <ThemedText style={styles.errorText}>{validationErrors.address}</ThemedText>}
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <ThemedText style={styles.label}>City</ThemedText>
                <TextInput
                  style={[styles.input, validationErrors.city && styles.inputError]}
                  value={formData.location.city}
                  onChangeText={(text) => updateFormField('location', 'city', text)}
                  placeholder="City"
                />
                {validationErrors.city && <ThemedText style={styles.errorText}>{validationErrors.city}</ThemedText>}
              </View>

              <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                <ThemedText style={styles.label}>State</ThemedText>
                <TouchableOpacity
                  style={[styles.input, { justifyContent: 'center' }]}
                  onPress={() => bottomSheet.open(
                    <SearchablePickerBottomSheet
                      options={STATE_OPTIONS}
                      selected={formData.location.state || ''}
                      onSelect={(value) => updateFormField('location', 'state', value)}
                      title="State"
                      onClose={() => { }}
                    />
                  )}
                >
                  <ThemedText style={{ color: formData.location.state ? colors.primaryDark : colors.COLOR_BLACK_LIGHT_4 }}>
                    {formData.location.state || 'Select state'}
                  </ThemedText>
                </TouchableOpacity>
                {validationErrors.state && <ThemedText style={styles.errorText}>{validationErrors.state}</ThemedText>}
              </View>
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <ThemedText style={styles.label}>ZIP Code</ThemedText>
                <TextInput
                  style={[styles.input, validationErrors.zipCode && styles.inputError]}
                  value={formData.location.zipCode}
                  onChangeText={(text) => updateFormField('location', 'zipCode', text)}
                  placeholder="ZIP Code"
                />
                {validationErrors.zipCode && <ThemedText style={styles.errorText}>{validationErrors.zipCode}</ThemedText>}
              </View>

              <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                <ThemedText style={styles.label}>Country</ThemedText>
                <TouchableOpacity
                  style={[styles.input, { justifyContent: 'center' }]}
                  onPress={() => bottomSheet.open(
                    <SearchablePickerBottomSheet
                      options={COUNTRY_OPTIONS}
                      selected={formData.location.country || ''}
                      onSelect={(value) => updateFormField('location', 'country', value)}
                      title="Country"
                      onClose={() => { }}
                    />
                  )}
                >
                  <ThemedText style={{ color: formData.location.country ? colors.primaryDark : colors.COLOR_BLACK_LIGHT_4 }}>
                    {formData.location.country || 'Select country'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <ThemedText style={styles.label}>Available From</ThemedText>
                <TextInput
                  style={styles.input}
                  value={formData.location.availableFrom}
                  onChangeText={(text) => updateFormField('location', 'availableFrom', text)}
                  placeholder="MM/DD/YYYY"
                />
              </View>

              <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                <ThemedText style={styles.label}>Lease Term</ThemedText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {['3 months', '6 months', '12 months', 'Month-to-month', 'Flexible'].map((term) => (
                    <TouchableOpacity
                      key={term}
                      style={[
                        styles.propertyTypeButton,
                        formData.location.leaseTerm === term && styles.propertyTypeButtonSelected
                      ]}
                      onPress={() => updateFormField('location', 'leaseTerm', term)}
                    >
                      <ThemedText
                        style={[
                          styles.propertyTypeText,
                          formData.location.leaseTerm === term && styles.propertyTypeTextSelected
                        ]}
                      >
                        {term}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </View>
        );

      case 'Pricing':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>Pricing</ThemedText>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <ThemedText style={styles.label}>Monthly Rent</ThemedText>
                <TextInput
                  style={[styles.input, validationErrors.monthlyRent && styles.inputError]}
                  value={formData.pricing.monthlyRent?.toString() || ''}
                  onChangeText={(text) => updateFormField('pricing', 'monthlyRent', parseFloat(text) || 0)}
                  keyboardType="numeric"
                  placeholder="0"
                />
                {validationErrors.monthlyRent && <ThemedText style={styles.errorText}>{validationErrors.monthlyRent}</ThemedText>}
              </View>

              <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                <ThemedText style={styles.label}>Currency</ThemedText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(['USD', 'EUR', 'GBP', 'CAD', 'MXN', 'FAIR (FairCoin)', 'Other'] as string[]).map((currency: string) => (
                    <TouchableOpacity
                      key={currency}
                      style={[
                        styles.propertyTypeButton,
                        formData.pricing.currency === currency && styles.propertyTypeButtonSelected
                      ]}
                      onPress={() => updateFormField('pricing', 'currency', currency)}
                    >
                      <ThemedText
                        style={[
                          styles.propertyTypeText,
                          formData.pricing.currency === currency && styles.propertyTypeTextSelected
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
                onChangeText={(text) => updateFormField('pricing', 'securityDeposit', parseFloat(text) || 0)}
                keyboardType="numeric"
                placeholder="0"
              />
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Application Fee</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.pricing.applicationFee?.toString() || ''}
                onChangeText={(text) => updateFormField('pricing', 'applicationFee', parseFloat(text) || 0)}
                keyboardType="numeric"
                placeholder="0"
              />
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Late Fee</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.pricing.lateFee?.toString() || ''}
                onChangeText={(text) => updateFormField('pricing', 'lateFee', parseFloat(text) || 0)}
                keyboardType="numeric"
                placeholder="0"
              />
            </View>
          </View>
        );

      case 'Amenities':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>Amenities</ThemedText>

            <AmenitiesSelector
              selectedAmenities={formData.amenities.selectedAmenities || []}
              onAmenityToggle={handleAmenityToggle}
              propertyType={formData.basicInfo.propertyType}
              style={styles.amenitiesSelector}
            />
          </View>
        );

      case 'Coliving Features':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>Coliving Features</ThemedText>

            <View style={styles.toggleContainer}>
              <ThemedText style={styles.label}>Shared Spaces</ThemedText>
              <TouchableOpacity
                style={[styles.toggleButton, formData.colivingFeatures?.sharedSpaces ? styles.toggleButtonActive : {}]}
                onPress={() => updateFormField('colivingFeatures', 'sharedSpaces', !formData.colivingFeatures?.sharedSpaces)}
              >
                <IconComponent
                  name={formData.colivingFeatures?.sharedSpaces ? 'checkmark-circle' : 'close-circle'}
                  size={24}
                  color={formData.colivingFeatures?.sharedSpaces ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
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
                  {['Kitchen', 'Living Room', 'Coworking Area', 'Gym', 'Laundry', 'Garden', 'Terrace', 'Dining Room'].map((space) => {
                    const selected = formData.colivingFeatures?.sharedSpacesList?.includes(space);
                    return (
                      <TouchableOpacity
                        key={space}
                        style={[
                          styles.propertyTypeButton,
                          selected && styles.propertyTypeButtonSelected
                        ]}
                        onPress={() => {
                          const current = formData.colivingFeatures?.sharedSpacesList || [];
                          const updated = selected
                            ? current.filter((s: string) => s !== space)
                            : [...current, space];
                          updateFormField('colivingFeatures', 'sharedSpacesList', updated);
                        }}
                      >
                        <ThemedText style={[styles.propertyTypeText, selected && styles.propertyTypeTextSelected]}>
                          {space}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <ThemedText style={[styles.label, { marginTop: 16 }]}>Other shared spaces or features</ThemedText>
                <TextInput
                  style={styles.input}
                  value={formData.colivingFeatures?.otherFeatures || ''}
                  onChangeText={(text) => updateFormField('colivingFeatures', 'otherFeatures', text)}
                  placeholder="e.g., Rooftop, Cinema Room, Pool, etc."
                />
              </View>
            )}

            <View style={styles.toggleContainer}>
              <ThemedText style={styles.label}>Community Events</ThemedText>
              <TouchableOpacity
                style={[styles.toggleButton, formData.colivingFeatures?.communityEvents ? styles.toggleButtonActive : {}]}
                onPress={() => updateFormField('colivingFeatures', 'communityEvents', !formData.colivingFeatures?.communityEvents)}
              >
                <IconComponent
                  name={formData.colivingFeatures?.communityEvents ? 'checkmark-circle' : 'close-circle'}
                  size={24}
                  color={formData.colivingFeatures?.communityEvents ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                />
                <ThemedText style={styles.toggleText}>
                  {formData.colivingFeatures?.communityEvents ? 'Yes' : 'No'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'Rules':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>Rules</ThemedText>

            <View style={styles.toggleContainer}>
              <ThemedText style={styles.label}>Pets Allowed</ThemedText>
              <TouchableOpacity
                style={[styles.toggleButton, formData.rules.petsAllowed ? styles.toggleButtonActive : {}]}
                onPress={() => updateFormField('rules', 'petsAllowed', !formData.rules.petsAllowed)}
              >
                <IconComponent
                  name={formData.rules.petsAllowed ? 'checkmark-circle' : 'close-circle'}
                  size={24}
                  color={formData.rules.petsAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                />
                <ThemedText style={styles.toggleText}>
                  {formData.rules.petsAllowed ? 'Yes' : 'No'}
                </ThemedText>
              </TouchableOpacity>
            </View>

            <View style={styles.toggleContainer}>
              <ThemedText style={styles.label}>Smoking Allowed</ThemedText>
              <TouchableOpacity
                style={[styles.toggleButton, formData.rules.smokingAllowed ? styles.toggleButtonActive : {}]}
                onPress={() => updateFormField('rules', 'smokingAllowed', !formData.rules.smokingAllowed)}
              >
                <IconComponent
                  name={formData.rules.smokingAllowed ? 'checkmark-circle' : 'close-circle'}
                  size={24}
                  color={formData.rules.smokingAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                />
                <ThemedText style={styles.toggleText}>
                  {formData.rules.smokingAllowed ? 'Yes' : 'No'}
                </ThemedText>
              </TouchableOpacity>
            </View>

            <View style={styles.toggleContainer}>
              <ThemedText style={styles.label}>Parties Allowed</ThemedText>
              <TouchableOpacity
                style={[styles.toggleButton, formData.rules.partiesAllowed ? styles.toggleButtonActive : {}]}
                onPress={() => updateFormField('rules', 'partiesAllowed', !formData.rules.partiesAllowed)}
              >
                <IconComponent
                  name={formData.rules.partiesAllowed ? 'checkmark-circle' : 'close-circle'}
                  size={24}
                  color={formData.rules.partiesAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                />
                <ThemedText style={styles.toggleText}>
                  {formData.rules.partiesAllowed ? 'Yes' : 'No'}
                </ThemedText>
              </TouchableOpacity>
            </View>

            <View style={styles.toggleContainer}>
              <ThemedText style={styles.label}>Guests Allowed</ThemedText>
              <TouchableOpacity
                style={[styles.toggleButton, formData.rules.guestsAllowed ? styles.toggleButtonActive : {}]}
                onPress={() => updateFormField('rules', 'guestsAllowed', !formData.rules.guestsAllowed)}
              >
                <IconComponent
                  name={formData.rules.guestsAllowed ? 'checkmark-circle' : 'close-circle'}
                  size={24}
                  color={formData.rules.guestsAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                />
                <ThemedText style={styles.toggleText}>
                  {formData.rules.guestsAllowed ? 'Yes' : 'No'}
                </ThemedText>
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <ThemedText style={styles.label}>Maximum Guests</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.rules.maxGuests?.toString() || ''}
                onChangeText={(text) => updateFormField('rules', 'maxGuests', parseInt(text) || 0)}
                keyboardType="numeric"
                placeholder="0"
              />
            </View>
          </View>
        );

      case 'Media':
        return (
          <View style={styles.formSection}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>Media</ThemedText>

            <View style={styles.mediaUploadContainer}>
              <TouchableOpacity style={styles.uploadButton}>
                <IconComponent name="cloud-upload-outline" size={32} color={colors.primaryColor} />
                <ThemedText style={styles.uploadText}>Upload Images</ThemedText>
              </TouchableOpacity>

              <ThemedText style={styles.helperText}>
                Upload high-quality images of your property. Include photos of all rooms, exterior, and any special features.
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
            <ThemedText type="subtitle" style={styles.sectionTitle}>Preview</ThemedText>

            <PropertyPreviewWidget />

            <View style={styles.submitContainer}>
              <ThemedText style={styles.helperText}>
                Review your property listing before submitting. Make sure all information is accurate and complete.
              </ThemedText>

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmit}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ThemedText style={styles.submitButtonText}>Creating...</ThemedText>
                ) : (
                  <ThemedText style={styles.submitButtonText}>Create Property</ThemedText>
                )}
              </TouchableOpacity>

              {error && (
                <ThemedText style={styles.errorText}>{error}</ThemedText>
              )}
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <Header options={{ title: 'Create Property', showBackButton: true }} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Step indicators */}
        <View style={styles.stepsContainer}>
          {steps.map((stepName, index) => (
            <View key={index} style={styles.stepItem}>
              <View
                style={[
                  styles.stepIndicator,
                  index === currentStep && styles.stepIndicatorActive,
                  index < currentStep && styles.stepIndicatorCompleted
                ]}
              >
                {index < currentStep ? (
                  <IconComponent name="checkmark" size={16} color="white" />
                ) : (
                  <ThemedText
                    style={[
                      styles.stepNumber,
                      index === currentStep && styles.stepNumberActive
                    ]}
                  >
                    {index + 1}
                  </ThemedText>
                )}
              </View>
              <ThemedText
                style={[
                  styles.stepLabel,
                  index === currentStep && styles.stepLabelActive
                ]}
              >
                {stepName}
              </ThemedText>
            </View>
          ))}
        </View>

        {/* Form content */}
        {renderStepContent()}

        {/* Navigation buttons */}
        <View style={styles.navigationContainer}>
          {currentStep > 0 && (
            <TouchableOpacity
              style={styles.navigationButton}
              onPress={prevStep}
            >
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
    backgroundColor: colors.primaryLight_2,
    borderColor: colors.primaryColor,
  },
  toggleText: {
    marginLeft: 8,
    fontSize: 14,
  },
  mediaUploadContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  uploadButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    borderStyle: 'dashed',
    padding: 24,
    width: '100%',
    marginBottom: 16,
  },
  uploadText: {
    marginTop: 8,
    color: colors.primaryColor,
    fontWeight: 'bold',
  },
  helperText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
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
});