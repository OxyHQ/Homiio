/**
 * ExploreRow — one tappable row in the review-explore lists (city →
 * neighborhood → building): a Bloom `Item` (title, subtitle, a Bloom `Rating`
 * and a chevron trailing). The rating is drawn only for a real average (> 0). The screens stack rows inside one outlined Bloom
 * `Card` via `ExploreList`, so the rows share a surface instead of each drawing
 * its own border.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '@oxy.so/bloom/card';
import { Divider } from '@oxy.so/bloom/divider';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { Rating } from '@oxy.so/bloom/rating';
import { useTheme } from '@oxy.so/bloom/theme';

interface ExploreRowProps {
  title: string;
  subtitle?: string;
  /** Average rating (1–5) drawn as a Bloom `Rating` on the right; omitted when absent or 0. */
  rating?: number;
  onPress: () => void;
}

export const ExploreRow: React.FC<ExploreRowProps> = ({ title, subtitle, rating, onPress }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const hasRating = typeof rating === 'number' && rating > 0;
  const ratingLabel = hasRating ? t('reviews.ratingA11y', { rating: Number(rating.toFixed(2)) }) : '';
  return (
    <Item
      role="listitem"
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      accessibilityLabel={[title, subtitle, ratingLabel].filter(Boolean).join(', ')}
      trailing={
        <View style={styles.trailing}>
          {hasRating ? (
            <Rating value={rating} size="small" accessibilityLabel={ratingLabel} />
          ) : null}
          <RiArrowRightSLine width={20} height={20} fill={theme.colors.textTertiary} />
        </View>
      }
    />
  );
};

/** The shared outlined surface an explore list's rows sit on, with hairlines between them. */
export const ExploreList: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <Card variant="outlined" style={styles.list}>
      {rows.map((row, index) => (
        <React.Fragment key={(row as React.ReactElement).key ?? index}>
          {index > 0 ? <Divider spacing={0} /> : null}
          {row}
        </React.Fragment>
      ))}
    </Card>
  );
};

const styles = StyleSheet.create({
  list: {
    overflow: 'hidden',
    paddingVertical: 4,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});

export default ExploreRow;
