import React, { useContext } from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import Map from '@/components/Map';
import { SearchablePickerBottomSheet } from '@/components/SearchablePickerBottomSheet';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { COUNTRY_OPTIONS, STATE_OPTIONS, MAP_HEIGHT } from './constants';
import { createPropertyStyles as styles } from './styles';
import type { LocationStepProps } from './types';

const mapStyle = { height: MAP_HEIGHT };

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
  const bottomSheet = useContext(BottomSheetContext);
  const { location } = formData;

  return (
    <View>
      <ThemedText type="subtitle">{t('propertyCreate.location.title')}</ThemedText>

      <View style={styles.formGroup}>
        <ThemedText style={styles.addressInstructions}>
          {t('propertyCreate.location.instructions')}
        </ThemedText>
      </View>

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
          <TouchableOpacity style={styles.fullscreenButton} onPress={onOpenFullscreenMap}>
            <Ionicons name="expand" size={20} color={colors.primaryDark} />
          </TouchableOpacity>
        </View>
        {validationErrors.coordinates && (
          <ThemedText style={styles.errorText}>{validationErrors.coordinates}</ThemedText>
        )}
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>{t('propertyCreate.location.country')}</ThemedText>
        <TouchableOpacity
          style={[styles.input, styles.inputCentered]}
          onPress={() =>
            bottomSheet.openBottomSheet(
              <SearchablePickerBottomSheet
                options={[...COUNTRY_OPTIONS]}
                selected={location.country || ''}
                onSelect={(value) => updateFormField('location', 'country', value)}
                title={t('propertyCreate.location.countryPickerTitle')}
                onClose={() => {}}
              />,
            )
          }
        >
          <ThemedText
            style={location.country ? styles.pickerValueSelected : styles.pickerValuePlaceholder}
          >
            {location.country || t('propertyCreate.location.selectCountry')}
          </ThemedText>
        </TouchableOpacity>
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>{t('propertyCreate.location.street')}</ThemedText>
        <TextInput
          style={[styles.input, validationErrors.address && styles.inputError]}
          value={location.address}
          onChangeText={(text) => updateFormField('location', 'address', text)}
          placeholder={t('propertyCreate.location.streetPlaceholder')}
        />
        {validationErrors.address && (
          <ThemedText style={styles.errorText}>{validationErrors.address}</ThemedText>
        )}
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>{t('propertyCreate.location.unitOptional')}</ThemedText>
        <TextInput
          style={styles.input}
          value={location.unit || ''}
          onChangeText={(text) => updateFormField('location', 'unit', text)}
          placeholder={t('propertyCreate.location.unitPlaceholder')}
        />
      </View>

      {/* Additional Canonical Address Fields */}
      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>{t('propertyCreate.location.buildingNameOptional')}</ThemedText>
          <TextInput
            style={styles.input}
            value={location.building_name || ''}
            onChangeText={(text) => updateFormField('location', 'building_name', text)}
            placeholder={t('propertyCreate.location.buildingNamePlaceholder')}
          />
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>{t('propertyCreate.location.blockOptional')}</ThemedText>
          <TextInput
            style={styles.input}
            value={location.block || ''}
            onChangeText={(text) => updateFormField('location', 'block', text)}
            placeholder={t('propertyCreate.location.blockPlaceholder')}
          />
        </View>
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>{t('propertyCreate.location.entranceOptional')}</ThemedText>
          <TextInput
            style={styles.input}
            value={location.entrance || ''}
            onChangeText={(text) => updateFormField('location', 'entrance', text)}
            placeholder={t('propertyCreate.location.entrancePlaceholder')}
          />
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>{t('propertyCreate.location.subunitOptional')}</ThemedText>
          <TextInput
            style={styles.input}
            value={location.subunit || ''}
            onChangeText={(text) => updateFormField('location', 'subunit', text)}
            placeholder={t('propertyCreate.location.subunitPlaceholder')}
          />
        </View>
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <View style={styles.labelContainer}>
            <ThemedText style={styles.label}>{t('propertyCreate.location.number')}</ThemedText>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={colors.COLOR_BLACK_LIGHT_4}
            />
          </View>
          <View style={styles.addressDetailWrapper}>
            <View style={styles.addressDetailContainer}>
              <TextInput
                style={[styles.detailInput, validationErrors.number && styles.inputError]}
                value={location.number || ''}
                onChangeText={(text) => updateFormField('location', 'number', text)}
                placeholder={t('propertyCreate.location.numberPlaceholder')}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.messageContainer}>
              {validationErrors.number && (
                <ThemedText style={styles.fieldError}>{validationErrors.number}</ThemedText>
              )}
            </View>
          </View>
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <View style={styles.labelContainer}>
            <ThemedText style={styles.label}>{t('propertyCreate.location.floor')}</ThemedText>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={colors.COLOR_BLACK_LIGHT_4}
            />
          </View>
          <View style={styles.addressDetailWrapper}>
            <View style={styles.addressDetailContainer}>
              <TextInput
                style={[styles.detailInput, validationErrors.floor && styles.inputError]}
                value={location.floor?.toString() || ''}
                onChangeText={onFloorChange}
                placeholder={t('propertyCreate.location.floorPlaceholder')}
                keyboardType="numeric"
              />
              <TouchableOpacity
                style={[styles.privacyToggle, location.showFloor && styles.privacyToggleActive]}
                onPress={() => onShowFloorToggle(!location.showFloor)}
              >
                <Ionicons
                  name={location.showFloor ? 'eye-outline' : 'eye-off-outline'}
                  size={20}
                  color={location.showFloor ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                />
                <ThemedText
                  style={[
                    styles.privacyToggleText,
                    location.showFloor && styles.privacyToggleTextActive,
                  ]}
                >
                  {location.showFloor ? t('propertyCreate.location.floorPublic') : t('propertyCreate.location.floorPrivate')}
                </ThemedText>
              </TouchableOpacity>
            </View>
            <View style={styles.messageContainer}>
              {validationErrors.floor && (
                <ThemedText style={styles.fieldError}>{validationErrors.floor}</ThemedText>
              )}
              {location.floor && !location.showFloor && (
                <ThemedText style={styles.privacyMessage}>
                  {t('propertyCreate.location.floorPrivacyHint')}
                </ThemedText>
              )}
            </View>
          </View>
        </View>
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>{t('propertyCreate.location.neighborhoodOptional')}</ThemedText>
        <TextInput
          style={styles.input}
          value={location.neighborhood || ''}
          onChangeText={(text) => updateFormField('location', 'neighborhood', text)}
          placeholder={t('propertyCreate.location.neighborhoodPlaceholder')}
        />
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>{t('propertyCreate.location.districtOptional')}</ThemedText>
        <TextInput
          style={styles.input}
          value={location.district || ''}
          onChangeText={(text) => updateFormField('location', 'district', text)}
          placeholder={t('propertyCreate.location.districtPlaceholder')}
        />
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>{t('propertyCreate.location.poBoxOptional')}</ThemedText>
          <TextInput
            style={styles.input}
            value={location.po_box || ''}
            onChangeText={(text) => updateFormField('location', 'po_box', text)}
            placeholder={t('propertyCreate.location.poBoxPlaceholder')}
          />
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>{t('propertyCreate.location.referenceOptional')}</ThemedText>
          <TextInput
            style={styles.input}
            value={location.reference || ''}
            onChangeText={(text) => updateFormField('location', 'reference', text)}
            placeholder={t('propertyCreate.location.referencePlaceholder')}
          />
        </View>
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>{t('propertyCreate.location.cityDistrict')}</ThemedText>
          <TextInput
            style={[styles.input, validationErrors.city && styles.inputError]}
            value={location.city}
            onChangeText={(text) => updateFormField('location', 'city', text)}
            placeholder={t('propertyCreate.location.cityDistrictPlaceholder')}
          />
          {validationErrors.city && (
            <ThemedText style={styles.errorText}>{validationErrors.city}</ThemedText>
          )}
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>{t('propertyCreate.location.state')}</ThemedText>
          <TouchableOpacity
            style={[styles.input, styles.inputCentered]}
            onPress={() =>
              bottomSheet.openBottomSheet(
                <SearchablePickerBottomSheet
                  options={[...STATE_OPTIONS]}
                  selected={location.state || ''}
                  onSelect={(value) => updateFormField('location', 'state', value)}
                  title={t('propertyCreate.location.statePickerTitle')}
                  onClose={() => {}}
                />,
              )
            }
          >
            <ThemedText
              style={location.state ? styles.pickerValueSelected : styles.pickerValuePlaceholder}
            >
              {location.state || t('propertyCreate.location.selectState')}
            </ThemedText>
          </TouchableOpacity>
          {validationErrors.state && (
            <ThemedText style={styles.errorText}>{validationErrors.state}</ThemedText>
          )}
        </View>
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>{t('propertyCreate.location.zipPostalCode')}</ThemedText>
        <TextInput
          style={[styles.input, validationErrors.postal_code && styles.inputError]}
          value={location.postal_code}
          onChangeText={(text) => updateFormField('location', 'postal_code', text)}
          placeholder={t('propertyCreate.location.zipPlaceholder')}
          keyboardType="numeric"
        />
        {validationErrors.postal_code && (
          <ThemedText style={styles.errorText}>{validationErrors.postal_code}</ThemedText>
        )}
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>{t('propertyCreate.location.availableFrom')}</ThemedText>
          <TextInput
            style={styles.input}
            value={location.availableFrom}
            onChangeText={(text) => updateFormField('location', 'availableFrom', text)}
            placeholder={t('propertyCreate.location.availableFromPlaceholder')}
          />
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>{t('propertyCreate.location.leaseTerm')}</ThemedText>
          <TextInput
            style={styles.input}
            value={location.leaseTerm}
            onChangeText={(text) => updateFormField('location', 'leaseTerm', text)}
            placeholder={t('propertyCreate.location.leaseTermPlaceholder')}
          />
        </View>
      </View>
    </View>
  );
}
