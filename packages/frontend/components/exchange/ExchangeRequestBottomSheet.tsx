import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';
import {
  ExchangeMode,
  ListingIntent,
  type CreateExchangeRequestData,
  type Property,
} from '@homiio/shared-types';

import { toast } from '@/lib/sonner';
import {
  AvailabilityCalendar,
  type AvailabilityCalendarRange,
} from '@/components/AvailabilityCalendar';
import { useProfile } from '@/context/ProfileContext';
import { useCreateExchangeRequest } from '@/hooks/useExchangeQueries';
import { useUserProperties } from '@/hooks/usePropertyQueries';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { formatLocalized } from '@/utils/dateLocale';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

export interface ExchangeRequestBottomSheetProps {
  property: Property;
  visible: boolean;
  onClose: () => void;
}

/** Concrete request mode — `both` is never a concrete request. */
type RequestMode = ExchangeMode.SWAP | ExchangeMode.HOST;
type CalendarTarget = 'requested' | 'offered' | null;

const MODAL_INSET_PADDING = 16;

const formatRange = (range: AvailabilityCalendarRange | null): string =>
  range
    ? `${formatLocalized(range.checkIn, 'MMM d')} → ${formatLocalized(range.checkOut, 'MMM d')}`
    : '';

const propertyId = (property: Property): string => property._id || property.id || '';

const isExchangeEnabled = (property: Property): boolean =>
  Array.isArray(property.intents) &&
  property.intents.includes(ListingIntent.EXCHANGE);

/**
 * ExchangeRequestBottomSheet — propose a home swap or free-hosting stay.
 *
 * A self-contained modal (owns its own backdrop + safe-area like BookingWidget)
 * the detail screen toggles via `visible`. It collects:
 *  - the requested stay window (reuses the vacation {@link AvailabilityCalendar}),
 *  - a mode selector, shown only when the listing's `exchange.mode === 'both'`
 *    (otherwise the single supported mode is implied),
 *  - for a SWAP: a picker of the requester's OWN exchange-enabled properties
 *    (`offeredPropertyId`) plus an offered window,
 *  - an optional message.
 *
 * Submits via `useCreateExchangeRequest`. Unauthenticated users are routed to
 * the Oxy sign-in modal (matching other gated actions). The backend owns the
 * business rules; this form mirrors them only to avoid obviously-invalid sends.
 */
