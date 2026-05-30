/**
 * StickyPropertyHeader — the single sticky bar that takes over the top
 * of `/properties/[id]` once the user scrolls past the hero. It owns
 * the whole top: back affordance on the left, property name + price in
 * the middle, share/save/CTA on the right — so it reads as one clean
 * Airbnb-2026 bar rather than colliding with the floating `Header`.
 *
 * Renders on web AND native. It anchors to the top via `position:
 * sticky` on web and `position: absolute` on native, overlaying the
 * floating `Header` (which the screen strips of its right icons while
 * this bar is visible so nothing doubles up). The bar respects the
 * device safe-area inset (`insets.top`); on web that inset is 0, so the
 * `sticky; top: 0` placement is unchanged.
 */
import React, { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { SaveButton } from '@/components/SaveButton';
import { colors } from '@/styles/colors';
import { contentClamp, hairline, spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface StickyPropertyHeaderProps {
  title: string;
  priceLabel: string;
  property: Property | null;
  rentalMode: 'long_term' | 'vacation';
  /** Whether the header is currently shown (driven by scroll position). */
  visible: boolean;
  onBack: () => void;
  onShare: () => void;
  onCtaPress: () => void;
}

export const StickyPropertyHeader: React.FC<StickyPropertyHeaderProps> = ({
  title,
  priceLabel,
  property,
  rentalMode,
  visible,
  onBack,
  onShare,
  onCtaPress,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [backPressed, setBackPressed] = useState(false);
  const [sharePressed, setSharePressed] = useState(false);

  const handleShare = useCallback(() => onShare(), [onShare]);

  if (!visible) return null;

  // Anchor to the top on both platforms. Web uses CSS `position: sticky`
  // (RN-Web honours the string); native uses absolute positioning so the
  // bar overlays the floating Header. zIndex sits above the Header's 1000.
  const containerStyle: ViewStyle =
    Platform.OS === 'web'
      ? ({ position: 'sticky', top: 0 } as unknown as ViewStyle)
      : styles.barNative;

  const ctaLabel = rentalMode === 'vacation'
    ? t('property.cta.reserve', 'Reserve') || 'Reserve'
    : t('property.cta.apply', 'Apply') || 'Apply';

  return (
    <View style={[styles.bar, containerStyle, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        <Pressable
          onPress={onBack}
          onPressIn={() => setBackPressed(true)}
          onPressOut={() => setBackPressed(false)}
          style={[styles.iconButton, backPressed && styles.iconButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('goBack', 'Go back') || 'Go back'}
        >
          <Ionicons name="arrow-back" size={22} color={colors.COLOR_BLACK} />
        </Pressable>
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
            onPressIn={() => setSharePressed(true)}
            onPressOut={() => setSharePressed(false)}
            style={[styles.iconButton, sharePressed && styles.iconButtonPressed]}
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
    zIndex: 1001,
  },
  // Native: overlay the floating Header (zIndex 1000) by anchoring to
  // the top of the screen. Web uses CSS `position: sticky` instead.
  barNative: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  content: {
    maxWidth: contentClamp.page,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
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
  iconButtonPressed: {
    backgroundColor: colors.mutedSubtle,
  },
});

export default StickyPropertyHeader;
