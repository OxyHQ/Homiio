/**
 * HomeFooterStrip — closing strip below the home page CTA banner.
 *
 * The home page used to carry "Verified Listings / Fair Agreements /
 * Trust Score" as a 3-up icon card grid. That reads as marketing slabs,
 * which competes with the photos above. The same trust messaging now
 * lives here as a single muted line of small print — present, scannable,
 * not loud.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';

interface HomeFooterStripProps {
  /** Pre-translated label list. Each chunk renders separated by a middot. */
  chunks: readonly string[];
}

export function HomeFooterStrip({ chunks }: HomeFooterStripProps) {
  return (
    <View className="w-full items-center px-4 py-5 md:px-8">
      <BloomText style={styles.text}>
        {chunks.map((chunk, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 ? <BloomText style={styles.separator}> · </BloomText> : null}
            <BloomText style={styles.text}>{chunk}</BloomText>
          </React.Fragment>
        ))}
      </BloomText>
    </View>
  );
}

const styles = StyleSheet.create({
  text: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
  },
  separator: {
    color: colors.COLOR_BLACK_LIGHT_4,
  },
});
