import React, { ReactNode } from 'react';
import { Platform, type ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { PANEL_TOP_INSET } from '@oxy.so/bloom/content-panel';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';

interface Props {
  options?: {
    title?: string;
    subtitle?: string;
    showBackButton?: boolean;
    leftComponents?: ReactNode[];
    rightComponents?: ReactNode[];
    transparent?: boolean;
    scrollThreshold?: number;
  };
  scrollY?: SharedValue<number>;
}

/** Web stacking of the bar over screen content (StickyPropertyHeader sits at 1001). */
const HEADER_Z_INDEX_WEB = 1000;
const HEADER_Z_INDEX_NATIVE = 100;

/**
 * The app's screen header: a thin adapter over Bloom `PageHeader` that keeps
 * the `options` API every screen already passes.
 *
 * - Scroll-linked paint (border, shadow, `transparent` background/title) is
 *   PageHeader's: `scrollY` when the screen owns a scroll container, otherwise
 *   the document scroll on web.
 * - On framed web the ContentPanel sits at `PANEL_TOP_INSET`, so the sticky bar
 *   pins there instead of `top: 0`, where the panel's bleed mask would clip it.
 * - The back button renders only when requested AND there is history to pop.
 */
export const Header: React.FC<Props> = ({ options, scrollY }) => {
  const router = useRouter();
  const { t } = useTranslation();
  const isScreenNotMobile = useIsScreenNotMobile();
  // A pure read of navigation state, not synced through an effect.
  const canGoBack = router.canGoBack();
  const framed = Platform.OS === 'web' && isScreenNotMobile;

  const left = (options?.leftComponents ?? []).filter(Boolean);
  const right = (options?.rightComponents ?? []).filter(Boolean);

  const containerStyle: ViewStyle =
    Platform.OS === 'web'
      ? { top: framed ? PANEL_TOP_INSET : 0, zIndex: HEADER_Z_INDEX_WEB }
      : { zIndex: HEADER_Z_INDEX_NATIVE };

  return (
    <PageHeader
      title={options?.title || undefined}
      subtitle={options?.subtitle || undefined}
      titleAlign="center"
      onBack={options?.showBackButton && canGoBack ? () => router.back() : undefined}
      backLabel={t('goBack')}
      leading={
        left.length > 0
          ? left.map((component, index) => (
              <React.Fragment key={index}>{component}</React.Fragment>
            ))
          : undefined
      }
      actions={
        right.length > 0
          ? right.map((component, index) => (
              <React.Fragment key={index}>{component}</React.Fragment>
            ))
          : undefined
      }
      transparent={options?.transparent ?? false}
      scrollThreshold={options?.scrollThreshold || undefined}
      scrollY={scrollY}
      style={containerStyle}
    />
  );
};
