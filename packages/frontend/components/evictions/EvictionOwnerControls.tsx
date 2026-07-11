/**
 * Owner-only controls on the eviction detail screen: post a timeline update
 * (message + optional reschedule + optional status change), jump to the
 * prefilled edit form, and cancel the case (a confirmed status → `cancelled`).
 *
 * Owns its own form state + mutations (`useCreateEvictionUpdate`,
 * `useUpdateEviction`) so the detail screen stays lean. Bloom controls only;
 * status chips use static styles (no function-form `style`).
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { EvictionCaseStatus } from '@homiio/shared-types';
import { useCreateEvictionUpdate, useUpdateEviction } from '@/hooks/useEvictionQueries';
import { webAlert } from '@/utils/api';
import { toast } from '@/lib/sonner';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { EVICTION_STATUS_META } from './evictionUtils';

const STATUS_OPTIONS = Object.values(EvictionCaseStatus) as EvictionCaseStatus[];

/** Combine a `YYYY-MM-DD` date + optional `HH:mm` time into an ISO string. */
const toIso = (date: string, time: string): string | undefined => {
  const trimmed = date.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(`${trimmed}T${time.trim() || '00:00'}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

interface EvictionOwnerControlsProps {
  caseId: string;
  currentStatus: EvictionCaseStatus;
  onEdit: () => void;
}

export const EvictionOwnerControls: React.FC<EvictionOwnerControlsProps> = ({
  caseId,
  currentStatus,
  onEdit,
}) => {
  const { t } = useTranslation();
  const createUpdate = useCreateEvictionUpdate(caseId);
  const updateCase = useUpdateEviction(caseId);

  const [message, setMessage] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newStatus, setNewStatus] = useState<EvictionCaseStatus | null>(null);

  const dateInvalid = useMemo(
    () => Boolean(newDate.trim()) && toIso(newDate, newTime) === undefined,
    [newDate, newTime],
  );

  const canPost = message.trim().length > 0 && !dateInvalid && !createUpdate.isPending;

  const handlePost = async () => {
    if (!canPost) return;
    try {
      await createUpdate.mutateAsync({
        message: message.trim(),
        newScheduledAt: toIso(newDate, newTime),
        newStatus: newStatus ?? undefined,
      });
      toast.success(t('evictions.update.success'));
      setMessage('');
      setNewDate('');
      setNewTime('');
      setNewStatus(null);
    } catch {
      toast.error(t('evictions.update.error'));
    }
  };

  const handleCancelCase = () => {
    webAlert(t('evictions.cancel.confirmTitle'), t('evictions.cancel.confirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('evictions.cancel.confirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await updateCase.mutateAsync({ status: EvictionCaseStatus.CANCELLED });
            toast.success(t('evictions.cancel.success'));
          } catch {
            toast.error(t('evictions.cancel.error'));
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <H3 style={styles.title}>{t('evictions.owner.title')}</H3>

      <TextFieldInput
        label={t('evictions.update.messageLabel')}
        placeholder={t('evictions.update.messagePlaceholder')}
        value={message}
        onChangeText={setMessage}
        multiline
      />

      <View style={styles.row}>
        <View style={styles.rowField}>
          <TextFieldInput
            label={t('evictions.update.newDateLabel')}
            placeholder="YYYY-MM-DD"
            value={newDate}
            onChangeText={setNewDate}
          />
        </View>
        <View style={styles.rowField}>
          <TextFieldInput
            label={t('evictions.update.newTimeLabel')}
            placeholder="HH:MM"
            value={newTime}
            onChangeText={setNewTime}
          />
        </View>
      </View>
      {dateInvalid ? (
        <BloomText style={styles.error}>{t('evictions.form.invalidDate')}</BloomText>
      ) : null}

      <View>
        <BloomText style={styles.fieldLabel}>{t('evictions.update.newStatusLabel')}</BloomText>
        <View style={styles.chipRow}>
          {STATUS_OPTIONS.map((option) => (
            <Chip
              key={option}
              selected={newStatus === option}
              onPress={() => setNewStatus((prev) => (prev === option ? null : option))}
            >
              {t(EVICTION_STATUS_META[option].i18nKey)}
            </Chip>
          ))}
        </View>
      </View>

      <Button
        variant="primary"
        size="medium"
        onPress={handlePost}
        disabled={!canPost}
        loading={createUpdate.isPending}
        style={styles.action}
      >
        {t('evictions.update.post')}
      </Button>

      <View style={styles.ownerActions}>
        <Button variant="secondary" size="medium" onPress={onEdit} style={styles.ownerAction}>
          {t('evictions.owner.edit')}
        </Button>
        {currentStatus !== EvictionCaseStatus.CANCELLED ? (
          <Button
            variant="secondary"
            size="medium"
            onPress={handleCancelCase}
            loading={updateCase.isPending}
            style={styles.ownerAction}
          >
            {t('evictions.owner.cancelCase')}
          </Button>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  title: {
    letterSpacing: -0.3,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowField: {
    flex: 1,
  },
  error: {
    fontSize: 12,
    color: colors.danger,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  action: {
    alignSelf: 'stretch',
  },
  ownerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  ownerAction: {
    flex: 1,
  },
});

export default EvictionOwnerControls;
