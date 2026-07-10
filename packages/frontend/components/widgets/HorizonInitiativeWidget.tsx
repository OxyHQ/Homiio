import React from 'react';
import { StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BaseWidget } from './BaseWidget';
import { ThemedText } from '../ThemedText';
import { Button } from '@oxyhq/bloom/button';
import { colors } from '@/styles/colors';

export function HorizonInitiativeWidget() {
  const { t } = useTranslation();

  return (
    <BaseWidget
      title={t('horizon.title')}
      icon={<Ionicons name="star" size={22} color={colors.ratingStar} />}
    >
      <ThemedText style={styles.membershipText}>
        {t('horizon.description')}
      </ThemedText>
      <Button
        style={styles.joinButton}
        textStyle={styles.joinButtonText}
        onPress={() => {
          Linking.openURL('https://oxy.so/horizon').catch(() => undefined);
        }}
      >
        {t('home.horizon.learnMore')}
      </Button>
    </BaseWidget>
  );
}

const styles = StyleSheet.create({
  membershipText: {
    marginBottom: 15,
    lineHeight: 20,
  },
  joinButton: {
    backgroundColor: colors.primaryLight_1,
  },
  joinButtonText: {
    color: colors.primarySubtleForeground,
  },
});
