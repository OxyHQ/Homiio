/**
 * LandlordSection — who offers this listing, on the property detail screen.
 *
 * The host is Bloom's `HostCard`, filled ONLY from real data: the public
 * profile's name, Oxy avatar, identity verification, the super-host flag
 * (identity + background verified) and the month the profile was created.
 * Nothing is drawn for what Homiio does not know — no response rate, no
 * rating, no invented stats. With no profile there is no card.
 *
 * Public-housing listings name the housing authority of the listing's region
 * and link to its application website instead. Below the card: follow the
 * host, and the host's other listings.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { RiCalendarLine, RiGlobalLine } from '@oxy.so/bloom/icons';
import { HostCard } from '@oxy.so/bloom/listing-details';
import { FollowButton, useOxy } from '@oxy.so/services';
import { deviceTimeZone, formatDate, type Profile, type Property } from '@homiio/shared-types';

import { Section, SECTION_GUTTER } from '@/components/property/Section';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { PropertyCard } from '@/components/PropertyCard';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { useFormatting } from '@/utils/format';
import { isSuperHost, resolveHostName } from '@/utils/host';
import { hairline, spacing } from '@/constants/styles';

interface LandlordSectionProps {
  property: Property;
  landlordProfile: Profile | null;
  ownerProperties: Property[];
  onApplyPublic: () => void;
}

export const LandlordSection: React.FC<LandlordSectionProps> = ({
  property,
  landlordProfile,
  ownerProperties,
  onApplyPublic,
}) => {
  const router = useRouter();
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const { user } = useOxy();
  const { getAvatarFileId } = useOxyAvatars([landlordProfile?.oxyUserId]);

  const isPublicHousing = property?.housingType === 'public';
  const landlordOxyUserId = landlordProfile?.oxyUserId;

  const profileCreatedAt = landlordProfile?.createdAt;
  const hostingSince = useMemo(
    () =>
      profileCreatedAt
        ? formatDate(profileCreatedAt, locale, deviceTimeZone(), { month: 'long', year: 'numeric' })
        : '',
    [profileCreatedAt, locale],
  );

  if (isPublicHousing) {
    const region = property.address?.regionName;
    return (
      <Section title={t('listing.cta.housingAuthority')}>
        <View style={styles.stack}>
          <HostCard
            name={
              region
                ? t('property.host.regionAuthority', { region })
                : t('property.host.publicAuthority')
            }
            label={t('property.host.publicSubtitle')}
          />
          <Button
            leadingIcon={RiGlobalLine}
            onPress={onApplyPublic}
            variant="primary"
            size="large"
            style={styles.start}
          >
            {t('listing.cta.applyOnStateWebsite')}
          </Button>
        </View>
      </Section>
    );
  }

  if (!landlordProfile) return null;

  const avatar =
    getAvatarFileId(landlordProfile.oxyUserId) ??
    landlordProfile.personalProfile?.personalInfo?.avatar ??
    landlordProfile.avatar;
  const showFollowButton = Boolean(
    landlordOxyUserId && user?.id && user.id !== landlordOxyUserId,
  );

  return (
    <Section title={t('listing.cta.landlord')} fullBleed>
      <View style={styles.stack}>
        <View style={styles.gutter}>
          <HostCard
            name={resolveHostName(landlordProfile)}
            avatar={avatar}
            verified={Boolean(landlordProfile.personalProfile?.verification?.identity)}
            verifiedLabel={t('property.host.verified')}
            label={isSuperHost(landlordProfile) ? t('property.host.superHost') : undefined}
            details={
              hostingSince
                ? [{ icon: RiCalendarLine, text: `${t('property.host.hostingSince')} ${hostingSince}` }]
                : undefined
            }
            onPressProfile={
              landlordOxyUserId ? () => router.push(`/roommates/${landlordOxyUserId}`) : undefined
            }
          />
        </View>

        {showFollowButton && landlordOxyUserId ? (
          <View style={[styles.gutter, styles.start]}>
            <FollowButton userId={landlordOxyUserId} size="small" />
          </View>
        ) : null}

        {ownerProperties.length > 0 ? (
          <View style={styles.ownerProperties}>
            <HomeCarouselSection
              title={t('listing.cta.moreByOwner')}
              items={ownerProperties}
              loading={false}
              renderItem={(prop) => (
                <PropertyCard
                  property={prop}
                  variant="compact"
                  onPress={() => router.push(`/properties/${prop.id}`)}
                  showSaveButton={false}
                  showVerifiedBadge={false}
                />
              )}
            />
          </View>
        ) : null}
      </View>
    </Section>
  );
};

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
  gutter: {
    paddingHorizontal: SECTION_GUTTER,
  },
  start: {
    alignSelf: 'flex-start',
  },
  ownerProperties: {
    paddingTop: spacing.md,
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
  },
});

export default LandlordSection;
