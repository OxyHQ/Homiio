import React, { type MutableRefObject } from 'react';
import { Modal, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import Map, { type MapApi, type AddressData } from '@/components/Map';
import { createPropertyStyles as styles } from './styles';

const fullscreenMapStyle = { flex: 1 };

interface FullscreenMapModalProps {
  visible: boolean;
  mapRef: MutableRefObject<MapApi | null>;
  onClose: () => void;
  onAddressSelect: (address: AddressData, coordinates: [number, number]) => void;
}

/**
 * Fullscreen map modal used to pick a precise location. Selecting an address
 * applies it to the form and closes the modal (handled by the parent).
 */
export function FullscreenMapModal({
  visible,
  mapRef,
  onClose,
  onAddressSelect,
}: FullscreenMapModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.fullscreenMapContainer}>
        <View style={styles.fullscreenMapHeader}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.primaryDark} />
          </TouchableOpacity>
          <ThemedText style={styles.fullscreenMapTitle}>Select Location</ThemedText>
          <TouchableOpacity style={styles.confirmButton} onPress={onClose}>
            <ThemedText style={styles.confirmButtonText}>Confirm</ThemedText>
          </TouchableOpacity>
        </View>
        <Map
          ref={mapRef}
          style={fullscreenMapStyle}
          enableAddressLookup={true}
          onAddressSelect={onAddressSelect}
          screenId="create-property-fullscreen"
        />
      </View>
    </Modal>
  );
}
