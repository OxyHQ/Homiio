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
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@oxyhq/bloom/avatar';
import { Badge } from '@oxyhq/bloom/badge';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { SECTION_GUTTER } from '@/components/property/Section';
import type { Profile, Property } from '@homiio/shared-types';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';

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
  const [pressed, setPressed] = useState(false);
  const { getAvatarFileId } = useOxyAvatars([landlordProfile?.oxyUserId]);

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
  // Prefer the Oxy avatar file id (resolved to a URL by the registered
  // ImageResolver); fall back to a profile-local custom avatar.
  const avatarSource = useMemo(() => {
    if (!landlordProfile) return undefined;
    return (
      getAvatarFileId(landlordProfile.oxyUserId) ??
      landlordProfile.personalProfile?.personalInfo?.avatar ??
      landlordProfile.avatar
    );
  }, [landlordProfile, getAvatarFileId]);

  const handleOpenProfile = () => {
    if (profileId) {
      router.push(`/profile/${profileId}`);
    }
  };

  // Public-housing listings get a different treatment: the host is a
  // government authority, so we surface the state name and skip the
  // personal-profile bits that don't apply.
  if (property?.housingType === 'public') {
    const state = property.address?.regionName;
    return (
      <View style={styles.card}>
        <View style={styles.governmentAvatar}>
          <Ionicons name="library" size={28} color={colors.white} />
        </View>
        <View style={styles.body}>
          <H3 style={styles.name}>
            {state
              ? `${state} Housing Authority`
              : t('property.host.publicAuthority')}
          </H3>
          <BloomText style={styles.subtitle}>
            {t('property.host.publicSubtitle')}
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
      style={[styles.card, pressed && styles.cardPressed]}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={handleOpenProfile}
      accessibilityRole="button"
      accessibilityLabel={t('property.host.openProfile')}
    >
      <Avatar
        source={avatarSource}
        variant="thumb"
        name={displayName}
        size={72}
        verified={isVerified}
      />
      <View style={styles.body}>
        <H3 style={styles.name}>
          {t('property.host.hostedBy')} {displayName}
        </H3>
        {hostingSince ? (
          <BloomText style={styles.subtitle}>
            {t('property.host.hostingSince')} {hostingSince}
          </BloomText>
        ) : null}
        <BloomText style={styles.responseRate}>
          <Ionicons name="time-outline" size={13} color={colors.COLOR_BLACK_LIGHT_3} />{' '}
          {t('property.host.responseRate')}
        </BloomText>
        {isVerified ? (
          <View style={styles.badgeRow}>
            <Badge
              content={t('property.host.verified')}
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
    gap: spacing.lg,
    paddingHorizontal: SECTION_GUTTER,
  },
  cardPressed: {
    opacity: 0.6,
  },
  body: {
    flex: 1,
    gap: spacing.xs,
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
    backgroundColor: colors.governmentBadge,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default HostStatsCard;
