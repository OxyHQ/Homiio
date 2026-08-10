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
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';
import {
  EvictionReportReason,
  EVICTION_PRECAUTIONARY_HOLD_REASONS,
} from '@homiio/shared-types';

import { useReportEviction } from '@/hooks/useEvictionQueries';
import { toast } from '@oxyhq/bloom/toast';
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
      {appliesHold ? (
        <BloomText style={styles.intro}>{t('evictions.report.holdNotice')}</BloomText>
      ) : null}

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
