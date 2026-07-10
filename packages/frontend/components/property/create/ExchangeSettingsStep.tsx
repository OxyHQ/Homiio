import React, { useCallback, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';
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
import { spacing } from '@/constants/styles';
import {
  EXCHANGE_LANGUAGE_OPTIONS,
  EXCHANGE_MODE_OPTIONS,
} from './constants';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

const ICON_SIZE = 18;
const MODAL_INSET_PADDING = 16;

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
 *  - mode (home swap / free hosting / either),
 *  - availability windows (reuses the vacation {@link AvailabilityCalendar}; each
 *    confirmed range is stored as an `AVAILABLE` {@link AvailabilityWindow}, the
 *    same shape the detail screen's AvailabilitySection renders),
 *  - a welcome note, the languages spoken, a meals-included toggle, and a
 *    reciprocity toggle.
 *
 * These map to the property `exchange` block on submit. The store seeds inert
 * defaults so the step is safe to skip when exchange isn't selected.
 */
export function ExchangeSettingsStep({ formData, setFormData }: PropertyStepProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
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

  const handleWelcomeNote = useCallback(
    (text: string) => {
      setFormData('offering', { exchangeWelcomeNote: text });
    },
    [setFormData],
  );

  const handleToggleMeals = useCallback(() => {
    setFormData('offering', {
      exchangeMealsIncluded: !offering.exchangeMealsIncluded,
    });
  }, [setFormData, offering.exchangeMealsIncluded]);

  const handleToggleReciprocity = useCallback(() => {
    setFormData('offering', {
      exchangeRequiresReciprocity: !offering.exchangeRequiresReciprocity,
    });
  }, [setFormData, offering.exchangeRequiresReciprocity]);

  return (
    <View>
      <ThemedText type="subtitle">
        {t('listing.exchange.stepTitle')}
      </ThemedText>
      <ThemedText style={styles.addressInstructions}>
        {t('listing.exchange.stepHelp')}
      </ThemedText>

      {/* Mode */}
      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.exchange.modeLabel')}
        </ThemedText>
        <View style={exchangeStyles.modeList}>
          {EXCHANGE_MODE_OPTIONS.map((option) => {
            const selected = offering.exchangeMode === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  exchangeStyles.modeCard,
                  selected && exchangeStyles.modeCardSelected,
                ]}
                onPress={() => handleSelectMode(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(option.i18nKey)}
              >
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={ICON_SIZE}
                  color={selected ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                />
                <View style={exchangeStyles.modeTextWrap}>
                  <ThemedText
                    style={[
                      exchangeStyles.modeTitle,
                      selected && exchangeStyles.modeTitleSelected,
                    ]}
                  >
                    {t(option.i18nKey)}
                  </ThemedText>
                  <ThemedText style={exchangeStyles.modeDescription}>
                    {t(option.descriptionKey)}
                  </ThemedText>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Availability windows */}
      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.exchange.availabilityLabel')}
        </ThemedText>
        {windows.length > 0 ? (
          <View style={exchangeStyles.windowList}>
            {windows.map((window) => {
              const key = windowKey(window);
              return (
                <View key={key} style={exchangeStyles.windowChip}>
                  <Ionicons
                    name="calendar-outline"
                    size={14}
                    color={colors.exchangeAccent}
                  />
                  <BloomText style={exchangeStyles.windowText}>
                    {formatWindow(window)}
                  </BloomText>
                  <Pressable
                    onPress={() => handleRemoveWindow(key)}
                    accessibilityRole="button"
                    accessibilityLabel={t('listing.exchange.removeWindow')}
                    hitSlop={8}
                  >
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={colors.COLOR_BLACK_LIGHT_4}
                    />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <ThemedText style={exchangeStyles.emptyWindows}>
            {t('listing.exchange.noWindows')}
          </ThemedText>
        )}
        <TouchableOpacity
          style={exchangeStyles.addWindowButton}
          onPress={() => setCalendarOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('listing.exchange.addWindow')}
        >
          <Ionicons name="add" size={ICON_SIZE} color={colors.primaryColor} />
          <ThemedText style={exchangeStyles.addWindowText}>
            {t('listing.exchange.addWindow')}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Welcome note */}
      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.exchange.welcomeNote')}
        </ThemedText>
        <TextInput
          style={styles.textArea}
          value={offering.exchangeWelcomeNote ?? ''}
          onChangeText={handleWelcomeNote}
          placeholder={t('listing.exchange.welcomeNotePlaceholder')}
          placeholderTextColor={colors.COLOR_BLACK_LIGHT_4}
          multiline
          textAlignVertical="top"
        />
      </View>

      {/* Languages */}
      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.exchange.languages')}
        </ThemedText>
        <View style={styles.optionRow}>
          {EXCHANGE_LANGUAGE_OPTIONS.map((language) => {
            const selected = languages.includes(language);
            return (
              <TouchableOpacity
                key={language}
                style={[
                  styles.propertyTypeButton,
                  selected && styles.propertyTypeButtonSelected,
                ]}
                onPress={() => handleToggleLanguage(language)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
              >
                <ThemedText
                  style={[
                    styles.propertyTypeText,
                    selected && styles.propertyTypeTextSelected,
                  ]}
                >
                  {language}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Meals included */}
      <View style={styles.toggleContainer}>
        <ThemedText style={styles.label}>
          {t('listing.exchange.mealsIncluded')}
        </ThemedText>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            offering.exchangeMealsIncluded ? styles.toggleButtonActive : null,
          ]}
          onPress={handleToggleMeals}
          accessibilityRole="switch"
          accessibilityState={{ checked: offering.exchangeMealsIncluded }}
        >
          <Ionicons
            name={offering.exchangeMealsIncluded ? 'checkmark-circle' : 'close-circle'}
            size={24}
            color={
              offering.exchangeMealsIncluded
                ? colors.primaryColor
                : colors.COLOR_BLACK_LIGHT_4
            }
          />
          <ThemedText style={styles.toggleText}>
            {offering.exchangeMealsIncluded
              ? t('common.yes')
              : t('common.no')}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Reciprocity */}
      <View style={styles.toggleContainer}>
        <View style={exchangeStyles.reciprocityLabelWrap}>
          <ThemedText style={styles.label}>
            {t('listing.exchange.requiresReciprocity')}
          </ThemedText>
          <ThemedText style={exchangeStyles.reciprocityHelp}>
            {t('listing.exchange.requiresReciprocityHelp')}
          </ThemedText>
        </View>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            offering.exchangeRequiresReciprocity ? styles.toggleButtonActive : null,
          ]}
          onPress={handleToggleReciprocity}
          accessibilityRole="switch"
          accessibilityState={{ checked: offering.exchangeRequiresReciprocity }}
        >
          <Ionicons
            name={
              offering.exchangeRequiresReciprocity
                ? 'checkmark-circle'
                : 'close-circle'
            }
            size={24}
            color={
              offering.exchangeRequiresReciprocity
                ? colors.primaryColor
                : colors.COLOR_BLACK_LIGHT_4
            }
          />
          <ThemedText style={styles.toggleText}>
            {offering.exchangeRequiresReciprocity
              ? t('common.yes')
              : t('common.no')}
          </ThemedText>
        </TouchableOpacity>
      </View>

      <Modal
        visible={calendarOpen}
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
        transparent={Platform.OS === 'web'}
        onRequestClose={() => setCalendarOpen(false)}
      >
        <View style={exchangeStyles.modalBackdrop}>
          <View
            style={[
              exchangeStyles.modalSurface,
              Platform.OS === 'web'
                ? null
                : { paddingBottom: MODAL_INSET_PADDING + insets.bottom },
            ]}
          >
            <View style={exchangeStyles.modalHeader}>
              <H3 style={exchangeStyles.modalTitle}>
                {t('listing.exchange.addWindow')}
              </H3>
              <Button
                variant="icon"
                size="small"
                onPress={() => setCalendarOpen(false)}
                accessibilityLabel={t('common.close')}
              >
                {'×'}
              </Button>
            </View>
            <AvailabilityCalendar mode="modal" onApply={handleAddWindow} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const exchangeStyles = StyleSheet.create({
  modeList: {
    gap: spacing.sm,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
  },
  modeCardSelected: {
    borderColor: colors.primaryColor,
    backgroundColor: colors.primaryLight,
  },
  modeTextWrap: {
    flex: 1,
    gap: 2,
  },
  modeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  modeTitleSelected: {
    color: colors.primaryColor,
  },
  modeDescription: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  windowList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  windowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.exchangeSubtle,
  },
  windowText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  emptyWindows: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: spacing.md,
  },
  addWindowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primaryColor,
  },
  addWindowText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryColor,
  },
  reciprocityLabelWrap: {
    flex: 1,
    marginRight: spacing.md,
    gap: 2,
  },
  reciprocityHelp: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: 'center',
  },
  modalSurface: {
    backgroundColor: colors.white,
    width: '100%',
    maxWidth: 720,
    maxHeight: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: Platform.OS === 'web' ? 24 : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? 24 : 0,
    padding: 16,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
});
