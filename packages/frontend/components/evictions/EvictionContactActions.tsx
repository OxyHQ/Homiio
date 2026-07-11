/**
 * "Cómo ayudar" contact block for an eviction case: the organiser's tappable
 * phone / WhatsApp / Telegram / email actions (only the fields the reporter
 * provided — contacts are never invented) plus the free-text instructions.
 *
 * Each row owns its own pressed state via a static style array + `onPressIn/Out`
 * (the NativeWind function-form `style` is unsupported), and the row is its own
 * component so no hook runs inside the `.map`.
 */
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import type { EvictionContactInfo } from '@homiio/shared-types';

import { toast } from '@/lib/sonner';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { buildEvictionContactActions, type EvictionContactAction } from './evictionUtils';

interface ContactRowProps {
  action: EvictionContactAction;
  label: string;
  openFailedLabel: string;
}

const ContactRow: React.FC<ContactRowProps> = ({ action, label, openFailedLabel }) => {
  const [pressed, setPressed] = useState(false);

  const handlePress = async () => {
    try {
      await Linking.openURL(action.url);
    } catch {
      toast.error(openFailedLabel);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${action.value}`}
      style={[styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.iconCircle}>
        <Ionicons name={action.icon} size={18} color={colors.primaryColor} />
      </View>
      <View style={styles.rowText}>
        <BloomText style={styles.rowLabel}>{label}</BloomText>
        <BloomText style={styles.rowValue} numberOfLines={1} ellipsizeMode="middle">
          {action.value}
        </BloomText>
      </View>
      <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
    </Pressable>
  );
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
      {actions.map((action) => (
        <ContactRow
          key={action.kind}
          action={action}
          label={labels[action.kind]}
          openFailedLabel={openFailedLabel}
        />
      ))}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.mutedSubtle,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoSubtle,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
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
