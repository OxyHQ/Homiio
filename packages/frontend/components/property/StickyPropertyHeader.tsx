/**
 * StickyPropertyHeader — the single sticky bar that takes over the top of
 * `/properties/[id]` once the user scrolls past the hero: back, property name +
 * price, share/save/CTA. Built on Bloom `PageHeader`.
 *
 * It is NOT `transparent`: the screen mounts it only once scroll has crossed
 * `STICKY_HEADER_THRESHOLD` (`visible`), and it receives no `scrollY`. A
 * transparent PageHeader without `scrollY` never fades in on native, so the
 * bar would arrive as an invisible title over the content. The fade is the
 * mount itself.
 *
 * Anchoring: web keeps PageHeader's `position: sticky`, pinned at `top: 0` like
 * `Header` (the shell draws no band above the content); native overlays the
 * floating `Header` absolutely. zIndex sits above the
 * `Header`'s 1000.
 */
import React from 'react';
import { Platform, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { RiShare2Line } from '@oxy.so/bloom/icons';
import { PageHeader } from '@oxy.so/bloom/page-header';

import { SaveButton } from '@/components/SaveButton';
import { colors } from '@/styles/colors';
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

const STICKY_PROPERTY_HEADER_Z_INDEX = 1001;

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

  if (!visible) return null;

  const containerStyle: ViewStyle =
    Platform.OS === 'web'
      ? { top: 0, zIndex: STICKY_PROPERTY_HEADER_Z_INDEX }
      : {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: STICKY_PROPERTY_HEADER_Z_INDEX,
        };

  const ctaLabel = rentalMode === 'vacation'
    ? t('property.cta.reserve')
    : t('property.cta.apply');

  return (
    <PageHeader
      title={title}
      subtitle={priceLabel}
      headingLevel={2}
      onBack={onBack}
      backLabel={t('goBack')}
      border="always"
      style={containerStyle}
      actions={
        <>
          <Button
            variant="secondary"
            iconOnly
            leadingIcon={RiShare2Line}
            onPress={onShare}
            accessibilityLabel={t('common.share')}
          />
          {property ? (
            <SaveButton
              property={property}
              variant="heart"
              chrome="ghost"
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
        </>
      }
    />
  );
};

export default StickyPropertyHeader;
