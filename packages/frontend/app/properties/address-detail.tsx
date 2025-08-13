import { AddressDisplay } from '@/components/AddressDisplay';
import { ThemedText } from '@/components/ThemedText';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

// Example component showing how to navigate to Address Detail Screen
export default function AddressDetailExample() {
  const router = useRouter();

  const exampleAddress = {
    street: '123 Main Street',
    city: 'New York',
    state: 'NY',
    zipCode: '10001',
    country: 'USA',
    coordinates: {
      lat: 40.7505,
      lng: -73.9934,
    },
  };

  const handleNavigateToAddressDetail = () => {
    const params = new URLSearchParams({
      street: exampleAddress.street,
      city: exampleAddress.city,
      state: exampleAddress.state,
      zipCode: exampleAddress.zipCode,
      country: exampleAddress.country,
      lat: exampleAddress.coordinates.lat.toString(),
      lng: exampleAddress.coordinates.lng.toString(),
      propertyId: 'example-property-id', // Optional
    });

    router.push(`/properties/address-detail?${params.toString()}`);
  };

  return (
    <View style={styles.container}>
      <ThemedText type="title" style={styles.title}>
        Address Detail Screen Example
      </ThemedText>

      <AddressDisplay
        address={exampleAddress}
        variant="card"
        showActions={true}
        onPress={handleNavigateToAddressDetail}
        style={styles.addressCard}
      />

      <TouchableOpacity style={styles.button} onPress={handleNavigateToAddressDetail}>
        <ThemedText style={styles.buttonText}>View Address Details</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    marginBottom: 30,
    textAlign: 'center',
  },
  addressCard: {
    marginBottom: 30,
    width: '100%',
  },
  button: {
    backgroundColor: '#0047bf',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
