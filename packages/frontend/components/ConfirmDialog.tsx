/**
 * Minimal confirmation dialog (Modal + Bloom Button). Bloom's Dialog primitive
 * is not mounted in this app, so consumers reach for this lightweight local
 * equivalent instead. Used by:
 *  - Reservation detail (cancel / approve / decline) — pre-existing inline copy
 *  - Tenant application detail (withdraw)
 *  - Landlord applicant detail (approve / reject)
 */
import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';

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
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    onRequestClose={onCancel}
  >
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <H3 style={styles.title}>{title}</H3>
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
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  destructive: {
    backgroundColor: colors.danger,
  },
});

export default ConfirmDialog;
