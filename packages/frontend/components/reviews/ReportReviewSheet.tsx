/**
 * ReportReviewSheet — the trust & safety report modal. Pick a reason (the
 * `ReviewReportReason` values as chips); the "other" reason reveals a required
 * details field. Submit fires `onSubmit(reason, details?)` — the caller wires
 * `useReportReview`.
 */
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxyhq/bloom/button';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { ReviewReportReason } from '@homiio/shared-types';

import { EnumChipSelector } from '@/components/reviews/EnumChipSelector';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

interface ReportReviewSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: ReviewReportReason, details?: string) => void;
  submitting: boolean;
}

export const ReportReviewSheet: React.FC<ReportReviewSheetProps> = ({
  visible,
  onClose,
  onSubmit,
  submitting,
}) => {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReviewReportReason | undefined>(undefined);
  const [details, setDetails] = useState('');

  const needsDetails = reason === ReviewReportReason.OTHER;
  const canSubmit = Boolean(reason) && (!needsDetails || details.trim().length > 0);

  const handleSubmit = () => {
    if (!reason || !canSubmit) return;
    onSubmit(reason, details.trim() || undefined);
  };

  const handleClose = () => {
    setReason(undefined);
    setDetails('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={handleClose}
        accessibilityRole="button"
      />
      <SafeAreaView edges={['bottom']} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={styles.sheet}>
          <H3 style={styles.title}>{t('reviews.card.reportTitle')}</H3>
          <BloomText style={styles.subtitle}>{t('reviews.card.reportSubtitle')}</BloomText>

          <EnumChipSelector
            labelPrefix="reviews.card.reportReasons"
            values={Object.values(ReviewReportReason)}
            selected={reason ? [reason] : []}
            onChange={(next) => setReason(next[0])}
          />

          {needsDetails ? (
            <TextFieldInput
              label={t('reviews.card.reportDetails')}
              placeholder={t('reviews.card.reportDetailsPlaceholder')}
              value={details}
              onChangeText={setDetails}
              multiline
            />
          ) : null}

          <View style={styles.actions}>
            <Button variant="secondary" size="medium" onPress={handleClose} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="medium"
              onPress={handleSubmit}
              disabled={!canSubmit || submitting}
              loading={submitting}
            >
              {t('reviews.card.reportSubmit')}
            </Button>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

export default ReportReviewSheet;
