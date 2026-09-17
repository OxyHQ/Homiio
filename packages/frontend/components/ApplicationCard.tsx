/**
 * Card showing a single tenant application in the list views.
 * Renders the property thumbnail + name, a status badge and the submitted
 * date. Tap routes to the appropriate detail screen (applicant vs landlord
 * lives under different routes; the parent supplies `href`).
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { useTheme } from '@oxy.so/bloom/theme';
import { Avatar } from '@oxy.so/bloom/avatar';
import { TenantApplication, formatMoney } from '@homiio/shared-types';
import { ApplicationStatusBadge } from '@/components/ApplicationStatusBadge';
import { Card } from '@oxy.so/bloom/card';
import { ThumbnailImage } from '@/components/ui/ThumbnailImage';
import { useProperty } from '@/hooks';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { useFormatting } from '@/utils/format';
import { formatLocalized } from '@/utils/dateLocale';
import { spacing } from '@/constants/styles';

export interface ApplicationCardProps {
  application: TenantApplication;
  /** Override the default detail route (defaults to /applications/[id]). */
  href?: string;
  /** Landlord variant surfaces applicant name + income + employment. */
  variant?: 'applicant' | 'landlord';
  /** Landlord variant — applicant display name (resolved upstream). */
  applicantName?: string;
  /**
   * Landlord variant — applicant avatar Oxy file id (resolved upstream). The
   * registered ImageResolver turns it into the canonical media URL; a plain
   * profile-local URL string is also accepted as a fallback.
   */
  applicantAvatarFileId?: string;
}

const APPLICATION_INCOME_CURRENCY = 'EUR';

export const ApplicationCard: React.FC<ApplicationCardProps> = ({
  application,
  href,
  variant = 'applicant',
  applicantName,
  applicantAvatarFileId,
}) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const router = useRouter();
  const theme = useTheme();
  const secondary = { color: theme.colors.textSecondary };
  const tertiary = { color: theme.colors.textTertiary };
  const { property } = useProperty(application.propertyId);

  const propertyTitle = useMemo(() => {
    if (!property) return t('applications.card.propertyFallback');
    return getPropertyTitle(property);
  }, [property, t]);

  const imageSource = useMemo(() => {
    if (!property) return null;
    return getPropertyImageSource(property);
  }, [property]);

  const submittedLabel = useMemo(
    () => formatLocalized(new Date(application.submittedAt), 'MMM d, yyyy'),
    [application.submittedAt],
  );

  const moveInLabel = useMemo(
    () =>
      formatLocalized(
        new Date(application.moveInDate),
        variant === 'landlord' ? 'MMM d' : 'MMM d, yyyy',
      ),
    [application.moveInDate, variant],
  );

  const handlePress = () => {
    router.push(href ?? `/applications/${application.id}`);
  };

  return (
    <Card
      variant="outlined"
      radius="radius-16"
      style={styles.card}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t('applications.card.accessibility', { id: application.id })}
    >
      <View style={styles.row}>
        <View style={styles.thumb}><ThumbnailImage source={imageSource} /></View>
        <View style={styles.body}>
          <View style={styles.headerRow}>
            <BloomText style={styles.title} numberOfLines={1}>
              {variant === 'landlord' ? applicantName ?? t('applications.card.applicantFallback') : propertyTitle}
            </BloomText>
            <ApplicationStatusBadge status={application.status} />
          </View>
          {variant === 'landlord' ? (
            <>
              <View style={styles.applicantRow}>
                <Avatar
                  size={20}
                  name={applicantName ?? 'A'}
                  source={applicantAvatarFileId ?? null}
                  variant="thumb"
                />
                <BloomText style={[styles.subtitle, secondary]} numberOfLines={1}>
                  {propertyTitle}
                </BloomText>
              </View>
              <BloomText style={[styles.meta, tertiary]} numberOfLines={1}>
                {formatMoney(application.monthlyIncome, APPLICATION_INCOME_CURRENCY, locale)}
                {t('applications.card.perMonth')} ·{' '}
                {t(`profile.edit.options.employmentStatus.${application.employmentStatus}`)} ·{' '}
                {t('applications.card.moveIn')} {moveInLabel}
              </BloomText>
            </>
          ) : (
            <>
              <BloomText style={[styles.subtitle, secondary]} numberOfLines={1}>
                {t('applications.card.monthLease', { count: application.leaseTermMonths })} ·{' '}
                {t('applications.card.moveIn')} {moveInLabel}
              </BloomText>
              <BloomText style={[styles.meta, tertiary]} numberOfLines={1}>
                {t('applications.card.submitted', { date: submittedLabel })}
              </BloomText>
            </>
          )}
        </View>
      </View>
    </Card>
  );
};

/** Edge length of the square thumbnail slot. */
const THUMBNAIL_SIZE = 96;

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
  },
  thumb: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
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
    flex: 1,
  },
  meta: {
    fontSize: 12,
  },
});

export default ApplicationCard;
