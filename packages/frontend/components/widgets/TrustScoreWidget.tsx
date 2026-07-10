import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth, useOxy } from '@oxyhq/services';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';

/** Opens Oxy TrustCenter — local trust score stack removed. */
export const TrustScoreWidget = React.memo(function TrustScoreWidget() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { showBottomSheet } = useOxy();

  const handlePress = useCallback(() => {
    showBottomSheet?.('TrustCenter');
  }, [showBottomSheet]);

  if (!isAuthenticated) return null;

  return (
    <BaseWidget title={t('profile.trustCenter', 'Trust center')}>
      <TouchableOpacity onPress={handlePress} style={styles.cta}>
        <Text style={styles.ctaText}>{t('profile.viewTrustCenter', 'View your Oxy Trust score')}</Text>
      </TouchableOpacity>
    </BaseWidget>
  );
});

const styles = StyleSheet.create({
  cta: { paddingVertical: 12 },
  ctaText: { color: colors.primaryColor, fontWeight: '600' },
});

export default TrustScoreWidget;
