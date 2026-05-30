/**
 * StickyPropertyHeader — slim bar that appears once the user has
 * scrolled past the photo grid on `/properties/[id]`. Holds the
 * property name + price on the left, share/save/CTA on the right.
 *
 * Web only. Uses `position: sticky` (RN-Web). On native we let the
 * existing `Header` component do the same job since native already
 * supports sticky headers via `react-navigation`.
 */
import React, { useCallback } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { SaveButton } from '@/components/SaveButton';
import { colors } from '@/styles/colors';
import { hairline, spacing } from '@/constants/styles';
import type { Property, RentMode } from '@homiio/shared-types';

interface StickyPropertyHeaderProps {
  title: string;
  priceLabel: string;
  property: Property | null;
  rentalMode: 'long_term' | 'vacation';
  /** Whether the header is currently shown (driven by scroll position). */
  visible: boolean;
  onShare: () => void;
  onCtaPress: () => void;
}

export const StickyPropertyHeader: React.FC<StickyPropertyHeaderProps> = ({
  title,
  priceLabel,
  property,
  rentalMode,
  visible,
  onShare,
  onCtaPress,
}) => {
  const { t } = useTranslation();

  const handleShare = useCallback(() => onShare(), [onShare]);

  if (!visible) return null;

  // Web sticky positioning — RN doesn't support position: sticky, only web.
  const containerStyle: ViewStyle = Platform.OS === 'web'
    ? ({
        position: 'sticky',
        top: 0,
      } as unknown as ViewStyle)
    : {};

  const ctaLabel = rentalMode === 'vacation'
    ? t('property.cta.reserve', 'Reserve') || 'Reserve'
    : t('property.cta.apply', 'Apply') || 'Apply';

  return (
    <View style={[styles.bar, containerStyle]}>
      <View style={styles.content}>
        <View style={styles.titleBlock}>
          <BloomText style={styles.title} numberOfLines={1}>
            {title}
          </BloomText>
          <BloomText style={styles.price} numberOfLines={1}>
            {priceLabel}
          </BloomText>
        </View>
        <View style={styles.actions}>
          <Pressable
            onPress={handleShare}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.share', 'Share') || 'Share'}
          >
            <Ionicons name="share-outline" size={20} color={colors.COLOR_BLACK} />
          </Pressable>
          {property ? (
            <SaveButton
              property={property as Property & { _id: string }}
              variant="heart"
              color={colors.COLOR_BLACK}
              activeColor={colors.error}
            />
          ) : null}
          <Button
            onPress={onCtaPress}
            variant="primary"
            size="medium"
            accessibilityLabel={ctaLabel}
          >
            {ctaLabel}
          </Button>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surfaceElevated,
    borderBottomWidth: hairline.width,
    borderBottomColor: hairline.color,
    zIndex: 100,
  },
  content: {
    maxWidth: 1280,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.lg,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  price: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    padding: spacing.sm,
    borderRadius: 9999,
  },
});

export default StickyPropertyHeader;
