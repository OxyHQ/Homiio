/**
 * ReportReviewSheet — the per-user community report for a review. A controlled
 * Bloom `Dialog` (bottom sheet on phones, centred card from `md`) holding a
 * `RadioGroup` of `ReviewReportReason`s; the "other" reason reveals a required
 * `Textarea`. Submit fires `onSubmit(reason, details?)` — the caller wires
 * `useReportReview`, and the backend flips a review to `under_review` at 3+
 * reports. This is a reader's report, never a moderator action.
 *
 * Actions use `shouldCloseOnPress: false` so the dialog stays up (and disabled)
 * while the mutation runs; the parent closes it on success.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@oxy.so/bloom/dialog';
import { RadioGroup } from '@oxy.so/bloom/radio';
import { Textarea } from '@oxy.so/bloom/textarea';

import { ReviewReportReason } from '@homiio/shared-types';

interface ReportReviewSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: ReviewReportReason, details?: string) => void;
  submitting: boolean;
}

const REPORT_REASONS = Object.values(ReviewReportReason);

export const ReportReviewSheet: React.FC<ReportReviewSheetProps> = ({
  visible,
  onClose,
  onSubmit,
  submitting,
}) => {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReviewReportReason | undefined>(undefined);
  const [details, setDetails] = useState('');

  // Start every report fresh, whichever way the previous one closed (reset
  // during render on the open edge — no effect, no extra commit).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setReason(undefined);
      setDetails('');
    }
  }

  const needsDetails = reason === ReviewReportReason.OTHER;
  const canSubmit = Boolean(reason) && (!needsDetails || details.trim().length > 0);

  const handleSubmit = () => {
    if (!reason || !canSubmit) return;
    onSubmit(reason, details.trim() || undefined);
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const title = t('reviews.card.reportTitle');

  return (
    <Dialog
      open={visible}
      onClose={handleClose}
      placement={{ base: 'bottom', md: 'center' }}
      dismissOnBackdrop={!submitting}
      maxWidth={440}
      title={title}
      label={title}
      description={t('reviews.card.reportSubtitle')}
      actions={[
        {
          label: t('reviews.card.reportSubmit'),
          color: 'destructive',
          disabled: !canSubmit || submitting,
          shouldCloseOnPress: false,
          onPress: handleSubmit,
        },
        {
          label: t('common.cancel'),
          color: 'cancel',
          disabled: submitting,
          shouldCloseOnPress: false,
          onPress: handleClose,
        },
      ]}
    >
      <View className="gap-4">
        <RadioGroup<ReviewReportReason>
          label={title}
          value={reason}
          onValueChange={setReason}
          disabled={submitting}
          options={REPORT_REASONS.map((value) => ({
            value,
            label: t(`reviews.card.reportReasons.${value}`),
          }))}
        />
        {needsDetails ? (
          <Textarea
            label={t('reviews.card.reportDetails')}
            placeholder={t('reviews.card.reportDetailsPlaceholder')}
            value={details}
            onChangeText={setDetails}
            rows={3}
            autoResize
            maxRows={8}
            required
            disabled={submitting}
          />
        ) : null}
      </View>
    </Dialog>
  );
};

export default ReportReviewSheet;
