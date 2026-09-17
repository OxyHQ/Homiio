/**
 * "Cómo ayudar" contact block for an eviction case: the organiser's tappable
 * phone / WhatsApp / Telegram / email actions (only the fields the reporter
 * provided — contacts are never invented) plus the free-text instructions.
 *
 * Each action is a Bloom `Item` row, which owns its own press feedback, so no
 * hooks run inside the `.map`.
 */
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Item } from '@oxy.so/bloom/item';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import {
  RiChat3Line,
  RiExternalLinkLine,
  RiMailLine,
  RiPhoneLine,
  RiSendPlaneLine,
} from '@oxy.so/bloom/icons';
import type { EvictionContactInfo } from '@homiio/shared-types';

import { toast } from '@oxy.so/bloom/toast';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { buildEvictionContactActions, type EvictionContactAction } from './evictionUtils';

/** One Remix glyph per contact kind. Exhaustive, so a new kind fails to compile. */
const ICON_BY_KIND: Readonly<Record<EvictionContactAction['kind'], typeof RiPhoneLine>> = {
  phone: RiPhoneLine,
  whatsapp: RiChat3Line,
  telegram: RiSendPlaneLine,
  email: RiMailLine,
};

interface EvictionContactActionsProps {
  contact: EvictionContactInfo | undefined;
  /** Localized labels keyed by contact kind. */
  labels: Record<EvictionContactAction['kind'], string>;
  instructionsLabel: string;
  openFailedLabel: string;
}

export const EvictionContactActions: React.FC<EvictionContactActionsProps> = ({
  contact,
  labels,
  instructionsLabel,
  openFailedLabel,
}) => {
  const actions = buildEvictionContactActions(contact);
  const instructions = contact?.instructions?.trim();

  if (actions.length === 0 && !instructions) return null;

  return (
    <View style={styles.wrap}>
      {actions.map((action) => {
        const Icon = ICON_BY_KIND[action.kind];
        return (
          <Item
            key={action.kind}
            role="listitem"
            accessibilityRole="link"
            accessibilityLabel={`${labels[action.kind]}: ${action.value}`}
            title={labels[action.kind]}
            subtitle={action.value}
            leading={
              <View style={styles.iconCircle}>
                <Icon width={18} height={18} fill={colors.primaryColor} />
              </View>
            }
            trailing={<RiExternalLinkLine size="sm" fill={colors.textSecondary} />}
            onPress={() => {
              Linking.openURL(action.url).catch(() => toast.error(openFailedLabel));
            }}
          />
        );
      })}
      {instructions ? (
        <View style={styles.instructions}>
          <BloomText style={styles.instructionsLabel}>{instructionsLabel}</BloomText>
          <BloomText style={styles.instructionsText}>{instructions}</BloomText>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryColor + '1A',
  },
  instructions: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  instructionsLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  instructionsText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
});

export default EvictionContactActions;
