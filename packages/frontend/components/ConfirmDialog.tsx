/**
 * Minimal confirmation dialog. A thin composition over Bloom's centered
 * {@link Dialog} primitive (`@oxyhq/bloom/dialog`) — Bloom owns the dimmed
 * backdrop, the snug centered card, the title header, and the body padding.
 * ConfirmDialog adds the message copy, the optional secondary content, and the
 * cancel/confirm action row. Used by:
 *  - Reservation detail (cancel / approve / decline)
 *  - Tenant application detail (withdraw)
 *  - Landlord applicant detail (approve / reject, with a notes field)
 *  - Settings, drafts, viewings, host calendar, profile destructive flows
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '@oxyhq/bloom/button';
import { Dialog } from '@oxyhq/bloom/dialog';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

/** Compact confirmation card width — narrower than Bloom's 440 default. */
const CONFIRM_CARD_MAX_WIDTH = 420;

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmDestructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional secondary content (e.g. a TextField input for landlord notes). */
  children?: React.ReactNode;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmDestructive,
  loading,
  onConfirm,
  onCancel,
  children,
}) => (
  <Dialog
    placement="center"
    open={visible}
    onClose={onCancel}
    title={title}
    label={title}
    maxWidth={CONFIRM_CARD_MAX_WIDTH}
    // While the action is in flight the buttons are disabled, so the backdrop /
    // Escape / hardware-back must not dismiss it either — keep the confirm
    // blocking until it resolves.
    dismissOnBackdrop={!loading}
  >
    <BloomText style={styles.body}>{message}</BloomText>
    {children}
    <View style={styles.actions}>
      <Button variant="ghost" size="medium" onPress={onCancel} disabled={loading}>
        {cancelLabel}
      </Button>
      <Button
        variant="primary"
        size="medium"
        onPress={onConfirm}
        loading={loading}
        disabled={loading}
        style={confirmDestructive ? styles.destructive : undefined}
      >
        {confirmLabel}
      </Button>
    </View>
  </Dialog>
);

const styles = StyleSheet.create({
  body: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  destructive: {
    backgroundColor: colors.danger,
  },
});

export default ConfirmDialog;
