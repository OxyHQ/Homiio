import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BaseWidget } from './BaseWidget';

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
    lineHeight: 20,
  },
});
