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
import { useMediaQuery } from 'react-responsive';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { resolvePagePadding, spacing } from '@/constants/styles';

interface HomeFooterStripProps {
  /** Pre-translated label list. Each chunk renders separated by a middot. */
  chunks: readonly string[];
}

export function HomeFooterStrip({ chunks }: HomeFooterStripProps) {
  const isWide = useMediaQuery({ minWidth: 768 });
  const horizontalPadding = resolvePagePadding(isWide);

  return (
    <View style={[styles.strip, { paddingHorizontal: horizontalPadding }]}>
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
  strip: {
    width: '100%',
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.COLOR_BLACK_LIGHT_4,
    textAlign: 'center',
    lineHeight: 18,
  },
  separator: {
    color: colors.COLOR_BLACK_LIGHT_5,
  },
});
