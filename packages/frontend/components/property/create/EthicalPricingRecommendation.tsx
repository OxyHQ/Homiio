import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ThemedText';
import { PropertyType } from '@homiio/shared-types';
import {
  validateEthicalPricing,
  type EthicalPricingCharacteristics,
} from '@/utils/ethicalPricing';
import type { CreatePropertyFormData } from '@/store/createPropertyFormStore';
import { createPropertyStyles as styles } from './styles';
import { colors } from '@/styles/colors';

interface EthicalPricingRecommendationProps {
  proposedRent: number;
  propertyData: CreatePropertyFormData;
}

const COLOR_WITHIN_RANGE = colors.success;
const COLOR_WARNING = colors.warning;

const toFurnishedStatus = (
  isFurnished: boolean | undefined,
): EthicalPricingCharacteristics['furnishedStatus'] => (isFurnished ? 'furnished' : 'unfurnished');

/**
 * Shows the ethical-pricing recommendation for the proposed monthly rent based
 * on the property characteristics derived from the current form data.
 *
 * Behaviour is identical to the previous inline implementation: same derived
 * characteristics, same warning thresholds, same copy.
 */
export function EthicalPricingRecommendation({
  proposedRent,
  propertyData,
}: EthicalPricingRecommendationProps) {
  const { t } = useTranslation();

  const amenities = propertyData.amenities.selectedAmenities ?? [];

  const propertyCharacteristics: EthicalPricingCharacteristics = {
    type: propertyData.basicInfo.propertyType as PropertyType,
    bedrooms: propertyData.basicInfo.bedrooms || 0,
    bathrooms: propertyData.basicInfo.bathrooms || 0,
    squareFootage: propertyData.basicInfo.squareFootage || 0,
    amenities,
    location: {
      city: propertyData.location.city || '',
      state: propertyData.location.state || '',
    },
    floor: propertyData.location.floor,
    hasElevator: amenities.includes('elevator'),
    parkingSpaces: amenities.includes('parking') ? 1 : 0,
    yearBuilt: propertyData.basicInfo.yearBuilt,
    furnishedStatus: toFurnishedStatus(amenities.includes('furnished')),
    utilitiesIncluded: amenities.includes('utilities_included'),
    petFriendly: propertyData.rules?.petsAllowed,
    hasBalcony: amenities.includes('balcony'),
    hasGarden: amenities.includes('garden'),
    proximityToTransport: propertyData.location.proximityToTransport,
    proximityToSchools: propertyData.location.proximityToSchools,
    proximityToShopping: propertyData.location.proximityToShopping,
  };

  const recommendation = validateEthicalPricing(proposedRent, propertyCharacteristics);

  return (
    <View style={styles.ethicalPricingContainer}>
      <View
        style={[
          styles.ethicalPricingCard,
          !recommendation.isWithinEthicalRange && styles.ethicalPricingWarning,
        ]}
      >
        <View style={styles.ethicalPricingHeader}>
          <Ionicons
            name={recommendation.isWithinEthicalRange ? 'checkmark-circle' : 'warning'}
            size={16}
            color={recommendation.isWithinEthicalRange ? COLOR_WITHIN_RANGE : COLOR_WARNING}
          />
          <ThemedText style={styles.ethicalPricingTitle}>
            {recommendation.isWithinEthicalRange
              ? t('property.ethicalPricing')
              : t('property.pricingReviewNeeded')}
          </ThemedText>
        </View>

        <ThemedText style={styles.ethicalPricingText}>
          {t('property.suggestedRent', { amount: recommendation.suggestedRent })}
        </ThemedText>
        <ThemedText style={styles.ethicalPricingText}>
          {t('property.maxEthicalRent', { amount: recommendation.maxRent })}
        </ThemedText>

        {!recommendation.isWithinEthicalRange && (
          <View style={styles.ethicalPricingWarning}>
            <ThemedText style={styles.ethicalPricingWarningText}>
              {t('property.ethicalPricingWarning')}
            </ThemedText>
            <ThemedText style={styles.ethicalPricingWarningText}>
              {t('property.ethicalPricingPublishWarning')}
            </ThemedText>
          </View>
        )}

        {recommendation.warnings.length > 0 && (
          <View style={styles.ethicalPricingWarnings}>
            {recommendation.warnings.map((warning, index) => (
              <ThemedText key={index} style={styles.ethicalPricingWarningText}>
                {t('property.warningBullet', { warning })}
              </ThemedText>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
