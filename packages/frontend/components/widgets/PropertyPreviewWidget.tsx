import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@oxy.so/bloom/accordion';
import { Admonition } from '@oxy.so/bloom/admonition';
import { Badge } from '@oxy.so/bloom/badge';
import { Chip } from '@oxy.so/bloom/chip';
import {
  RiBankCardLine,
  RiCameraLine,
  RiCheckboxCircleFill,
  RiEyeLine,
  RiFileTextLine,
  RiInformationLine,
  RiListUnordered,
  RiMapPinLine,
} from '@oxy.so/bloom/icons';
import { StatBar } from '@oxy.so/bloom/stat-bar';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { useColors } from '@/hooks/useThemeColor';
import { BaseWidget } from './BaseWidget';
import { useCreatePropertyFormStore } from '@/store/createPropertyFormStore';
import {
  Property,
  PropertyType,
  PropertyStatus,
  OfferingType,
  UtilitiesIncluded,
  formatArea,
  formatMoney,
  type PropertyImage,
} from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';

import { PropertyCard } from '../PropertyCard';


type SectionIcon = React.ComponentType<{ width?: number; height?: number; fill?: string }>;

const SECTION_ICON_SIZE = 16;
const EMPTY_ICON_SIZE = 48;
/** Completion at or above which the listing reads as ready to publish. */
const READY_THRESHOLD = 80;
/** Amenity chips shown before the "+N more" overflow. */
const AMENITY_PREVIEW_COUNT = 6;

interface PreviewSection {
  id: string;
  title: string;
  icon: SectionIcon;
  isComplete: boolean;
  hasData: boolean;
}

/** Maps each create-property wizard step index to the preview section to expand. */
const STEP_TO_SECTION: Record<number, string> = {
  0: 'basic', // Basic Info step
  1: 'location', // Location step
  2: 'pricing', // Pricing step
  3: 'amenities', // Amenities step
  4: 'media', // Media step (or Rules step, depending on property type)
  5: 'description', // Description step or final step
};

