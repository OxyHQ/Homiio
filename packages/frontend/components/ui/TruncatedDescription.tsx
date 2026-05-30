/**
 * TruncatedDescription — Airbnb-style "About this place" body that
 * collapses to 4 lines and exposes a Bloom Button text variant to
 * expand. When expanded, the toggle changes to "Show less".
 *
 * Uses Bloom Typography for the body so it inherits the app's font and
 * line-height tokens. No raw `<Text>` or inline font sizes.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

interface TruncatedDescriptionProps {
  text: string;
  /** Lines visible while collapsed. Defaults to 4. */
  collapsedLines?: number;
  style?: StyleProp<ViewStyle>;
}

export const TruncatedDescription: React.FC<TruncatedDescriptionProps> = ({
  text,
  collapsedLines = 4,
  style,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  const handleToggle = useCallback(() => setExpanded((prev) => !prev), []);

  // We can't perfectly measure if the text actually exceeds N lines on
  // RN, but we can use a heuristic: if the text is long (e.g. > 240
  // chars), assume overflow. We also expose the toggle if the user has
  // already expanded so they can collapse again.
  if (!text || text.trim() === '') return null;

  const isLikelyTruncated = overflowing || text.length > 240 || expanded;

  return (
    <View style={style}>
      <BloomText
        style={styles.body}
        numberOfLines={expanded ? undefined : collapsedLines}
        onTextLayout={(event) => {
          if (!expanded && event.nativeEvent.lines.length > collapsedLines) {
            setOverflowing(true);
          }
        }}
      >
        {text}
      </BloomText>
      {isLikelyTruncated ? (
        <View style={styles.toggleAnchor}>
          <Button
            onPress={handleToggle}
            variant="ghost"
            size="small"
            accessibilityLabel={
              expanded
                ? t('property.description.showLess', 'Show less') || 'Show less'
                : t('property.description.showMore', 'Show more') || 'Show more'
            }
          >
            {expanded
              ? t('property.description.showLess', 'Show less') || 'Show less'
              : t('property.description.showMore', 'Show more') || 'Show more'}
          </Button>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  body: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.COLOR_BLACK,
  },
  toggleAnchor: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
});

export default TruncatedDescription;
