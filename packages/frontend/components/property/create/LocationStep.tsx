import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { format, isValid, parse } from 'date-fns';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { DatePicker } from '@oxy.so/bloom/date-picker';
import { Field } from '@oxy.so/bloom/field';
import { RiExpandDiagonalSLine, RiEyeLine, RiEyeOffLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { ThemedText } from '@/components/ThemedText';
import Map from '@/components/Map';
import { COUNTRY_OPTIONS, STATE_OPTIONS, MAP_HEIGHT } from './constants';
import { WizardSelect, WizardTextField } from './fields';
import { createPropertyStyles as styles } from './styles';
import type { LocationStepProps } from './types';

const mapStyle = { height: MAP_HEIGHT };
/** `availableFrom` is stored as a calendar day. */
const DAY_FORMAT = 'yyyy-MM-dd';

/**
 * "Location" wizard step: interactive map with address lookup, country/state
 * pickers, and the full set of canonical address fields.
 */
export function LocationStep({
  formData,
  validationErrors,
  updateFormField,
  mapRef,
  onAddressSelect,
  onOpenFullscreenMap,
  onFloorChange,
  onShowFloorToggle,
}: LocationStepProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { location } = formData;

  const availableFromDate = useMemo(() => {
    if (!location.availableFrom) return null;
    const parsed = parse(location.availableFrom, DAY_FORMAT, new Date());
    return isValid(parsed) ? parsed : null;
  }, [location.availableFrom]);

  const handleAvailableFrom = useCallback(
    (date: Date | null) =>
      updateFormField('location', 'availableFrom', date ? format(date, DAY_FORMAT) : ''),
    [updateFormField],
  );

  const FloorVisibilityIcon = location.showFloor ? RiEyeLine : RiEyeOffLine;

  return (
    <View style={styles.step}>
      <ThemedText type="subtitle">{t('propertyCreate.location.title')}</ThemedText>

      <ThemedText style={styles.instructions}>
        {t('propertyCreate.location.instructions')}
      </ThemedText>

      <Field error={validationErrors.coordinates}>
        <View style={styles.mapContainer}>
          <View style={styles.mapWrapper}>
            <Map
              ref={mapRef}
              style={mapStyle}
              enableAddressLookup={true}
              showAddressInstructions={true}
              onAddressSelect={onAddressSelect}
              screenId="create-property"
            />
            <Button
              variant="secondary"
              iconOnly
              leadingIcon={RiExpandDiagonalSLine}
              onPress={onOpenFullscreenMap}
              accessibilityLabel={t('propertyCreate.location.openFullscreenMap', 'Open full-screen map')}
              style={styles.mapOverlayButton}
            />
          </View>
        </View>
      </Field>

      <WizardSelect
        label={t('propertyCreate.location.country')}
        placeholder={t('propertyCreate.location.selectCountry')}
        options={COUNTRY_OPTIONS}
        value={location.country}
        onValueChange={(value) => updateFormField('location', 'country', value)}
      />

      <WizardTextField
        label={t('propertyCreate.location.street')}
        value={location.address}
        onChangeText={(text) => updateFormField('location', 'address', text)}
        placeholder={t('propertyCreate.location.streetPlaceholder')}
        error={validationErrors.address}
      />

      <WizardTextField
        label={t('propertyCreate.location.unitOptional')}
        value={location.unit || ''}
        onChangeText={(text) => updateFormField('location', 'unit', text)}
        placeholder={t('propertyCreate.location.unitPlaceholder')}
      />

      {/* Additional Canonical Address Fields */}
      <View style={styles.formRow}>
        <WizardTextField
          style={styles.formRowItem}
          label={t('propertyCreate.location.buildingNameOptional')}
          value={location.building_name || ''}
          onChangeText={(text) => updateFormField('location', 'building_name', text)}
          placeholder={t('propertyCreate.location.buildingNamePlaceholder')}
        />
        <WizardTextField
          style={styles.formRowItem}
          label={t('propertyCreate.location.blockOptional')}
          value={location.block || ''}
          onChangeText={(text) => updateFormField('location', 'block', text)}
          placeholder={t('propertyCreate.location.blockPlaceholder')}
        />
      </View>

      <View style={styles.formRow}>
        <WizardTextField
          style={styles.formRowItem}
          label={t('propertyCreate.location.entranceOptional')}
          value={location.entrance || ''}
          onChangeText={(text) => updateFormField('location', 'entrance', text)}
          placeholder={t('propertyCreate.location.entrancePlaceholder')}
        />
        <WizardTextField
          style={styles.formRowItem}
          label={t('propertyCreate.location.subunitOptional')}
          value={location.subunit || ''}
          onChangeText={(text) => updateFormField('location', 'subunit', text)}
          placeholder={t('propertyCreate.location.subunitPlaceholder')}
        />
      </View>

      <View style={styles.formRow}>
        <WizardTextField
          style={styles.formRowItem}
          label={t('propertyCreate.location.number')}
          value={location.number || ''}
          onChangeText={(text) => updateFormField('location', 'number', text)}
          placeholder={t('propertyCreate.location.numberPlaceholder')}
          keyboardType="numeric"
          error={validationErrors.number}
        />
        <WizardTextField
          style={styles.formRowItem}
          label={t('propertyCreate.location.floor')}
          value={location.floor?.toString() || ''}
          onChangeText={onFloorChange}
          placeholder={t('propertyCreate.location.floorPlaceholder')}
          keyboardType="numeric"
          error={validationErrors.floor}
          description={
            location.floor && !location.showFloor
              ? t('propertyCreate.location.floorPrivacyHint')
              : undefined
          }
        />
      </View>

      <View style={styles.optionRow}>
        <Chip
          selected={Boolean(location.showFloor)}
          onPress={() => onShowFloorToggle(!location.showFloor)}
          startIcon={
            <FloorVisibilityIcon
              size="sm"
              fill={location.showFloor ? theme.colors.primary : theme.colors.textSecondary}
            />
          }
          accessibilityLabel={`${t('propertyCreate.location.floor')}: ${
            location.showFloor
              ? t('propertyCreate.location.floorPublic')
              : t('propertyCreate.location.floorPrivate')
          }`}
        >
          {location.showFloor
            ? t('propertyCreate.location.floorPublic')
            : t('propertyCreate.location.floorPrivate')}
        </Chip>
      </View>

      <WizardTextField
        label={t('propertyCreate.location.neighborhoodOptional')}
        value={location.neighborhood || ''}
        onChangeText={(text) => updateFormField('location', 'neighborhood', text)}
        placeholder={t('propertyCreate.location.neighborhoodPlaceholder')}
      />

      <WizardTextField
        label={t('propertyCreate.location.districtOptional')}
        value={location.district || ''}
        onChangeText={(text) => updateFormField('location', 'district', text)}
        placeholder={t('propertyCreate.location.districtPlaceholder')}
      />

      <View style={styles.formRow}>
        <WizardTextField
          style={styles.formRowItem}
          label={t('propertyCreate.location.poBoxOptional')}
          value={location.po_box || ''}
          onChangeText={(text) => updateFormField('location', 'po_box', text)}
          placeholder={t('propertyCreate.location.poBoxPlaceholder')}
        />
        <WizardTextField
          style={styles.formRowItem}
          label={t('propertyCreate.location.referenceOptional')}
          value={location.reference || ''}
          onChangeText={(text) => updateFormField('location', 'reference', text)}
          placeholder={t('propertyCreate.location.referencePlaceholder')}
        />
      </View>

      <View style={styles.formRow}>
        <WizardTextField
          style={styles.formRowItem}
          label={t('propertyCreate.location.cityDistrict')}
          value={location.city}
          onChangeText={(text) => updateFormField('location', 'city', text)}
          placeholder={t('propertyCreate.location.cityDistrictPlaceholder')}
          error={validationErrors.city}
        />
        <WizardSelect
          style={styles.formRowItem}
          label={t('propertyCreate.location.state')}
          placeholder={t('propertyCreate.location.selectState')}
          options={STATE_OPTIONS}
          value={location.state}
          onValueChange={(value) => updateFormField('location', 'state', value)}
          error={validationErrors.state}
        />
      </View>

      <WizardTextField
        label={t('propertyCreate.location.zipPostalCode')}
        value={location.postal_code}
        onChangeText={(text) => updateFormField('location', 'postal_code', text)}
        placeholder={t('propertyCreate.location.zipPlaceholder')}
        keyboardType="numeric"
        error={validationErrors.postal_code}
      />

      <View style={styles.formRow}>
        <Field label={t('propertyCreate.location.availableFrom')} style={styles.formRowItem}>
          <DatePicker
            value={availableFromDate}
            onChange={handleAvailableFrom}
            weekStartsOn={1}
            placeholder={t('propertyCreate.location.availableFromPlaceholder')}
            accessibilityLabel={t('propertyCreate.location.availableFrom')}
          />
        </Field>
        <WizardTextField
          style={styles.formRowItem}
          label={t('propertyCreate.location.leaseTerm')}
          value={location.leaseTerm}
          onChangeText={(text) => updateFormField('location', 'leaseTerm', text)}
          placeholder={t('propertyCreate.location.leaseTermPlaceholder')}
        />
      </View>
    </View>
  );
}