export function PropertyPreviewWidget() {
  const { locale, areaUnitLabels } = useFormatting();
  const { formData, currentStep } = useCreatePropertyFormStore();
  const colors = useColors();
  const [expandedSections, setExpandedSections] = useState<string[]>(['basic', 'pricing']);

  // Helper function for amenity lookup - defined before useMemo hooks
  const getAmenityById = (id: string) => {
    const amenities = {
      wifi: { name: 'WiFi', icon: 'wifi' },
      parking: { name: 'Parking', icon: 'car' },
      kitchen: { name: 'Kitchen', icon: 'restaurant' },
      laundry: { name: 'Laundry', icon: 'shirt' },
      ac: { name: 'Air Conditioning', icon: 'snow' },
      heating: { name: 'Heating', icon: 'flame' },
      balcony: { name: 'Balcony', icon: 'home' },
      garden: { name: 'Garden', icon: 'leaf' },
      elevator: { name: 'Elevator', icon: 'arrow-up' },
      gym: { name: 'Gym', icon: 'fitness' },
      pool: { name: 'Pool', icon: 'water' },
      pet_friendly: { name: 'Pet Friendly', icon: 'paw' },
    };
    return amenities[id as keyof typeof amenities];
  };

  // Memoized completion status for each section
  const sections: PreviewSection[] = useMemo(
    () => [
      {
        id: 'basic',
        title: 'Basic Info',
        icon: RiInformationLine,
        isComplete: !!(
          formData?.basicInfo?.propertyType && formData?.basicInfo?.bedrooms !== undefined
        ),
        hasData: !!(
          formData?.basicInfo?.propertyType || formData?.basicInfo?.bedrooms !== undefined
        ),
      },
      {
        id: 'location',
        title: 'Location',
        icon: RiMapPinLine,
        isComplete: !!(formData?.location?.city && formData?.location?.state),
        hasData: !!(formData?.location?.city || formData?.location?.state),
      },
      {
        id: 'pricing',
        title: 'Pricing',
        icon: RiBankCardLine,
        isComplete: !!(formData?.pricing?.monthlyRent && formData?.pricing?.monthlyRent > 0),
        hasData: !!(formData?.pricing?.monthlyRent || formData?.pricing?.securityDeposit),
      },
      {
        id: 'amenities',
        title: 'Amenities',
        icon: RiListUnordered,
        isComplete: !!(
          formData?.amenities?.selectedAmenities &&
          formData?.amenities?.selectedAmenities.length > 0
        ),
        hasData: !!formData?.amenities?.selectedAmenities?.length,
      },
      {
        id: 'media',
        title: 'Photos',
        icon: RiCameraLine,
        isComplete: !!(formData?.media?.images && formData?.media?.images.length > 0),
        hasData: !!formData?.media?.images?.length,
      },
      {
        id: 'description',
        title: 'Description',
        icon: RiFileTextLine,
        isComplete: !!(
          formData?.basicInfo?.description && formData?.basicInfo?.description.length > 10
        ),
        hasData: !!formData?.basicInfo?.description,
      },
    ],
    [formData],
  );

  const completionPercentage = useMemo(() => {
    const completedSections = sections.filter((s) => s.isComplete).length;
    return Math.round((completedSections / sections.length) * 100);
  }, [sections]);

  // Auto-expand only the section for the current wizard step. This resets the
  // user's manual toggles whenever the step changes, so it is implemented with
  // React's "adjust state during render when a tracked value changes" pattern
  // instead of an effect (which caused cascading renders).
  const [prevStep, setPrevStep] = useState(currentStep);
  if (currentStep !== prevStep) {
    setPrevStep(currentStep);
    const sectionToToggle = STEP_TO_SECTION[currentStep];
    if (sectionToToggle) {
      // Only keep the current step's section expanded, collapse all others.
      setExpandedSections([sectionToToggle]);
    }
  }

  // Memoized accommodation type label
  const accommodationType = useMemo(() => {
    const typeLabels: { [key: string]: string } = {
      apartment: 'Apartment',
      house: 'House',
      room: 'Room',
      studio: 'Studio',
      couchsurfing: 'Couchsurfing',
      roommates: 'Roommates',
      coliving: 'Co-Living',
      hostel: 'Hostel',
      guesthouse: 'Guesthouse',
      campsite: 'Campsite',
      boat: 'Boat/Houseboat',
      treehouse: 'Treehouse',
      yurt: 'Yurt/Tent',
      other: 'Other',
    };
    return typeLabels[formData?.basicInfo?.propertyType || ''] || 'Property';
  }, [formData?.basicInfo?.propertyType]);

  // Memoized amenities display
  const amenitiesDisplay = useMemo(() => {
    if (
      !formData?.amenities?.selectedAmenities ||
      formData.amenities.selectedAmenities.length === 0
    )
      return [];
    return formData.amenities.selectedAmenities.slice(0, AMENITY_PREVIEW_COUNT).map((amenity: string) => {
      const amenityData = getAmenityById(amenity);
      return amenityData?.name || amenity;
    });
  }, [formData?.amenities?.selectedAmenities]);

  // Map the in-progress form data into a fully-typed Property so the live
  // PropertyCard preview matches exactly what the published listing renders.
  const previewProperty = useMemo<Property | null>(() => {
    if (!formData) return null;

    const { basicInfo, location, pricing, amenities, media } = formData;

    const resolvedType = Object.values(PropertyType).includes(
      basicInfo.propertyType as PropertyType,
    )
      ? (basicInfo.propertyType as PropertyType)
      : PropertyType.APARTMENT;

    const coordinates =
      location.latitude || location.longitude
        ? ({
            type: 'Point' as const,
            coordinates: [location.longitude, location.latitude] as [number, number],
          })
        : undefined;

    const images: PropertyImage[] = (media.images ?? []).map((image) => ({
      url: image.urls.medium,
      caption: image.caption,
      isPrimary: image.isPrimary,
    }));

    const now = new Date().toISOString();

    // Geo is relational on a real Property, but a live form preview has no
    // resolved geo ids yet — so feed the form's entered place NAMES into the
    // serialized address's resolved-name fields (which the card renders) and
    // leave the `*Id` references empty for the preview.
    const previewLocation = [location.city, location.state, location.country]
      .filter(Boolean)
      .join(', ');

    return {
      id: 'preview',
      address: {
        street: location.address ?? '',
        postal_code: location.postal_code ?? '',
        countryCode: location.countryCode ?? '',
        countryId: '',
        regionId: '',
        cityId: '',
        cityName: location.city || undefined,
        regionName: location.state || undefined,
        countryName: location.country || undefined,
        neighborhoodName: location.neighborhood || undefined,
        location: previewLocation || undefined,
        number: location.number,
        building_name: location.building_name,
        block: location.block,
        entrance: location.entrance,
        floor: location.floor !== undefined ? String(location.floor) : undefined,
        unit: location.unit,
        subunit: location.subunit,
        district: location.district,
        address_lines: location.address_lines,
        po_box: location.po_box,
        reference: location.reference,
        coordinates,
      },
      type: resolvedType,
      description: basicInfo.description,
      squareFootage: basicInfo.squareFootage,
      bedrooms: basicInfo.bedrooms,
      bathrooms: basicInfo.bathrooms,
      // Mirror the per-offering pricing so the live card preview reprices
      // exactly like the published listing in each browse mode.
      offerings: pricing.offerings,
      longTermRent: pricing.offerings.includes(OfferingType.LONG_TERM_RENT)
        ? {
            monthlyAmount: pricing.monthlyRent ?? 0,
            currency: pricing.currency || 'USD',
            deposit: pricing.securityDeposit ?? 0,
            utilities: UtilitiesIncluded.EXCLUDED,
          }
        : undefined,
      shortTermRent: pricing.offerings.includes(OfferingType.SHORT_TERM_RENT)
        ? {
            nightlyRate: pricing.nightlyRate ?? 0,
            currency: pricing.currency || 'USD',
            cleaningFee: pricing.cleaningFee,
            serviceFee: pricing.serviceFee,
            taxesPercent: pricing.taxesPercent,
            minNights: pricing.minNights,
            maxNights: pricing.maxNights,
            instantBook: pricing.instantBook,
          }
        : undefined,
      amenities: amenities.selectedAmenities ?? [],
      images,
      status: PropertyStatus.DRAFT,
      location: coordinates,
      yearBuilt: basicInfo.yearBuilt,
      createdAt: now,
      updatedAt: now,
    };
  }, [formData]);

  const yesNo = (val?: boolean) => (val === true ? 'Yes' : val === false ? 'No' : '-');

  if (!formData) {
    return (
      <BaseWidget title="Live Preview" icon={<Badge content="Preview" color="primary" variant="solid" />}>
        <View className="items-center gap-2 px-5 py-10">
          <RiEyeLine width={EMPTY_ICON_SIZE} height={EMPTY_ICON_SIZE} fill={colors.textTertiary} />
          <BloomText className="text-center text-lg font-semibold text-foreground">
            Start Building Your Listing
          </BloomText>
          <BloomText className="text-center text-sm leading-5 text-muted-foreground">
            Fill out the form to see a live preview of how your property will appear to potential
            tenants
          </BloomText>
        </View>
      </BaseWidget>
    );
  }

  const isReady = completionPercentage >= READY_THRESHOLD;
  const selectedAmenityCount = formData.amenities?.selectedAmenities?.length ?? 0;

  return (
    <BaseWidget
      title="Live Preview"
      icon={<Badge content={accommodationType} color="primary" variant="solid" />}
    >
      <View className="gap-5 pb-5">
        <StatBar
          label="Completion Progress"
          value={completionPercentage}
          max={100}
          maxLabel={`${completionPercentage}%`}
        />

        {previewProperty && (
          <PropertyCard
            property={previewProperty}
            showSaveButton={false}
            showVerifiedBadge={false}
            onPress={() => { }} // No action needed for preview
          />
        )}

        <Accordion
          type="multiple"
          value={expandedSections}
          onValueChange={(next) =>
            setExpandedSections(Array.isArray(next) ? next : next ? [next] : [])
          }
        >
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <AccordionItem key={section.id} value={section.id}>
                <AccordionTrigger
                  icon={
                    <Icon
                      width={SECTION_ICON_SIZE}
                      height={SECTION_ICON_SIZE}
                      fill={section.isComplete ? colors.primary : colors.textSecondary}
                    />
                  }
                >
                  <View className="flex-1 flex-row items-center gap-2">
                    <BloomText className="shrink text-sm font-semibold text-foreground">
                      {section.title}
                    </BloomText>
                    {section.isComplete ? (
                      <RiCheckboxCircleFill width={14} height={14} fill={colors.success} />
                    ) : null}
                  </View>
                </AccordionTrigger>
                <AccordionContent>
                  {section.id === 'basic' && (
                    <View>
                      {formData.basicInfo?.propertyType && (
                        <DataRow label="Type:" value={accommodationType} />
                      )}
                      {formData.basicInfo?.bedrooms !== undefined && (
                        <DataRow label="Bedrooms:" value={formData.basicInfo.bedrooms} />
                      )}
                      {formData.basicInfo?.bathrooms !== undefined && (
                        <DataRow label="Bathrooms:" value={formData.basicInfo.bathrooms} />
                      )}
                      {(formData.basicInfo?.squareFootage ?? 0) > 0 && (
                        <DataRow
                          label="Square Footage:"
                          value={formatArea(formData.basicInfo.squareFootage, 'sqm', locale, {
                            labels: areaUnitLabels,
                          })}
                        />
                      )}
                    </View>
                  )}

                  {section.id === 'location' && (
                    <View>
                      {formData.location?.city && (
                        <DataRow label="City:" value={formData.location.city} />
                      )}
                      {formData.location?.state && (
                        <DataRow label="State:" value={formData.location.state} />
                      )}
                      {formData.location?.postal_code && (
                        <DataRow label="ZIP Code:" value={formData.location.postal_code} />
                      )}
                    </View>
                  )}

                  {section.id === 'pricing' && (
                    <View>
                      {(formData.pricing?.monthlyRent ?? 0) > 0 && (
                        <DataRow
                          label="Monthly Rent:"
                          value={formatMoney(formData.pricing.monthlyRent, formData.pricing.currency, locale)}
                        />
                      )}
                      {(formData.pricing?.nightlyRate ?? 0) > 0 && (
                        <DataRow
                          label="Nightly Rate:"
                          value={formatMoney(formData.pricing.nightlyRate, formData.pricing.currency, locale)}
                        />
                      )}
                      {(formData.pricing?.securityDeposit ?? 0) > 0 && (
                        <DataRow
                          label="Security Deposit:"
                          value={formatMoney(formData.pricing.securityDeposit, formData.pricing.currency, locale)}
                        />
                      )}
                      {formData.pricing?.currency && (
                        <DataRow label="Currency:" value={formData.pricing.currency} />
                      )}
                      {(formData.pricing?.applicationFee ?? 0) > 0 && (
                        <DataRow
                          label="Application Fee:"
                          value={formatMoney(formData.pricing.applicationFee ?? 0, formData.pricing.currency, locale)}
                        />
                      )}
                      {(formData.pricing?.lateFee ?? 0) > 0 && (
                        <DataRow
                          label="Late Fee:"
                          value={formatMoney(formData.pricing.lateFee ?? 0, formData.pricing.currency, locale)}
                        />
                      )}
                    </View>
                  )}

                  {section.id === 'amenities' && (
                    <View className="gap-2">
                      {amenitiesDisplay.length > 0 && (
                        <View className="flex-row flex-wrap items-center gap-1.5">
                          {amenitiesDisplay.map((amenity: string) => (
                            <Chip key={amenity} size="small" variant="subtle">
                              {amenity}
                            </Chip>
                          ))}
                          {selectedAmenityCount > AMENITY_PREVIEW_COUNT && (
                            <BloomText className="text-xs text-muted-foreground">
                              +{selectedAmenityCount - AMENITY_PREVIEW_COUNT} more
                            </BloomText>
                          )}
                        </View>
                      )}
                      <View>
                        {formData.rules?.petsAllowed !== undefined && (
                          <DataRow label="Pet Friendly:" value={yesNo(formData.rules.petsAllowed)} />
                        )}
                        {formData.rules?.smokingAllowed !== undefined && (
                          <DataRow label="Smoking Allowed:" value={yesNo(formData.rules.smokingAllowed)} />
                        )}
                        {formData.rules?.partiesAllowed !== undefined && (
                          <DataRow label="Parties Allowed:" value={yesNo(formData.rules.partiesAllowed)} />
                        )}
                        {formData.rules?.guestsAllowed !== undefined && (
                          <DataRow label="Guests Allowed:" value={yesNo(formData.rules.guestsAllowed)} />
                        )}
                      </View>
                    </View>
                  )}

                  {section.id === 'media' && (
                    <DataRow
                      label="Photos:"
                      value={`${formData.media?.images ? formData.media.images.length : 0} uploaded`}
                    />
                  )}

                  {section.id === 'description' &&
                    (formData.basicInfo?.description ? (
                      <BloomText
                        className="text-[13px] leading-[18px] text-muted-foreground"
                        numberOfLines={4}
                      >
                        {formData.basicInfo.description}
                      </BloomText>
                    ) : (
                      <BloomText className="text-[13px] italic text-muted-foreground">
                        No description added yet
                      </BloomText>
                    ))}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        <Admonition type={isReady ? 'tip' : 'info'}>
          {isReady ? 'Ready to Publish' : `${100 - completionPercentage}% more to complete`}
        </Admonition>
      </View>
    </BaseWidget>
  );
}

/** One label/value line inside an expanded section. */
function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-2 border-b border-border py-1.5">
      <BloomText className="text-[13px] font-medium text-muted-foreground">{label}</BloomText>
      <BloomText className="flex-1 text-right text-[13px] font-semibold text-foreground">
        {value}
      </BloomText>
    </View>
  );
}