export const ExchangeRequestBottomSheet: React.FC<ExchangeRequestBottomSheetProps> = ({
  property,
  visible,
  onClose,
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { oxyServices, activeSessionId } = useOxy();
  const { primaryProfile } = useProfile();

  const listingMode = property.exchange?.mode ?? ExchangeMode.BOTH;
  const allowsBoth = listingMode === ExchangeMode.BOTH;

  const [mode, setMode] = useState<RequestMode>(
    listingMode === ExchangeMode.HOST ? ExchangeMode.HOST : ExchangeMode.SWAP,
  );
  const [requestedWindow, setRequestedWindow] =
    useState<AvailabilityCalendarRange | null>(null);
  const [offeredWindow, setOfferedWindow] =
    useState<AvailabilityCalendarRange | null>(null);
  const [offeredPropertyId, setOfferedPropertyId] = useState<string>('');
  const [message, setMessage] = useState('');
  const [calendarTarget, setCalendarTarget] = useState<CalendarTarget>(null);

  const profileId = primaryProfile?._id ?? primaryProfile?.id;
  const myPropertiesQuery = useUserProperties(profileId);

  const myExchangeProperties = useMemo<Property[]>(() => {
    const target = propertyId(property);
    return (myPropertiesQuery.data?.properties ?? []).filter(
      (item) => isExchangeEnabled(item) && propertyId(item) !== target,
    );
  }, [myPropertiesQuery.data?.properties, property]);

  const createMutation = useCreateExchangeRequest();

  const effectiveMode: RequestMode = allowsBoth
    ? mode
    : listingMode === ExchangeMode.HOST
      ? ExchangeMode.HOST
      : ExchangeMode.SWAP;
  const isSwap = effectiveMode === ExchangeMode.SWAP;

  const handleApplyRequested = useCallback(
    (range: AvailabilityCalendarRange | null) => {
      setRequestedWindow(range);
      setCalendarTarget(null);
    },
    [],
  );

  const handleApplyOffered = useCallback(
    (range: AvailabilityCalendarRange | null) => {
      setOfferedWindow(range);
      setCalendarTarget(null);
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      showSignInModal();
      return;
    }
    if (!requestedWindow) {
      toast.error(
        t('listing.exchange.errors.pickDates', 'Pick the dates you want to stay'),
      );
      return;
    }
    if (isSwap && !offeredPropertyId) {
      toast.error(
        t('listing.exchange.errors.pickProperty', 'Choose the home you’re offering'),
      );
      return;
    }
    if (isSwap && !offeredWindow) {
      toast.error(
        t('listing.exchange.errors.pickOfferedDates', 'Pick the dates you’re offering'),
      );
      return;
    }

    const payload: CreateExchangeRequestData = {
      propertyId: propertyId(property),
      mode: effectiveMode,
      requestedWindow: {
        start: requestedWindow.checkIn.toISOString(),
        end: requestedWindow.checkOut.toISOString(),
      },
      message: message.trim() || undefined,
    };
    if (isSwap && offeredWindow) {
      payload.offeredPropertyId = offeredPropertyId;
      payload.offeredWindow = {
        start: offeredWindow.checkIn.toISOString(),
        end: offeredWindow.checkOut.toISOString(),
      };
    }

    try {
      const request = await createMutation.mutateAsync(payload);
      toast.success(t('listing.exchange.requestSent', 'Exchange request sent'));
      onClose();
      router.push(`/exchange/${request.id}`);
    } catch (error) {
      const messageText =
        error instanceof Error
          ? error.message
          : t('listing.exchange.errors.failed', 'Could not send request');
      toast.error(messageText);
    }
  }, [
    oxyServices,
    activeSessionId,
    requestedWindow,
    isSwap,
    offeredPropertyId,
    offeredWindow,
    property,
    effectiveMode,
    message,
    createMutation,
    onClose,
    router,
    t,
  ]);

  return (
    <Modal
      visible={visible}
      animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
      transparent={Platform.OS === 'web'}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.surface,
            Platform.OS === 'web'
              ? null
              : { paddingBottom: MODAL_INSET_PADDING + insets.bottom },
          ]}
        >
          <View style={styles.header}>
            <H3 style={styles.title}>
              {t('listing.exchange.requestTitle', 'Request exchange')}
            </H3>
            <Button
              variant="icon"
              size="small"
              onPress={onClose}
              accessibilityLabel={t('common.close', 'Close')}
            >
              {'×'}
            </Button>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Mode (only when the listing accepts both) */}
            {allowsBoth ? (
              <View style={styles.field}>
                <BloomText style={styles.label}>
                  {t('listing.exchange.requestModeLabel', 'What are you proposing?')}
                </BloomText>
                <View style={styles.modeRow}>
                  <ModeChip
                    active={mode === ExchangeMode.SWAP}
                    icon="swap-horizontal"
                    label={t('listing.exchange.mode.swap', 'Home swap')}
                    onPress={() => setMode(ExchangeMode.SWAP)}
                  />
                  <ModeChip
                    active={mode === ExchangeMode.HOST}
                    icon="bed-outline"
                    label={t('listing.exchange.mode.host', 'Free hosting')}
                    onPress={() => setMode(ExchangeMode.HOST)}
                  />
                </View>
              </View>
            ) : null}

            {/* Requested window */}
            <View style={styles.field}>
              <BloomText style={styles.label}>
                {t('listing.exchange.requestedWindow', 'Dates you want to stay')}
              </BloomText>
              <Pressable
                style={styles.dateTrigger}
                onPress={() => setCalendarTarget('requested')}
                accessibilityRole="button"
                accessibilityLabel={t(
                  'listing.exchange.requestedWindow',
                  'Dates you want to stay',
                )}
              >
                <Ionicons
                  name="calendar-outline"
                  size={18}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
                <BloomText
                  style={[
                    styles.dateValue,
                    !requestedWindow && styles.datePlaceholder,
                  ]}
                  numberOfLines={1}
                >
                  {requestedWindow
                    ? formatRange(requestedWindow)
                    : t('listing.exchange.addDates', 'Add dates')}
                </BloomText>
              </Pressable>
            </View>

            {/* Swap-only: offered property + window */}
            {isSwap ? (
              <>
                <View style={styles.field}>
                  <BloomText style={styles.label}>
                    {t('listing.exchange.offeredProperty', 'Home you’re offering')}
                  </BloomText>
                  {myExchangeProperties.length > 0 ? (
                    <View style={styles.propertyList}>
                      {myExchangeProperties.map((item) => {
                        const id = propertyId(item);
                        const selected = offeredPropertyId === id;
                        return (
                          <Pressable
                            key={id}
                            style={[
                              styles.propertyOption,
                              selected && styles.propertyOptionSelected,
                            ]}
                            onPress={() => setOfferedPropertyId(id)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                          >
                            <Ionicons
                              name={selected ? 'radio-button-on' : 'radio-button-off'}
                              size={18}
                              color={
                                selected
                                  ? colors.primaryColor
                                  : colors.COLOR_BLACK_LIGHT_4
                              }
                            />
                            <BloomText style={styles.propertyOptionText} numberOfLines={1}>
                              {getPropertyTitle(item)}
                            </BloomText>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <BloomText style={styles.helperText}>
                      {t(
                        'listing.exchange.noExchangeProperties',
                        'You have no exchange-enabled homes yet. List one to propose a swap.',
                      )}
                    </BloomText>
                  )}
                </View>

                <View style={styles.field}>
                  <BloomText style={styles.label}>
                    {t('listing.exchange.offeredWindow', 'Dates you’re offering')}
                  </BloomText>
                  <Pressable
                    style={styles.dateTrigger}
                    onPress={() => setCalendarTarget('offered')}
                    accessibilityRole="button"
                    accessibilityLabel={t(
                      'listing.exchange.offeredWindow',
                      'Dates you’re offering',
                    )}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={18}
                      color={colors.COLOR_BLACK_LIGHT_3}
                    />
                    <BloomText
                      style={[
                        styles.dateValue,
                        !offeredWindow && styles.datePlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      {offeredWindow
                        ? formatRange(offeredWindow)
                        : t('listing.exchange.addDates', 'Add dates')}
                    </BloomText>
                  </Pressable>
                </View>
              </>
            ) : null}

            {/* Message */}
            <View style={styles.field}>
              <BloomText style={styles.label}>
                {t('listing.exchange.messageLabel', 'Message to the host')}
              </BloomText>
              <TextInput
                style={styles.messageInput}
                value={message}
                onChangeText={setMessage}
                placeholder={t(
                  'listing.exchange.messagePlaceholder',
                  'Introduce yourself and your trip.',
                )}
                placeholderTextColor={colors.COLOR_BLACK_LIGHT_4}
                multiline
                textAlignVertical="top"
                maxLength={2000}
              />
            </View>
          </ScrollView>

          <Button
            variant="primary"
            size="large"
            onPress={handleSubmit}
            loading={createMutation.isPending}
            disabled={createMutation.isPending}
            style={styles.submit}
          >
            {t('listing.exchange.sendRequest', 'Send request')}
          </Button>
        </View>
      </View>

      {/* Nested calendar modal — reuses the vacation range picker. */}
      <Modal
        visible={calendarTarget !== null}
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
        transparent={Platform.OS === 'web'}
        onRequestClose={() => setCalendarTarget(null)}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.surface,
              Platform.OS === 'web'
                ? null
                : { paddingBottom: MODAL_INSET_PADDING + insets.bottom },
            ]}
          >
            <View style={styles.header}>
              <H3 style={styles.title}>
                {calendarTarget === 'offered'
                  ? t('listing.exchange.offeredWindow', 'Dates you’re offering')
                  : t('listing.exchange.requestedWindow', 'Dates you want to stay')}
              </H3>
              <Button
                variant="icon"
                size="small"
                onPress={() => setCalendarTarget(null)}
                accessibilityLabel={t('common.close', 'Close')}
              >
                {'×'}
              </Button>
            </View>
            <AvailabilityCalendar
              mode="modal"
              initialRange={
                calendarTarget === 'offered' ? offeredWindow : requestedWindow
              }
              onApply={
                calendarTarget === 'offered'
                  ? handleApplyOffered
                  : handleApplyRequested
              }
            />
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

interface ModeChipProps {
  active: boolean;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}

const ModeChip: React.FC<ModeChipProps> = ({ active, icon, label, onPress }) => (
  <Pressable
    style={[styles.modeChip, active && styles.modeChipActive]}
    onPress={onPress}
    accessibilityRole="radio"
    accessibilityState={{ selected: active }}
  >
    <Ionicons
      name={icon}
      size={16}
      color={active ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
    />
    <BloomText style={[styles.modeChipLabel, active && styles.modeChipLabelActive]}>
      {label}
    </BloomText>
  </Pressable>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: 'center',
  },
  surface: {
    backgroundColor: colors.white,
    width: '100%',
    maxWidth: 560,
    maxHeight: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: Platform.OS === 'web' ? 24 : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? 24 : 0,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: spacing.lg,
    paddingBottom: spacing.sm,
  },
  field: {
    gap: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
  },
  modeChipActive: {
    borderColor: colors.primaryColor,
    backgroundColor: colors.primaryLight,
  },
  modeChipLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  modeChipLabelActive: {
    color: colors.primaryColor,
  },
  dateTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
  },
  dateValue: {
    flex: 1,
    fontSize: 15,
    color: colors.COLOR_BLACK,
  },
  datePlaceholder: {
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  propertyList: {
    gap: spacing.sm,
  },
  propertyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
  },
  propertyOptionSelected: {
    borderColor: colors.primaryColor,
    backgroundColor: colors.primaryLight,
  },
  propertyOptionText: {
    flex: 1,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  helperText: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 19,
  },
  messageInput: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 12,
    padding: spacing.md,
    fontSize: 15,
    color: colors.COLOR_BLACK,
    minHeight: 96,
  },
  submit: {
    alignSelf: 'stretch',
  },
});

export default ExchangeRequestBottomSheet;
