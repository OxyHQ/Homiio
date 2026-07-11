/**
 * Report-a-case reason sheet, opened from the detail overflow action via the
 * app-wide `BottomSheetContext`. Reuses the property-report reason set + the
 * same "details required when reason is other" rule, then files the report with
 * `useReportEviction`. Bloom `Chip`/`Button`/`TextField` only.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { ListingReportReason } from '@homiio/shared-types';

import { useReportEviction } from '@/hooks/useEvictionQueries';
import { toast } from '@/lib/sonner';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

const REASON_OPTIONS: { value: ListingReportReason; labelKey: string }[] = [
  { value: ListingReportReason.INACCURATE, labelKey: 'evictions.report.reason.inaccurate' },
  { value: ListingReportReason.SCAM, labelKey: 'evictions.report.reason.scam' },
  { value: ListingReportReason.INAPPROPRIATE, labelKey: 'evictions.report.reason.inappropriate' },
  { value: ListingReportReason.OTHER, labelKey: 'evictions.report.reason.other' },
];

interface EvictionReportSheetProps {
  caseId: string;
  onClose: () => void;
}

export const EvictionReportSheet: React.FC<EvictionReportSheetProps> = ({ caseId, onClose }) => {
  const { t } = useTranslation();
  const reportMutation = useReportEviction(caseId);

  const [reason, setReason] = useState<ListingReportReason | null>(null);
  const [details, setDetails] = useState('');

  const detailsRequired = reason === ListingReportReason.OTHER;
  const isValid = useMemo(() => {
    if (!reason) return false;
    if (detailsRequired && !details.trim()) return false;
    return true;
  }, [reason, detailsRequired, details]);

  const handleSubmit = async () => {
    if (!reason || !isValid) return;
    try {
      await reportMutation.mutateAsync({
        reason,
        details: details.trim() || undefined,
      });
      toast.success(t('evictions.report.success'));
      onClose();
    } catch {
      toast.error(t('evictions.report.error'));
    }
  };

  return (
    <View style={styles.wrap}>
      <H3 style={styles.title}>{t('evictions.report.title')}</H3>
      <BloomText style={styles.intro}>{t('evictions.report.intro')}</BloomText>

      <View style={styles.chipRow}>
        {REASON_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            selected={reason === option.value}
            onPress={() => setReason(option.value)}
          >
            {t(option.labelKey)}
          </Chip>
        ))}
      </View>

      <TextFieldInput
        label={
          detailsRequired
            ? t('evictions.report.detailsRequired')
            : t('evictions.report.details')
        }
        placeholder={t('evictions.report.detailsPlaceholder')}
        value={details}
        onChangeText={setDetails}
        multiline
      />

      <Button
        variant="primary"
        size="large"
        onPress={handleSubmit}
        disabled={!isValid || reportMutation.isPending}
        loading={reportMutation.isPending}
        style={styles.submit}
      >
        {t('evictions.report.submit')}
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    letterSpacing: -0.3,
  },
  intro: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  submit: {
    alignSelf: 'stretch',
    marginTop: spacing.xs,
  },
});

export default EvictionReportSheet;
