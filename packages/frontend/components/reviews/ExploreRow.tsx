/**
 * ExploreRow — one tappable row in the review-explore lists (city →
 * neighborhood → building): a Bloom `Item` (title, subtitle, a rating `Chip`
 * and a chevron trailing). The screens stack rows inside one outlined Bloom
 * `Card` via `ExploreList`, so the rows share a surface instead of each drawing
 * its own border.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { Divider } from '@oxy.so/bloom/divider';
import { RiArrowRightSLine, RiStarFill } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { useTheme } from '@oxy.so/bloom/theme';

import { colors } from '@/styles/colors';

interface ExploreRowProps {
  title: string;
  subtitle?: string;
  /** Average rating shown as a star chip on the right. */
  rating?: number;
  onPress: () => void;
}

export const ExploreRow: React.FC<ExploreRowProps> = ({ title, subtitle, rating, onPress }) => {
  const theme = useTheme();
  return (
    <Item
      role="listitem"
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      accessibilityLabel={title}
      trailing={
        <View style={styles.trailing}>
          {typeof rating === 'number' ? (
            <Chip
              size="small"
              hue="gray"
              startIcon={<RiStarFill width={12} height={12} fill={colors.ratingStar} />}
            >
              {rating.toFixed(1)}
            </Chip>
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
