import React from 'react';
import { StyleSheet } from 'react-native';

import { Admonition } from '@oxy.so/bloom/admonition';

import { SECTION_GUTTER } from '@/components/property/Section';

/** Standing anti-fraud reminder on the property detail screen. */
export const FraudWarning: React.FC<{ text: string }> = ({ text }) => (
  <Admonition type="warning" style={styles.container}>
    {text}
  </Admonition>
);

const styles = StyleSheet.create({
  container: {
    marginHorizontal: SECTION_GUTTER,
  },
});
