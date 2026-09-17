/**
 * Report-a-case reason sheet, opened from the detail overflow action via the
 * app-wide `BottomSheetContext`.
 *
 * ## The reasons are the EVICTION vocabulary, not the listing one
 *
 * "This location is too precise" and "this exposes personal data" have no
 * counterpart on a property advertisement, and they are the two that carry a
 * CONSEQUENCE rather than a counter: the first report of either applies a
 * precautionary hold that withholds the location and the description until the
 * organiser answers. The sheet says so, because a reader choosing between
 * reasons should know which one does something.
 *
 * Nothing here routes to a moderator. A threshold fires, a column is stamped and
 * the organiser is notified; there is no queue and no reviewer.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { Admonition } from '@oxy.so/bloom/admonition';
import { RadioGroup, type RadioOption } from '@oxy.so/bloom/radio';
import { Textarea } from '@oxy.so/bloom/textarea';
import { H3, Text as BloomText } from '@oxy.so/bloom/typography';
import { EvictionReportReason, EVICTION_PRECAUTIONARY_HOLD_REASONS } from '@homiio/shared-types';

import { useReportEviction } from '@/hooks/useEvictionQueries';
import { toast } from '@oxy.so/bloom/toast';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

const REASON_OPTIONS: { value: EvictionReportReason; labelKey: string }[] = [
  {
    value: EvictionReportReason.FALSE_INFORMATION,
    labelKey: 'evictions.report.reason.false_information',
  },
  {
    value: EvictionReportReason.PERSONAL_DATA_EXPOSED,
    labelKey: 'evictions.report.reason.personal_data_exposed',
  },
  {
    value: EvictionReportReason.LOCATION_TOO_PRECISE,
    labelKey: 'evictions.report.reason.location_too_precise',
  },
  { value: EvictionReportReason.OUTDATED, labelKey: 'evictions.report.reason.outdated' },
  { value: EvictionReportReason.HARASSMENT, labelKey: 'evictions.report.reason.harassment' },
  { value: EvictionReportReason.SPAM, labelKey: 'evictions.report.reason.spam' },
  {
    value: EvictionReportReason.DANGEROUS_CONTACT,
    labelKey: 'evictions.report.reason.dangerous_contact',
  },
];

/** Reasons the SERVER also requires details for, mirrored so the UI agrees. */
const REASONS_REQUIRING_DETAILS: readonly EvictionReportReason[] = [
  EvictionReportReason.FALSE_INFORMATION,
  EvictionReportReason.PERSONAL_DATA_EXPOSED,
];

interface EvictionReportSheetProps {
  caseId: string;
  onClose: () => void;
}

export const EvictionReportSheet: React.FC<EvictionReportSheetProps> = ({ caseId, onClose }) => {
  const { t } = useTranslation();
  const reportMutation = useReportEviction(caseId);

  const [reason, setReason] = useState<EvictionReportReason | null>(null);
  const [details, setDetails] = useState('');

  const reasonOptions = useMemo<RadioOption<EvictionReportReason>[]>(
    () => REASON_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t],
  );

  const detailsRequired = reason !== null && REASONS_REQUIRING_DETAILS.includes(reason);
  const appliesHold = reason !== null && EVICTION_PRECAUTIONARY_HOLD_REASONS.includes(reason);
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

      <RadioGroup
        label={t('evictions.report.title')}
        value={reason ?? undefined}
        onValueChange={setReason}
        options={reasonOptions}
      />

      {appliesHold ? (
        <Admonition type="warning">{t('evictions.report.holdNotice')}</Admonition>
      ) : null}

      <Textarea
        label={
          detailsRequired ? t('evictions.report.detailsRequired') : t('evictions.report.details')
        }
        required={detailsRequired}
        placeholder={t('evictions.report.detailsPlaceholder')}
        value={details}
        onChangeText={setDetails}
        rows={3}
        autoResize
        maxRows={8}
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
  submit: {
    alignSelf: 'stretch',
    marginTop: spacing.xs,
  },
});

export default EvictionReportSheet;
