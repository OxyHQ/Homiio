/**
 * Compact "Hosted by …" identity card on the property detail screen.
 *
 * Visually distinct from LandlordSection: this is the introductory
 * profile snapshot (large avatar, name, joined date, response copy,
 * verified badge) that sits high on the page. LandlordSection still
 * carries the deep-link list of "more properties by this owner" and
 * the contact/apply flows; we keep both because they do different
 * jobs in the detail page.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@oxyhq/bloom/avatar';
import { Badge } from '@oxyhq/bloom/badge';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { cardShadow, radius } from '@/constants/styles';
import type { Profile, Property } from '@homiio/shared-types';

interface HostStatsCardProps {
  property: Property;
  landlordProfile: Profile | null;
}

const monthYear = (input: string | Date | undefined): string => {
  if (!input) return '';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

const getDisplayName = (profile: Profile | null): string => {
  if (!profile) return 'Unknown host';
  switch (profile.profileType) {
    case 'personal':
      return (
        profile.personalProfile?.personalInfo?.bio ||
        profile.oxyUserId ||
        'Property owner'
      );
    case 'agency':
      return (
        profile.agencyProfile?.legalCompanyName ||
        profile.oxyUserId ||
        'Real estate agency'
      );
    case 'business':
      return (
        profile.businessProfile?.legalCompanyName ||
        profile.oxyUserId ||
        'Property management'
      );
    case 'cooperative':
      return (
        profile.cooperativeProfile?.legalName ||
        profile.oxyUserId ||
        'Housing cooperative'
      );
    default:
      return profile.oxyUserId || 'Property owner';
  }
};

export const HostStatsCard: React.FC<HostStatsCardProps> = ({
  property,
  landlordProfile,
}) => {
  const router = useRouter();
  const { t } = useTranslation();

  const displayName = useMemo(
    () => getDisplayName(landlordProfile),
    [landlordProfile],
  );

  const hostingSince = useMemo(() => {
    const created = landlordProfile?.createdAt;
    return monthYear(created);
  }, [landlordProfile]);

  const isVerified = Boolean(landlordProfile?.isActive);
  const profileId = landlordProfile?._id ?? landlordProfile?.id;
  const avatarSource = useMemo(() => {
    if (!landlordProfile) return undefined;
    if (landlordProfile.oxyUserId) {
      return `https://cdn.oxy.so/avatars/${landlordProfile.oxyUserId}`;
    }
    return landlordProfile.personalProfile?.personalInfo?.avatar ?? landlordProfile.avatar;
  }, [landlordProfile]);

  const handleOpenProfile = () => {
    if (profileId) {
      router.push(`/profile/${profileId}`);
    }
  };

  // Public-housing listings get a different treatment: the host is a
  // government authority, so we surface the state name and skip the
  // personal-profile bits that don't apply.
  if (property?.housingType === 'public') {
    const state = property.address?.state;
    return (
      <View style={[styles.card, cardShadow.md]}>
        <View style={styles.governmentAvatar}>
          <Ionicons name="library" size={28} color="#ffffff" />
        </View>
        <View style={styles.body}>
          <H3 style={styles.name}>
            {state
              ? `${state} Housing Authority`
              : t('property.host.publicAuthority', 'Public Housing Authority')}
          </H3>
          <BloomText style={styles.subtitle}>
            {t(
              'property.host.publicSubtitle',
              'Government-managed affordable housing',
            )}
          </BloomText>
          <View style={styles.badgeRow}>
            <Badge content="GOV" variant="solid" color="info" size="small" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.card, cardShadow.md]}
      onPress={handleOpenProfile}
      accessibilityRole="button"
      accessibilityLabel={t('property.host.openProfile', 'Open host profile') || 'Open host profile'}
    >
      <Avatar
        source={avatarSource}
        name={displayName}
        size={72}
        verified={isVerified}
      />
      <View style={styles.body}>
        <H3 style={styles.name}>
          {t('property.host.hostedBy', 'Hosted by')} {displayName}
        </H3>
        {hostingSince ? (
          <BloomText style={styles.subtitle}>
            {t('property.host.hostingSince', 'Hosting since')} {hostingSince}
          </BloomText>
        ) : null}
        <BloomText style={styles.responseRate}>
          <Ionicons name="time-outline" size={13} color={colors.COLOR_BLACK_LIGHT_3} />{' '}
          {t(
            'property.host.responseRate',
            'Typically responds within an hour',
          )}
        </BloomText>
        {isVerified ? (
          <View style={styles.badgeRow}>
            <Badge
              content={t('property.host.verified', 'Verified') || 'Verified'}
              variant="solid"
              color="success"
              size="small"
            />
          </View>
        ) : null}
      </View>
      <Ionicons
        name="chevron-forward"
        size={20}
        color={colors.COLOR_BLACK_LIGHT_3}
        style={styles.chevron}
      />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#ffffff',
    borderRadius: radius.lg,
    padding: 20,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  subtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  responseRate: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  chevron: {
    marginLeft: 4,
  },
  governmentAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1E40AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default HostStatsCard;
