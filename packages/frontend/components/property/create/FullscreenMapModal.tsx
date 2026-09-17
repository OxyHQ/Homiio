import React, { type MutableRefObject } from 'react';
import { Modal, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@oxy.so/bloom/button';
import { RiCloseLine } from '@oxy.so/bloom/icons';
import { H4 } from '@oxy.so/bloom/typography';
import Map, { type MapApi, type GeocodedAddress } from '@/components/Map';
import { createPropertyStyles as styles } from './styles';

const fullscreenMapStyle = { flex: 1 };

interface FullscreenMapModalProps {
  visible: boolean;
  mapRef: MutableRefObject<MapApi | null>;
  onClose: () => void;
  onAddressSelect: (address: GeocodedAddress, coordinates: [number, number]) => void;
}

/**
 * Fullscreen map modal used to pick a precise location. Selecting an address
 * applies it to the form and closes the modal (handled by the parent).
 *
 * Deliberately an RN full-screen `Modal`, not a Bloom `Dialog`: the map needs
 * the whole viewport, and Dialog's placements are a card, a side sheet or a
 * height-capped bottom sheet. The chrome inside is Bloom.
 */
export function FullscreenMapModal({
  visible,
  mapRef,
  onClose,
  onAddressSelect,
}: FullscreenMapModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.fullscreenMapContainer}>
        <View style={[styles.fullscreenMapHeader, { paddingTop: insets.top + 12 }]}>
          <Button
            variant="ghost"
            iconOnly
            leadingIcon={RiCloseLine}
            onPress={onClose}
            accessibilityLabel={t('common.close')}
          />
          <H4 style={styles.fullscreenMapTitle}>
            {t('propertyCreate.location.mapPickerTitle', 'Select Location')}
          </H4>
          <Button size="small" onPress={onClose}>
            {t('common.confirm')}
          </Button>
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
