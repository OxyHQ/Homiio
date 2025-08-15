import React from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';

import { LogoIcon } from '@/assets/logo';
import { colors } from '@/styles/colors';

export const Logo = () => {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push('/')}
      style={({ pressed }) => [
        pressed ? { backgroundColor: `${colors.primaryColor}33` } : {},
        styles.container,
      ]}
    >
      <View style={styles.logoContainer}>
        <LogoIcon style={styles.logoSvg} size={28} color={colors.primaryColor} />
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 'auto',
    marginBottom: 10,
    borderRadius: 1000,
    padding: 10,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  },
  logoContainer: {},
  logoSvg: {},
});
