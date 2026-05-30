/**
 * Long-term mode CTA on the property detail screen.
 *
 * Mirrors the vacation BookingWidget slot but for the Idealista-style
 * application flow. When the user has an active application on this
 * property, swaps the primary CTA for a "Application submitted — view
 * status" deep link so the apply form isn't shown twice.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { showSignInModal, useOxy } from '@oxyhq/services';
import { useActiveApplicationForProperty } from '@/hooks/useApplicationQueries';
import { colors } from '@/styles/colors';

interface ApplyToRentCTAProps {
  propertyId: string;
}

export const ApplyToRentCTA: React.FC<ApplyToRentCTAProps> = ({ propertyId }) => {
  const router = useRouter();
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();
  const activeApplicationQuery = useActiveApplicationForProperty(
    isAuthenticated ? propertyId : undefined,
  );
  const activeApplication = activeApplicationQuery.data ?? null;

  const handleApply = () => {
    if (!isAuthenticated) {
      showSignInModal();
      return;
    }
    router.push({ pathname: '/properties/[id]/apply', params: { id: propertyId } });
  };

  const handleViewStatus = () => {
    if (!activeApplication) return;
    router.push({
      pathname: '/applications/[id]',
      params: { id: String(activeApplication.id) },
    });
  };

  if (activeApplication) {
    return (
      <View style={styles.card}>
        <BloomText style={styles.title}>
          {t('applications.detail.alreadySubmitted', 'Application submitted')}
        </BloomText>
        <BloomText style={styles.subtitle}>
          {t(
            'applications.detail.alreadySubmittedBody',
            'You already have an application in review for this property.',
          )}
        </BloomText>
        <Button
          variant="primary"
          size="medium"
          onPress={handleViewStatus}
          style={styles.button}
        >
          {t('applications.detail.viewStatus', 'View status')}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <BloomText style={styles.title}>
        {t('applications.cta.title', 'Interested in this place?')}
      </BloomText>
      <BloomText style={styles.subtitle}>
        {t(
          'applications.cta.subtitle',
          'Submit a quick application with your move-in date, income and references — the landlord reviews and replies inside Homiio.',
        )}
      </BloomText>
      <Button
        variant="primary"
        size="medium"
        onPress={handleApply}
        style={styles.button}
      >
        {t('applications.cta.apply', 'Apply to rent')}
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    marginVertical: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  subtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 18,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
});

export default ApplyToRentCTA;
