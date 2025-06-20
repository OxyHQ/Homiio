import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import Button from '@/components/Button';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useCreateProperty } from '@/hooks/usePropertyQueries';
import { CreatePropertyData } from '@/services/propertyService';
import { useOxy } from '@oxyhq/services';

export default function CreatePropertyScreen() {
  const router = useRouter();
  const { oxyServices, activeSessionId } = useOxy();
  
  const [formData, setFormData] = useState<CreatePropertyData>({
    title: '',
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

  const createPropertyMutation = useCreateProperty();

  const handleSubmit = async () => {
    // Check authentication first
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
    
    if (!formData.title.trim()) {
      errors.push('Property title is required');
    }
    
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
      await createPropertyMutation.mutateAsync(formData);
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
          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Property Title *</ThemedText>
            <TextInput
              style={styles.textInput}
              value={formData.title}
              onChangeText={(text) => updateField('title', text)}
              placeholder="Enter property title"
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
    color: colors.primaryLight,
    fontWeight: '600',
  },
});
