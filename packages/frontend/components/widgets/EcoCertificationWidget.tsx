import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BaseWidget } from './BaseWidget';
import Button from '../Button';

export function EcoCertificationWidget() {
  const { t } = useTranslation();

  return (
    <BaseWidget
      title={t('home.eco.title', 'Eco-Certified Properties')}
      icon={<Ionicons name="leaf" size={22} color="green" />}
    >
      <View style={styles.ecoCertContent}>
        <Text style={styles.ecoText}>
          {t(
            'home.eco.description',
            'Find sustainable properties that meet eco-friendly standards',
          )}
        </Text>
        <Button
          style={styles.learnMoreButton}
          textColor="green"
        >
          {t('home.horizon.learnMore', 'Learn More')}
        </Button>
      </View>
    </BaseWidget>
  );
}

const styles = StyleSheet.create({
  ecoCertContent: {
    padding: 10,
    alignItems: 'center',
  },
  ecoText: {
    textAlign: 'center',
    marginBottom: 15,
    lineHeight: 20,
  },
  learnMoreButton: {
    backgroundColor: '#e7f4e4',
  },
});
