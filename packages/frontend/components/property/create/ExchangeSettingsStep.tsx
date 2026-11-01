import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';

import { Button } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Field } from '@oxy.so/bloom/field';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiCalendarLine } from '@oxy.so/bloom/icons/RiCalendarLine';
import { RiCloseLine } from '@oxy.so/bloom/icons/RiCloseLine';
import { Item } from '@oxy.so/bloom/item';
import { RadioGroup } from '@oxy.so/bloom/radio';
import { SwitchFilterRow, ToggleChipGroup } from '@oxy.so/bloom/stay-filters';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';
import type { AvailabilityWindow, ExchangeMode } from '@homiio/shared-types';
import { AvailabilityWindowStatus } from '@homiio/shared-types/common';

import { ThemedText } from '@/components/ThemedText';
import {
  AvailabilityCalendar,
  type AvailabilityCalendarRange,
} from '@/components/AvailabilityCalendar';
import { radius, spacing } from '@/constants/styles';
import { EXCHANGE_LANGUAGE_OPTIONS, EXCHANGE_MODE_OPTIONS } from './constants';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

const formatWindow = (window: AvailabilityWindow): string => {
  const start = parseISO(window.start);
  const end = parseISO(window.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  return `${format(start, 'MMM d, yyyy')} → ${format(end, 'MMM d, yyyy')}`;
};

const windowKey = (window: AvailabilityWindow): string => `${window.start}_${window.end}`;

/**
 * "Exchange Settings" wizard step — only reachable when the listing carries the
 * EXCHANGE intent (the flow resolver inserts it after Offering).
 *
 * Captures how the home is offered for exchange:
 *  - mode (home swap / free hosting / either) as a card `RadioGroup`,
 *  - availability windows (reuses the vacation {@link AvailabilityCalendar} in a
 *    Bloom `Dialog`; each confirmed range is stored as an `AVAILABLE`
 *    {@link AvailabilityWindow}, the same shape the detail screen's
 *    AvailabilitySection renders),
 *  - a welcome note, the languages spoken, a meals-included switch, and a
 *    reciprocity switch.
 *
 * These map to the property `exchange` block on submit. The store seeds inert
 * defaults so the step is safe to skip when exchange isn't selected.
 */
export function ExchangeSettingsStep({ formData, setFormData }: PropertyStepProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { offering } = formData;
  const [calendarOpen, setCalendarOpen] = useState(false);

  const windows = offering.exchangeAvailabilityWindows;
  const languages = offering.exchangeLanguages;

  const handleSelectMode = useCallback(
    (mode: ExchangeMode) => {
      setFormData('offering', { exchangeMode: mode });
    },
    [setFormData],
  );

  const handleAddWindow = useCallback(
    (range: AvailabilityCalendarRange | null) => {
      setCalendarOpen(false);
      if (!range) return;
      const next: AvailabilityWindow = {
        start: range.checkIn.toISOString(),
        end: range.checkOut.toISOString(),
        status: AvailabilityWindowStatus.AVAILABLE,
      };
      const key = windowKey(next);
      const exists = windows.some((window) => windowKey(window) === key);
      setFormData('offering', {
        exchangeAvailabilityWindows: exists ? windows : [...windows, next],
      });
    },
    [setFormData, windows],
  );

  const handleRemoveWindow = useCallback(
    (key: string) => {
      setFormData('offering', {
        exchangeAvailabilityWindows: windows.filter((window) => windowKey(window) !== key),
      });
    },
    [setFormData, windows],
  );

  // The group reports its selection in option order; the listing keeps the
  // order the host picked in, so apply only the one language that changed.
  const handleLanguages = useCallback(
    (next: string[]) => {
      const added = next.find((language) => !languages.includes(language));
      setFormData('offering', {
        exchangeLanguages: added
          ? [...languages, added]
          : languages.filter((language) => next.includes(language)),
      });
    },
    [setFormData, languages],
  );

  return (
    <View style={styles.step}>
      {/* Mode */}
      <Field label={t('listing.exchange.modeLabel')}>
        <RadioGroup<ExchangeMode>
          variant="card"
          label={t('listing.exchange.modeLabel')}
          value={offering.exchangeMode}
          onValueChange={handleSelectMode}
          options={EXCHANGE_MODE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.i18nKey),
            description: t(option.descriptionKey),
          }))}
        />
      </Field>

      {/* Availability windows */}
      <Field label={t('listing.exchange.availabilityLabel')}>
        {windows.length > 0 ? (
          <View style={exchangeStyles.windowList}>
            {windows.map((window) => {
              const key = windowKey(window);
              return (
                <Item
                  key={key}
                  density="compact"
                  style={[exchangeStyles.windowItem, { backgroundColor: colors.tertiarySubtle }]}
                  leading={<RiCalendarLine size="sm" fill={colors.tertiarySubtleForeground} />}
                  title={formatWindow(window)}
                  trailing={
                    <Button
                      size="xs"
                      iconOnly
                      leadingIcon={RiCloseLine}
                      onPress={() => handleRemoveWindow(key)}
                      accessibilityLabel={t('listing.exchange.removeWindow')}
                      tone="accent"
                      appearance="subtle"
                    />
                  }
                />
              );
            })}
          </View>
        ) : (
          <ThemedText style={[styles.instructions, { color: colors.textSecondary }]}>
            {t('listing.exchange.noWindows')}
          </ThemedText>
        )}
        <Button
          leadingIcon={RiAddLine}
          onPress={() => setCalendarOpen(true)}
          style={exchangeStyles.addWindowButton}
          tone="neutral"
          appearance="outline"
        >
          {t('listing.exchange.addWindow')}
        </Button>
      </Field>

      {/* Welcome note */}
      <Textarea
        label={t('listing.exchange.welcomeNote')}
        value={offering.exchangeWelcomeNote ?? ''}
        onChangeText={(text) => setFormData('offering', { exchangeWelcomeNote: text })}
        placeholder={t('listing.exchange.welcomeNotePlaceholder')}
        rows={4}
        autoResize
        maxRows={12}
      />

      {/* Languages */}
      <Field label={t('listing.exchange.languages')}>
        <ToggleChipGroup
          options={EXCHANGE_LANGUAGE_OPTIONS.map((language) => ({
            value: language,
            label: language,
          }))}
          value={languages}
          onValueChange={handleLanguages}
          accessibilityLabel={t('listing.exchange.languages')}
          testID="create-exchange-languages"
        />
      </Field>

      <View style={styles.switches}>
        <SwitchFilterRow
          title={t('listing.exchange.mealsIncluded')}
          value={offering.exchangeMealsIncluded}
          onValueChange={(value) => setFormData('offering', { exchangeMealsIncluded: value })}
        />
        <SwitchFilterRow
          title={t('listing.exchange.requiresReciprocity')}
          description={t('listing.exchange.requiresReciprocityHelp')}
          value={offering.exchangeRequiresReciprocity}
          onValueChange={(value) => setFormData('offering', { exchangeRequiresReciprocity: value })}
        />
      </View>

      <Dialog
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        title={t('listing.exchange.addWindow')}
        placement={{ base: 'bottom', md: 'center' }}
        maxWidth={720}
      >
        <AvailabilityCalendar mode="modal" onApply={handleAddWindow} />
      </Dialog>
    </View>
  );
}

const exchangeStyles = StyleSheet.create({
  windowList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  windowItem: {
    borderRadius: radius.md,
  },
  addWindowButton: {
    alignSelf: 'flex-start',
  },
});
