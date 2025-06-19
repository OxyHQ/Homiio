import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import Button from '@/components/Button';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useCreateProperty } from '@/hooks/usePropertyQueries';
import { CreatePropertyData } from '@/services/propertyService';

export default function CreatePropertyScreen() {
  const router = useRouter();
  const [formData, setFormData] = useState<CreatePropertyData>({
    name: '',
    address: '',
    type: 'apartment',
    description: '',
    size: 0,
    bedrooms: 1,
    bathrooms: 1,
    rent: 0,
    currency: 'USD',
    amenities: [],
  });

  const createPropertyMutation = useCreateProperty();

  const handleSubmit = async () => {
    if (!formData.name || !formData.address) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      await createPropertyMutation.mutateAsync(formData);
      router.back();
    } catch (error) {
      Alert.alert('Error', 'Failed to create property');
    }
  };

  const updateField = (field: keyof CreatePropertyData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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
            <ThemedText style={styles.label}>Property Name *</ThemedText>
            <TextInput
              style={styles.textInput}
              value={formData.name}
              onChangeText={(text) => updateField('name', text)}
              placeholder="Enter property name"
            />
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Address *</ThemedText>
            <TextInput
              style={styles.textInput}
              value={formData.address}
              onChangeText={(text) => updateField('address', text)}
              placeholder="Enter property address"
              multiline
            />
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
                value={formData.size?.toString() || ''}
                onChangeText={(text) => updateField('size', parseInt(text) || 0)}
                placeholder="0"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.halfInput}>
              <ThemedText style={styles.label}>Monthly Rent</ThemedText>
              <TextInput
                style={styles.textInput}
                value={formData.rent?.toString() || ''}
                onChangeText={(text) => updateField('rent', parseFloat(text) || 0)}
                placeholder="0"
                keyboardType="numeric"
              />
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
});
