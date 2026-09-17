import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';

import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Field } from '@oxy.so/bloom/field';
import { RiAddLine, RiCalendarLine, RiCloseLine } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { RadioGroup } from '@oxy.so/bloom/radio';
import { SettingsListDivider, SettingsListGroup } from '@oxy.so/bloom/settings-list';
import { Textarea } from '@oxy.so/bloom/textarea';
import {
  AvailabilityWindow,
  AvailabilityWindowStatus,
  ExchangeMode,
} from '@homiio/shared-types';

import { ThemedText } from '@/components/ThemedText';
import {
  AvailabilityCalendar,
  type AvailabilityCalendarRange,
} from '@/components/AvailabilityCalendar';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import {
  EXCHANGE_LANGUAGE_OPTIONS,
  EXCHANGE_MODE_OPTIONS,
} from './constants';
import { WizardSwitchItem } from './fields';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

const formatWindow = (window: AvailabilityWindow): string => {
  const start = parseISO(window.start);
  const end = parseISO(window.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  return `${format(start, 'MMM d, yyyy')} → ${format(end, 'MMM d, yyyy')}`;
};

const windowKey = (window: AvailabilityWindow): string =>
  `${window.start}_${window.end}`;

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
        exchangeAvailabilityWindows: windows.filter(
          (window) => windowKey(window) !== key,
        ),
      });
    },
    [setFormData, windows],
  );

  const handleToggleLanguage = useCallback(
    (language: string) => {
      const selected = languages.includes(language);
      setFormData('offering', {
        exchangeLanguages: selected
          ? languages.filter((value) => value !== language)
          : [...languages, language],
      });
    },
    [setFormData, languages],
  );

  return (
    <View style={styles.step}>
      <ThemedText type="subtitle">
        {t('listing.exchange.stepTitle')}
      </ThemedText>
      <ThemedText style={styles.instructions}>
        {t('listing.exchange.stepHelp')}
      </ThemedText>

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
                  style={exchangeStyles.windowItem}
                  leading={<RiCalendarLine size="sm" fill={colors.exchangeAccent} />}
                  title={formatWindow(window)}
                  trailing={
                    <Button
                      variant="ghost"
                      size="xs"
                      iconOnly
                      leadingIcon={RiCloseLine}
                      onPress={() => handleRemoveWindow(key)}
                      accessibilityLabel={t('listing.exchange.removeWindow')}
                    />
                  }
                />
              );
            })}
          </View>
        ) : (
          <ThemedText style={styles.instructions}>
            {t('listing.exchange.noWindows')}
          </ThemedText>
        )}
        <Button
          variant="secondary"
          leadingIcon={RiAddLine}
          onPress={() => setCalendarOpen(true)}
          style={exchangeStyles.addWindowButton}
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
        <View style={styles.optionRow}>
          {EXCHANGE_LANGUAGE_OPTIONS.map((language) => (
            <Chip
              key={language}
              size="large"
              selected={languages.includes(language)}
              variant={languages.includes(language) ? 'solid' : 'outlined'}
              onPress={() => handleToggleLanguage(language)}
            >
              {language}
            </Chip>
          ))}
        </View>
      </Field>

      <SettingsListGroup>
        <WizardSwitchItem
          title={t('listing.exchange.mealsIncluded')}
          value={offering.exchangeMealsIncluded}
          onValueChange={(value) => setFormData('offering', { exchangeMealsIncluded: value })}
        />
        <SettingsListDivider />
        <WizardSwitchItem
          title={t('listing.exchange.requiresReciprocity')}
          description={t('listing.exchange.requiresReciprocityHelp')}
          value={offering.exchangeRequiresReciprocity}
          onValueChange={(value) =>
            setFormData('offering', { exchangeRequiresReciprocity: value })
          }
        />
      </SettingsListGroup>

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
    backgroundColor: colors.exchangeSubtle,
  },
  addWindowButton: {
    alignSelf: 'flex-start',
  },
});
