import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { PropertyCard } from '@/components/PropertyCard';
import { Property } from '@homiio/shared-types';
import { ThemedText } from '@/components/ThemedText';

export function PropertyCardSkeletonExample() {
  const [isLoading, setIsLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);

  // Mock property data (will be replaced with real data when loaded)
  const mockProperty = useMemo(() => ({} as Property), []);

  // Simulate loading data
  useEffect(() => {
    const timer = setTimeout(() => {
      // In a real app, this would be actual property data from an API
      setProperties([mockProperty, mockProperty, mockProperty]);
      setIsLoading(false);
    }, 3000); // 3 seconds loading time

    return () => clearTimeout(timer);
  }, [mockProperty]);

  const handleRefresh = () => {
    setIsLoading(true);
    setProperties([]);
    // Simulate loading again
    setTimeout(() => {
      setProperties([mockProperty, mockProperty, mockProperty]);
      setIsLoading(false);
    }, 2000);
  };

  return (
    <ScrollView style={styles.container}>
      <ThemedText style={styles.title}>PropertyCard Skeleton Loading Example</ThemedText>
      <ThemedText style={styles.subtitle}>
        {isLoading ? 'Loading properties...' : `Loaded ${properties.length} properties`}
      </ThemedText>

      {/* Default variant with skeleton loading */}
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Default Variant</ThemedText>
        <PropertyCard
          property={mockProperty}
          isLoading={isLoading}
          variant="default"
          onPress={() => console.log('Property pressed')}
        />
      </View>

      {/* Compact variant with skeleton loading */}
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Compact Variant</ThemedText>
        <PropertyCard
          property={mockProperty}
          isLoading={isLoading}
          variant="compact"
          onPress={() => console.log('Compact property pressed')}
        />
      </View>

      {/* Featured variant with skeleton loading */}
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Featured Variant</ThemedText>
        <PropertyCard
          property={mockProperty}
          isLoading={isLoading}
          variant="featured"
          onPress={() => console.log('Featured property pressed')}
        />
      </View>

      {/* Horizontal orientation with skeleton loading */}
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Horizontal Orientation</ThemedText>
        <PropertyCard
          property={mockProperty}
          isLoading={isLoading}
          orientation="horizontal"
          onPress={() => console.log('Horizontal property pressed')}
        />
      </View>

      {/* Refresh button for testing */}
      <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh}>
        <ThemedText style={styles.refreshText}>
          Tap to Refresh and See Loading Again
        </ThemedText>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
    color: '#666',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  refreshButton: {
    marginTop: 32,
    padding: 16,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    alignItems: 'center',
  },
  refreshText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PropertyCardSkeletonExample;
