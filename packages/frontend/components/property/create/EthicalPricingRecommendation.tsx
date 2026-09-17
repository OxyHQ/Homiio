import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AdmonitionContent,
  AdmonitionIcon,
  AdmonitionRoot,
  AdmonitionRow,
  AdmonitionText,
} from '@oxy.so/bloom/admonition';
import { StatBar } from '@oxy.so/bloom/stat-bar';
import { useTheme } from '@oxy.so/bloom/theme';
import { PropertyType, formatMoney } from '@homiio/shared-types';
import {
  validateEthicalPricing,
  type EthicalPricingCharacteristics,
} from '@/utils/ethicalPricing';
import type { CreatePropertyFormData } from '@/store/createPropertyFormStore';
import { useFormatting } from '@/utils/format';

interface EthicalPricingRecommendationProps {
  proposedRent: number;
  propertyData: CreatePropertyFormData;
}

const toFurnishedStatus = (
  isFurnished: boolean | undefined,
): EthicalPricingCharacteristics['furnishedStatus'] => (isFurnished ? 'furnished' : 'unfurnished');

/**
 * Shows the ethical-pricing recommendation for the proposed monthly rent based
 * on the property characteristics derived from the current form data.
 *
 * A Bloom `Admonition` (`tip` within range, `warning` above it) carrying the
 * suggested and maximum rent, a `StatBar` placing the proposed rent against the
 * ethical maximum, and every warning the recommendation produced — the
 * reasoning stays on screen (ADR 0004).
 */
export function EthicalPricingRecommendation({
  proposedRent,
  propertyData,
}: EthicalPricingRecommendationProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale } = useFormatting();

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

  // Every amount this renders is quoted in the LISTING's own currency (the one
  // the host is typing a rent in), never a hard-coded dollar sign.
  const currency = propertyData.pricing?.currency || 'EUR';
  const recommendation = validateEthicalPricing(proposedRent, propertyCharacteristics, {
    currency,
    locale,
  });
  const withinRange = recommendation.isWithinEthicalRange;
  const maxRent = Math.max(recommendation.maxRent, 1);

  return (
    <AdmonitionRoot type={withinRange ? 'tip' : 'warning'}>
      <AdmonitionRow>
        <AdmonitionIcon />
        <AdmonitionContent>
          <AdmonitionText style={{ fontWeight: '600' }}>
            {withinRange ? t('property.ethicalPricing') : t('property.pricingReviewNeeded')}
          </AdmonitionText>

          <StatBar
            label={t('property.suggestedRent', {
              amount: formatMoney(recommendation.suggestedRent, currency, locale),
            })}
            value={Math.min(proposedRent, maxRent)}
            max={maxRent}
            maxLabel={t('property.maxEthicalRent', {
              amount: formatMoney(recommendation.maxRent, currency, locale),
            })}
            fillColor={withinRange ? theme.colors.success : theme.colors.warning}
          />

          {!withinRange && (
            <>
              <AdmonitionText>{t('property.ethicalPricingWarning')}</AdmonitionText>
              <AdmonitionText>{t('property.ethicalPricingPublishWarning')}</AdmonitionText>
            </>
          )}

          {recommendation.warnings.map((warning, index) => (
            <AdmonitionText key={index}>{t('property.warningBullet', { warning })}</AdmonitionText>
          ))}
        </AdmonitionContent>
      </AdmonitionRow>
    </AdmonitionRoot>
  );
}
