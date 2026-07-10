/**
 * Card showing a single tenant application in the list views.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Avatar } from '@oxyhq/bloom/avatar';
import { TenantApplication } from '@homiio/shared-types';
import { ApplicationStatusBadge } from '@/components/ApplicationStatusBadge';
import { ThumbnailCard } from '@/components/ui/ThumbnailCard';
import { ThumbnailImage } from '@/components/ui/ThumbnailImage';
import { useProperty } from '@/hooks';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { formatCurrency } from '@/utils/currency';
import { formatLocalized } from '@/utils/dateLocale';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

export interface ApplicationCardProps {
  application: TenantApplication;
  href?: string;
  variant?: 'applicant' | 'landlord';
  applicantName?: string;
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
  const router = useRouter();
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
    () => formatLocalized(new Date(application.moveInDate), variant === 'landlord' ? 'MMM d' : 'MMM d, yyyy'),
    [application.moveInDate, variant],
  );

  const handlePress = () => {
    router.push(href ?? `/applications/${application.id}`);
  };

  return (
    <ThumbnailCard
      thumbnail={<ThumbnailImage source={imageSource} />}
      onPress={handlePress}
      accessibilityLabel={t('applications.card.accessibility', { id: application.id })}
    >
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
            <BloomText style={styles.subtitle} numberOfLines={1}>
              {propertyTitle}
            </BloomText>
          </View>
          <BloomText style={styles.meta} numberOfLines={1}>
            {formatCurrency(application.monthlyIncome, APPLICATION_INCOME_CURRENCY)}
            {t('applications.card.perMonth')} · {application.employmentStatus.replace(/_/g, ' ')} ·{' '}
            {t('applications.card.moveIn')} {moveInLabel}
          </BloomText>
        </>
      ) : (
        <>
          <BloomText style={styles.subtitle} numberOfLines={1}>
            {t('applications.card.monthLease', { count: application.leaseTermMonths })} ·{' '}
            {t('applications.card.moveIn')} {moveInLabel}
          </BloomText>
          <BloomText style={styles.meta} numberOfLines={1}>
            {t('applications.card.submitted', { date: submittedLabel })}
          </BloomText>
        </>
      )}
    </ThumbnailCard>
  );
};

const styles = StyleSheet.create({
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
