/**
 * Card showing a single tenant application in the list views.
 * Renders the property thumbnail + name, a status badge and the submitted
 * date. Tap routes to the appropriate detail screen (applicant vs landlord
 * lives under different routes; the parent supplies `href`).
 */
import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Avatar } from '@oxyhq/bloom/avatar';
import { TenantApplication } from '@homiio/shared-types';
import { ApplicationStatusBadge } from '@/components/ApplicationStatusBadge';
import { useProperty } from '@/hooks';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { colors } from '@/styles/colors';
import { radius, spacing, withShadow } from '@/constants/styles';

export interface ApplicationCardProps {
  application: TenantApplication;
  /** Override the default detail route (defaults to /applications/[id]). */
  href?: string;
  /** Landlord variant surfaces applicant name + income + employment. */
  variant?: 'applicant' | 'landlord';
  /** Landlord variant — applicant display name (resolved upstream). */
  applicantName?: string;
  /** Landlord variant — applicant avatar URL. */
  applicantAvatarUrl?: string;
}

const formatCurrency = (amount: number): string => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)}`;
  }
};

const formatEmployment = (status: string): string =>
  status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const ApplicationCard: React.FC<ApplicationCardProps> = ({
  application,
  href,
  variant = 'applicant',
  applicantName,
  applicantAvatarUrl,
}) => {
  const router = useRouter();
  const { property } = useProperty(application.propertyId);

  const propertyTitle = useMemo(() => {
    if (!property) return 'Property';
    return getPropertyTitle(property);
  }, [property]);

  const imageSource = useMemo(() => {
    if (!property) return null;
    return getPropertyImageSource(property);
  }, [property]);

  const submittedLabel = useMemo(
    () => format(new Date(application.submittedAt), 'MMM d, yyyy'),
    [application.submittedAt],
  );

  const handlePress = () => {
    router.push(href ?? `/applications/${application.id}`);
  };

  return (
    <Pressable
      style={styles.card}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Application ${application.id}`}
    >
      <View style={styles.thumbWrapper}>
        {imageSource ? (
          <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]} />
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <BloomText style={styles.title} numberOfLines={1}>
            {variant === 'landlord' ? applicantName ?? 'Applicant' : propertyTitle}
          </BloomText>
          <ApplicationStatusBadge status={application.status} />
        </View>
        {variant === 'landlord' ? (
          <>
            <View style={styles.applicantRow}>
              <Avatar
                size={20}
                name={applicantName ?? 'A'}
                source={applicantAvatarUrl ?? null}
              />
              <BloomText style={styles.subtitle} numberOfLines={1}>
                {propertyTitle}
              </BloomText>
            </View>
            <BloomText style={styles.meta} numberOfLines={1}>
              {formatCurrency(application.monthlyIncome)} / month ·{' '}
              {formatEmployment(application.employmentStatus)} · Move-in{' '}
              {format(new Date(application.moveInDate), 'MMM d')}
            </BloomText>
          </>
        ) : (
          <>
            <BloomText style={styles.subtitle} numberOfLines={1}>
              {application.leaseTermMonths}-month lease · Move-in{' '}
              {format(new Date(application.moveInDate), 'MMM d, yyyy')}
            </BloomText>
            <BloomText style={styles.meta} numberOfLines={1}>
              Submitted {submittedLabel}
            </BloomText>
          </>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    ...withShadow('sm'),
  },
  thumbWrapper: {
    width: 96,
    height: 96,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  body: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  applicantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    flex: 1,
  },
  meta: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
});

export default ApplicationCard;
