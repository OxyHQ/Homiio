/**
 * StepAddress — the reviewed address (street/number/building/unit + city/state/
 * postal/country/neighborhood) plus the map picker. Tapping the map drops a pin
 * and auto-fills the address via `onAddressSelect` (owned by `write.tsx` so it
 * can update several fields + navigate the map at once).
 */
import React, { type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import Map, { type MapApi, type AddressData } from '@/components/Map';
import { StepHeader } from '@/components/reviews/write/StepHeader';
import type { StepProps } from '@/components/reviews/write/types';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

interface StepAddressProps extends StepProps {
  mapRef: RefObject<MapApi | null>;
  onAddressSelect: (address: AddressData, coordinates: [number, number]) => void;
}

export const StepAddress: React.FC<StepAddressProps> = ({
  data,
  update,
  mapRef,
  onAddressSelect,
}) => {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <StepHeader
        title={t('reviews.write.steps.address.title')}
        subtitle={t('reviews.write.steps.address.subtitle')}
      />

      <TextFieldInput
        label={t('reviews.write.fields.street')}
        placeholder={t('reviews.write.placeholders.street')}
        value={data.street}
        onChangeText={(text) => update('street', text)}
      />
      <TextFieldInput
        label={t('reviews.write.fields.number')}
        placeholder={t('reviews.write.placeholders.number')}
        value={data.number}
        onChangeText={(text) => update('number', text)}
      />
      <TextFieldInput
        label={t('reviews.write.fields.buildingName')}
        placeholder={t('reviews.write.placeholders.buildingName')}
        value={data.building_name}
        onChangeText={(text) => update('building_name', text)}
      />
      <View style={styles.row}>
        <View style={styles.rowField}>
          <TextFieldInput
            label={t('reviews.write.fields.floor')}
            placeholder={t('reviews.write.placeholders.floor')}
            value={data.floor}
            onChangeText={(text) => update('floor', text)}
          />
        </View>
        <View style={styles.rowField}>
          <TextFieldInput
            label={t('reviews.write.fields.unit')}
            placeholder={t('reviews.write.placeholders.unit')}
            value={data.unit}
            onChangeText={(text) => update('unit', text)}
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.rowField}>
          <TextFieldInput
            label={t('reviews.write.fields.city')}
            placeholder={t('reviews.write.placeholders.city')}
            value={data.city}
            onChangeText={(text) => update('city', text)}
          />
        </View>
        <View style={styles.rowField}>
          <TextFieldInput
            label={t('reviews.write.fields.state')}
            placeholder={t('reviews.write.placeholders.state')}
            value={data.state}
            onChangeText={(text) => update('state', text)}
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.rowField}>
          <TextFieldInput
            label={t('reviews.write.fields.postalCode')}
            placeholder={t('reviews.write.placeholders.postalCode')}
            value={data.postal_code}
            onChangeText={(text) => update('postal_code', text)}
          />
        </View>
        <View style={styles.rowField}>
          <TextFieldInput
            label={t('reviews.write.fields.country')}
            placeholder={t('reviews.write.placeholders.country')}
            value={data.country}
            onChangeText={(text) => update('country', text)}
          />
        </View>
      </View>
      <TextFieldInput
        label={t('reviews.write.fields.neighborhood')}
        placeholder={t('reviews.write.placeholders.neighborhood')}
        value={data.neighborhood}
        onChangeText={(text) => update('neighborhood', text)}
      />

      <View style={styles.mapWrapper}>
        <Map
          ref={mapRef}
          style={styles.mapInner}
          enableAddressLookup
          showAddressInstructions
          onAddressSelect={onAddressSelect}
          screenId="write-review"
        />
      </View>
      <BloomText style={styles.mapHint}>
        {t('reviews.write.mapHint')}
      </BloomText>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowField: {
    flex: 1,
  },
  mapWrapper: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.mutedSubtle,
  },
  mapInner: {
    height: 280,
  },
  mapHint: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
  },
});

export default StepAddress;
