import React, { useContext } from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
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
  const bottomSheet = useContext(BottomSheetContext);
  const { location } = formData;

  return (
    <View>
      <ThemedText type="subtitle">Location</ThemedText>

      <View style={styles.formGroup}>
        <ThemedText style={styles.addressInstructions}>
          📍 Address Details: Fill in the complete address information. Our system uses a
          hierarchical structure:
          {'\n'}• STREET level: Street name only
          {'\n'}• BUILDING level: Street + number + building details
          {'\n'}• UNIT level: Building + floor + unit/apartment details
          {'\n'}Reviews and listings are organized by these levels for better organization.
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
        <ThemedText style={styles.label}>Country or Region</ThemedText>
        <TouchableOpacity
          style={[styles.input, styles.inputCentered]}
          onPress={() =>
            bottomSheet.openBottomSheet(
              <SearchablePickerBottomSheet
                options={[...COUNTRY_OPTIONS]}
                selected={location.country || ''}
                onSelect={(value) => updateFormField('location', 'country', value)}
                title="Country or Region"
                onClose={() => {}}
              />,
            )
          }
        >
          <ThemedText
            style={location.country ? styles.pickerValueSelected : styles.pickerValuePlaceholder}
          >
            {location.country || 'Select country or region'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>Address</ThemedText>
        <TextInput
          style={[styles.input, validationErrors.address && styles.inputError]}
          value={location.address}
          onChangeText={(text) => updateFormField('location', 'address', text)}
          placeholder="Street name"
        />
        {validationErrors.address && (
          <ThemedText style={styles.errorText}>{validationErrors.address}</ThemedText>
        )}
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>Unit/Apartment Number (optional)</ThemedText>
        <TextInput
          style={styles.input}
          value={location.unit || ''}
          onChangeText={(text) => updateFormField('location', 'unit', text)}
          placeholder="Apartment, suite, etc. (optional)"
        />
      </View>

      {/* Additional Canonical Address Fields */}
      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>Building Name (optional)</ThemedText>
          <TextInput
            style={styles.input}
            value={location.building_name || ''}
            onChangeText={(text) => updateFormField('location', 'building_name', text)}
            placeholder="e.g., Torre Barcelona"
          />
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>Block (optional)</ThemedText>
          <TextInput
            style={styles.input}
            value={location.block || ''}
            onChangeText={(text) => updateFormField('location', 'block', text)}
            placeholder="e.g., Block A"
          />
        </View>
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>Entrance/Door (optional)</ThemedText>
          <TextInput
            style={styles.input}
            value={location.entrance || ''}
            onChangeText={(text) => updateFormField('location', 'entrance', text)}
            placeholder="e.g., Door 1, Entrance B"
          />
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>Sub-unit (optional)</ThemedText>
          <TextInput
            style={styles.input}
            value={location.subunit || ''}
            onChangeText={(text) => updateFormField('location', 'subunit', text)}
            placeholder="e.g., Room A"
          />
        </View>
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <View style={styles.labelContainer}>
            <ThemedText style={styles.label}>Street Number</ThemedText>
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
                placeholder="Enter number"
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
            <ThemedText style={styles.label}>Floor</ThemedText>
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
                placeholder="Enter floor"
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
                  {location.showFloor ? 'Public' : 'Private'}
                </ThemedText>
              </TouchableOpacity>
            </View>
            <View style={styles.messageContainer}>
              {validationErrors.floor && (
                <ThemedText style={styles.fieldError}>{validationErrors.floor}</ThemedText>
              )}
              {location.floor && !location.showFloor && (
                <ThemedText style={styles.privacyMessage}>
                  ℹ️ Will be shown as approximate for privacy
                </ThemedText>
              )}
            </View>
          </View>
        </View>
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>Neighborhood (optional)</ThemedText>
        <TextInput
          style={styles.input}
          value={location.neighborhood || ''}
          onChangeText={(text) => updateFormField('location', 'neighborhood', text)}
          placeholder="e.g., Gràcia, Sant Andreu, Eixample"
        />
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>District (optional)</ThemedText>
        <TextInput
          style={styles.input}
          value={location.district || ''}
          onChangeText={(text) => updateFormField('location', 'district', text)}
          placeholder="e.g., Administrative district"
        />
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>PO Box (optional)</ThemedText>
          <TextInput
            style={styles.input}
            value={location.po_box || ''}
            onChangeText={(text) => updateFormField('location', 'po_box', text)}
            placeholder="e.g., PO Box 123"
          />
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>Reference (optional)</ThemedText>
          <TextInput
            style={styles.input}
            value={location.reference || ''}
            onChangeText={(text) => updateFormField('location', 'reference', text)}
            placeholder="e.g., Near Metro Station"
          />
        </View>
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>City/District</ThemedText>
          <TextInput
            style={[styles.input, validationErrors.city && styles.inputError]}
            value={location.city}
            onChangeText={(text) => updateFormField('location', 'city', text)}
            placeholder="City or district"
          />
          {validationErrors.city && (
            <ThemedText style={styles.errorText}>{validationErrors.city}</ThemedText>
          )}
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>State/Province/Region</ThemedText>
          <TouchableOpacity
            style={[styles.input, styles.inputCentered]}
            onPress={() =>
              bottomSheet.openBottomSheet(
                <SearchablePickerBottomSheet
                  options={[...STATE_OPTIONS]}
                  selected={location.state || ''}
                  onSelect={(value) => updateFormField('location', 'state', value)}
                  title="State/Province/Region"
                  onClose={() => {}}
                />,
              )
            }
          >
            <ThemedText
              style={location.state ? styles.pickerValueSelected : styles.pickerValuePlaceholder}
            >
              {location.state || 'Select state/province/region'}
            </ThemedText>
          </TouchableOpacity>
          {validationErrors.state && (
            <ThemedText style={styles.errorText}>{validationErrors.state}</ThemedText>
          )}
        </View>
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>ZIP/Postal Code</ThemedText>
        <TextInput
          style={[styles.input, validationErrors.postal_code && styles.inputError]}
          value={location.postal_code}
          onChangeText={(text) => updateFormField('location', 'postal_code', text)}
          placeholder="ZIP or postal code"
          keyboardType="numeric"
        />
        {validationErrors.postal_code && (
          <ThemedText style={styles.errorText}>{validationErrors.postal_code}</ThemedText>
        )}
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>Available From</ThemedText>
          <TextInput
            style={styles.input}
            value={location.availableFrom}
            onChangeText={(text) => updateFormField('location', 'availableFrom', text)}
            placeholder="Available from date"
          />
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>Lease Term</ThemedText>
          <TextInput
            style={styles.input}
            value={location.leaseTerm}
            onChangeText={(text) => updateFormField('location', 'leaseTerm', text)}
            placeholder="Lease term"
          />
        </View>
      </View>
    </View>
  );
}
