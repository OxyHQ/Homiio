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
import { View } from 'react-native';

import { Text as BloomText } from '@oxyhq/bloom/typography';

interface HomeFooterStripProps {
  /** Pre-translated label list. Each chunk renders separated by a middot. */
  chunks: readonly string[];
}

export function HomeFooterStrip({ chunks }: HomeFooterStripProps) {
  return (
    <View className="w-full items-center px-4 md:px-8 py-5">
      <BloomText className="text-center text-xs font-medium leading-[18px] text-muted-foreground">
        {chunks.map((chunk, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 ? (
              <BloomText className="text-muted-foreground/70"> · </BloomText>
            ) : null}
            <BloomText className="text-center text-xs font-medium leading-[18px] text-muted-foreground">
              {chunk}
            </BloomText>
          </React.Fragment>
        ))}
      </BloomText>
    </View>
  );
}
