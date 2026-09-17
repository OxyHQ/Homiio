/**
 * MediaChip — the single visual language for every chip that floats over a
 * property photo (offering intents, verified, eco, rating). A Bloom `Chip`
 * repainted with ONE frosted backdrop: only the accent colour, icon, and
 * optional label vary, so a row of them reads as ONE aligned family.
 *
 * Backdrop strategy: a frosted near-white surface (the same treatment as the
 * save heart and rating pill) with the accent applied to the icon + label. A
 * light surface gives reliable contrast over arbitrary photos for the app's
 * dark/saturated accents (amber sale, teal exchange, green eco, deep brand) far
 * better than tinting the chip itself, and it visually unifies the overlay set
 * with the heart already living in the opposite corner.
 *
 * Every chip keeps Bloom's fixed pill height per size (`md` → Chip `large`,
 * 28; `sm` → Chip `small`, 24) so a `flexDirection: 'row'` stack aligns
 * regardless of which chips are present. Icon-only chips (no `label`) collapse
 * to a square of that height.
 *
 * `icon` takes a Bloom (Remix) icon COMPONENT. An Ionicons glyph NAME is still
 * accepted for callers whose glyph has no Remix equivalent.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Chip } from '@oxy.so/bloom/chip';
import type { Props as IconProps } from '@oxy.so/bloom/icons';

import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type MediaChipSize = 'sm' | 'md';

/** A Remix icon component, or (legacy) an Ionicons glyph name. */
export type MediaChipIcon = React.ComponentType<IconProps> | IoniconName;

/** Icon glyph sizes per chip size (a touch smaller than a dense badge). */
const CHIP_ICON_MD = 14;
const CHIP_ICON_SM = 12;

/** The frosted overlay surface every media chip shares. */
const FROSTED_SURFACE = 'rgba(255, 255, 255, 0.92)';

interface MediaChipProps {
  icon: MediaChipIcon;
  /** Accent colour applied to the icon and label. Omit defaults to brand. */
  accent?: string;
  /** Optional label. When absent the chip renders icon-only (a square). */
  label?: string;
  /** `sm` for dense grids, `md` (default) for roomy cards. */
  size?: MediaChipSize;
}

export const MediaChip: React.FC<MediaChipProps> = ({
  icon,
  accent = colors.primarySubtleForeground,
  label,
  size = 'md',
}) => {
  const isSmall = size === 'sm';
  const iconSize = isSmall ? CHIP_ICON_SM : CHIP_ICON_MD;
  const hasLabel = typeof label === 'string' && label.length > 0;

  const glyph =
    typeof icon === 'string' ? (
      <Ionicons name={icon} size={iconSize} color={accent} />
    ) : (
      React.createElement(icon, { width: iconSize, height: iconSize, fill: accent })
    );

  return (
    <Chip
      size={isSmall ? 'small' : 'large'}
      startIcon={glyph}
      style={[styles.chip, !hasLabel && styles.chipIconOnly]}
      textStyle={[styles.label, isSmall && styles.labelSmall, { color: accent }]}
    >
      {hasLabel ? label : undefined}
    </Chip>
  );
};

const styles = StyleSheet.create({
  // Flat frosted surface (no shadow) matching the save heart and the "new"
  // chip so the whole overlay set reads as one flat Airbnb-style family.
  chip: {
    backgroundColor: FROSTED_SURFACE,
  },
  // Icon-only chips become a square of the chip height so they line up with
  // the labelled ones.
  chipIconOnly: {
    aspectRatio: 1,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  label: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  labelSmall: {
    fontSize: 10,
  },
});

export default MediaChip;
