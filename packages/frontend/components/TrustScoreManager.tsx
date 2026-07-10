import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { colors } from '@/styles/colors';

/** @deprecated Local trust manager removed — opens Oxy TrustCenter. */
export function TrustScoreManager() {
  const { showBottomSheet } = useOxy();
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>Trust scores are managed in Oxy Trust.</Text>
      <Pressable onPress={() => showBottomSheet?.('TrustCenter')} style={styles.btn}>
        <Text style={styles.btnText}>Open Trust Center</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  text: { color: colors.muted },
  btn: { alignSelf: 'flex-start' },
  btnText: { color: colors.primaryColor, fontWeight: '600' },
});

export default TrustScoreManager;
