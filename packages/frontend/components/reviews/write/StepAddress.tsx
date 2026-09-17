/**
 * StepAddress — the reviewed address (street/number/building/unit + city/state/
 * postal/country/neighborhood) plus the map picker. Tapping the map drops a pin
 * and auto-fills the address via `onAddressSelect` (owned by `write.tsx` so it
 * can update several fields + navigate the map at once).
 */
import React, { type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Field } from '@oxy.so/bloom/field';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import Map, { type MapApi, type GeocodedAddress } from '@/components/Map';
import type { StepProps } from '@/components/reviews/write/types';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

interface StepAddressProps extends StepProps {
  mapRef: RefObject<MapApi | null>;
  onAddressSelect: (address: GeocodedAddress, coordinates: [number, number]) => void;
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
      <Field label={t('reviews.write.fields.street')}>
        <TextFieldInput
          label={t('reviews.write.fields.street')}
          placeholder={t('reviews.write.placeholders.street')}
          value={data.street}
          onChangeText={(text) => update('street', text)}
        />
      </Field>
      <Field label={t('reviews.write.fields.number')}>
        <TextFieldInput
          label={t('reviews.write.fields.number')}
          placeholder={t('reviews.write.placeholders.number')}
          value={data.number}
          onChangeText={(text) => update('number', text)}
        />
      </Field>
      <Field label={t('reviews.write.fields.buildingName')}>
        <TextFieldInput
          label={t('reviews.write.fields.buildingName')}
          placeholder={t('reviews.write.placeholders.buildingName')}
          value={data.building_name}
          onChangeText={(text) => update('building_name', text)}
        />
      </Field>
      <View style={styles.row}>
        <View style={styles.rowField}>
          <Field label={t('reviews.write.fields.floor')}>
            <TextFieldInput
              label={t('reviews.write.fields.floor')}
              placeholder={t('reviews.write.placeholders.floor')}
              value={data.floor}
              onChangeText={(text) => update('floor', text)}
            />
          </Field>
        </View>
        <View style={styles.rowField}>
          <Field label={t('reviews.write.fields.unit')}>
            <TextFieldInput
              label={t('reviews.write.fields.unit')}
              placeholder={t('reviews.write.placeholders.unit')}
              value={data.unit}
              onChangeText={(text) => update('unit', text)}
            />
          </Field>
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.rowField}>
          <Field label={t('reviews.write.fields.city')}>
            <TextFieldInput
              label={t('reviews.write.fields.city')}
              placeholder={t('reviews.write.placeholders.city')}
              value={data.city}
              onChangeText={(text) => update('city', text)}
            />
          </Field>
        </View>
        <View style={styles.rowField}>
          <Field label={t('reviews.write.fields.state')}>
            <TextFieldInput
              label={t('reviews.write.fields.state')}
              placeholder={t('reviews.write.placeholders.state')}
              value={data.state}
              onChangeText={(text) => update('state', text)}
            />
          </Field>
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.rowField}>
          <Field label={t('reviews.write.fields.postalCode')}>
            <TextFieldInput
              label={t('reviews.write.fields.postalCode')}
              placeholder={t('reviews.write.placeholders.postalCode')}
              value={data.postal_code}
              onChangeText={(text) => update('postal_code', text)}
            />
          </Field>
        </View>
        <View style={styles.rowField}>
          <Field label={t('reviews.write.fields.country')}>
            <TextFieldInput
              label={t('reviews.write.fields.country')}
              placeholder={t('reviews.write.placeholders.country')}
              value={data.country}
              onChangeText={(text) => update('country', text)}
            />
          </Field>
        </View>
      </View>
      <Field label={t('reviews.write.fields.neighborhood')}>
        <TextFieldInput
          label={t('reviews.write.fields.neighborhood')}
          placeholder={t('reviews.write.placeholders.neighborhood')}
          value={data.neighborhood}
          onChangeText={(text) => update('neighborhood', text)}
        />
      </Field>

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
