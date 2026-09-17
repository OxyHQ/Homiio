import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { RiErrorWarningFill } from '@oxy.so/bloom/icons';

export default function NotFoundScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <RiErrorWarningFill width={80} height={80} fill={colors.primaryColor} />
      <Text style={styles.title}>{t('notFound.title')}</Text>
      <Text style={styles.message}>{t('notFound.message')}</Text>
      <TouchableOpacity style={styles.button} onPress={() => router.back()}>
        <Text style={styles.buttonText}>{t('notFound.goBack')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginVertical: 16,
  },
  message: {
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: colors.primaryColor,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  buttonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
