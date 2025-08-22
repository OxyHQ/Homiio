import React from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BaseWidget } from './BaseWidget';
import { ThemedText } from '../ThemedText';
import Button from '../Button';

export function HorizonInitiativeWidget() {
  const { t } = useTranslation();

  return (
    <BaseWidget
      title={t('horizon.title', 'Horizon Initiative')}
      icon={<Ionicons name="star" size={22} color="#FFD700" />}
    >
      <ThemedText style={styles.membershipText}>
        {t(
          'horizon.description',
          'Horizon is a global initiative offering fair housing, healthcare, and travel support. Integrated with Homiio, it ensures affordable living within a connected, sustainable network.',
        )}
      </ThemedText>
      <Button
        style={styles.joinButton}
        textColor="#002646"
        onPress={() => {
          const url = 'https://oxy.so/horizon';
          window.open(url, '_blank');
        }}
      >
        {t('home.horizon.learnMore', 'Learn More')}
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
    backgroundColor: '#c2e3ff',
  },
});
