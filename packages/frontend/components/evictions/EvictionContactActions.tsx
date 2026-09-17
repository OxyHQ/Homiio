/**
 * "Cómo ayudar" contact block for an eviction case: the organiser's tappable
 * phone / WhatsApp / Telegram / email actions (only the fields the reporter
 * provided — contacts are never invented) plus the free-text instructions.
 *
 * The actions are a Bloom `SettingsListGroup` in its `filled` variant: the
 * block sits inside the detail screen's "How to help" card, which already
 * paints the `card` colour, so a `plain` group would lose its edge there.
 */
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { RiChat3Line, RiMailLine, RiPhoneLine, RiSendPlaneLine } from '@oxy.so/bloom/icons';
import type { EvictionContactInfo } from '@homiio/shared-types';

import { toast } from '@oxy.so/bloom/toast';
import { SettingsRowIcon } from '@/components/profile/SettingsRowIcon';
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
      {actions.length > 0 ? (
        <SettingsListGroup variant="filled">
          {actions.map((action) => (
            <SettingsListItem
              key={action.kind}
              icon={<SettingsRowIcon icon={ICON_BY_KIND[action.kind]} />}
              title={labels[action.kind]}
              description={action.value}
              accessibilityRole="link"
              accessibilityLabel={`${labels[action.kind]}: ${action.value}`}
              onPress={() => {
                Linking.openURL(action.url).catch(() => toast.error(openFailedLabel));
              }}
            />
          ))}
        </SettingsListGroup>
      ) : null}
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
    gap: spacing.sm,
  },
  instructions: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
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
