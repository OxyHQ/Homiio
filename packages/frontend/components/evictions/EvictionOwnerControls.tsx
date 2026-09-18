/**
 * Owner-only controls on the eviction detail screen: post a timeline update
 * (message + optional reschedule + optional status change), jump to the
 * prefilled edit form, and cancel the case (a confirmed status → `cancelled`).
 *
 * Owns its own form state + mutations (`useCreateEvictionUpdate`,
 * `useUpdateEviction`) so the detail screen stays lean. Bloom controls only:
 * a `Card` surface, `Textarea` for the message, `DatePicker` and `TimeField`
 * for the new day and hour, `Chip`s for the (deselectable) status, `confirm()`
 * for the cancellation.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { DatePicker, TimeField } from '@oxy.so/bloom/date-picker';
import { Field } from '@oxy.so/bloom/field';
import { RiCloseCircleLine, RiEditLine } from '@oxy.so/bloom/icons';
import { Textarea } from '@oxy.so/bloom/textarea';
import { H3 } from '@oxy.so/bloom/typography';

import { EvictionCaseStatus } from '@homiio/shared-types';
import { useCreateEvictionUpdate, useUpdateEviction } from '@/hooks/useEvictionQueries';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import { spacing } from '@/constants/styles';
import { EVICTION_STATUS_META, combineDateAndTime } from './evictionUtils';

const STATUS_OPTIONS = Object.values(EvictionCaseStatus) as EvictionCaseStatus[];

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
  const { t, i18n } = useTranslation();
  const createUpdate = useCreateEvictionUpdate(caseId);
  const updateCase = useUpdateEviction(caseId);

  const [message, setMessage] = useState('');
  const [newDate, setNewDate] = useState<Date | null>(null);
  const [newTime, setNewTime] = useState('');
  const [newStatus, setNewStatus] = useState<EvictionCaseStatus | null>(null);

  const dateInvalid = useMemo(
    () => newDate !== null && combineDateAndTime(newDate, newTime) === undefined,
    [newDate, newTime],
  );

  const canPost = message.trim().length > 0 && !dateInvalid && !createUpdate.isPending;

  const handlePost = async () => {
    if (!canPost) return;
    try {
      await createUpdate.mutateAsync({
        message: message.trim(),
        newScheduledAt: combineDateAndTime(newDate, newTime),
        newStatus: newStatus ?? undefined,
      });
      toast.success(t('evictions.update.success'));
      setMessage('');
      setNewDate(null);
      setNewTime('');
      setNewStatus(null);
    } catch {
      toast.error(t('evictions.update.error'));
    }
  };

  const handleCancelCase = async () => {
    const ok = await confirm({
      title: t('evictions.cancel.confirmTitle'),
      description: t('evictions.cancel.confirmMessage'),
      confirmLabel: t('evictions.cancel.confirm'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await updateCase.mutateAsync({ status: EvictionCaseStatus.CANCELLED });
      toast.success(t('evictions.cancel.success'));
    } catch {
      toast.error(t('evictions.cancel.error'));
    }
  };

  return (
    <Card variant="outlined" radius="radius-16" style={styles.wrap}>
      <H3 style={styles.title}>{t('evictions.owner.title')}</H3>

      <Textarea
        label={t('evictions.update.messageLabel')}
        placeholder={t('evictions.update.messagePlaceholder')}
        value={message}
        onChangeText={setMessage}
        rows={3}
        autoResize
        maxRows={8}
      />

      <View style={styles.row}>
        <Field
          label={t('evictions.update.newDateLabel')}
          error={dateInvalid ? t('evictions.form.invalidDate') : null}
          style={styles.rowField}
        >
          <DatePicker
            value={newDate}
            onChange={setNewDate}
            locale={i18n.language}
            accessibilityLabel={t('evictions.update.newDateLabel')}
          />
        </Field>
        <View style={styles.rowField}>
          <Field label={t('evictions.update.newTimeLabel')}>
            <TimeField
              value={newTime || null}
              onChange={(time) => setNewTime(time ?? '')}
              accessibilityLabel={t('evictions.update.newTimeLabel')}
            />
          </Field>
        </View>
      </View>

      <Field label={t('evictions.update.newStatusLabel')}>
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
      </Field>

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
        <Button
          variant="secondary"
          size="medium"
          onPress={onEdit}
          leadingIcon={RiEditLine}
          style={styles.ownerAction}
        >
          {t('evictions.owner.edit')}
        </Button>
        {currentStatus !== EvictionCaseStatus.CANCELLED ? (
          <Button
            variant="destructive"
            size="medium"
            onPress={handleCancelCase}
            loading={updateCase.isPending}
            leadingIcon={RiCloseCircleLine}
            style={styles.ownerAction}
          >
            {t('evictions.owner.cancelCase')}
          </Button>
        ) : null}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    letterSpacing: -0.3,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  rowField: {
    flex: 1,
    minWidth: 160,
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
