import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { RiArrowLeftRightLine, RiCalendarLine, RiHotelBedLine } from '@oxy.so/bloom/icons';
import { RadioGroup } from '@oxy.so/bloom/radio';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import {
  ExchangeMode,
  OfferingType,
  type CreateExchangeRequestData,
  type Property,
} from '@homiio/shared-types';
import {
  AvailabilityCalendar,
  type AvailabilityCalendarRange,
} from '@/components/AvailabilityCalendar';
import { useCreateExchangeRequest } from '@/hooks/useExchangeQueries';
import { useUserProperties } from '@/hooks/usePropertyQueries';
import { getPropertyTitle, hasOffering } from '@/utils/propertyUtils';
import { formatLocalized } from '@/utils/dateLocale';
import { spacing } from '@/constants/styles';

export interface ExchangeRequestBottomSheetProps {
  property: Property;
  visible: boolean;
  onClose: () => void;
}

/** Concrete request mode — `both` is never a concrete request. */
type RequestMode = ExchangeMode.SWAP | ExchangeMode.HOST;
type CalendarTarget = 'requested' | 'offered' | null;

const MAX_MESSAGE = 2000;

const formatRange = (range: AvailabilityCalendarRange | null): string =>
  range
    ? `${formatLocalized(range.checkIn, 'MMM d')} → ${formatLocalized(range.checkOut, 'MMM d')}`
    : '';

const propertyId = (property: Property): string => property.id || '';

const isExchangeEnabled = (property: Property): boolean =>
  hasOffering(property, OfferingType.EXCHANGE);

/**
 * ExchangeRequestBottomSheet — propose a home swap or free-hosting stay.
 *
 * A Bloom `Dialog` (a bottom sheet on phones, a centred card from `md`) the
 * detail screen toggles via `visible`. It collects:
 *  - the requested stay window (reuses the vacation {@link AvailabilityCalendar},
 *    swapped in place inside the same dialog rather than stacking a second one),
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
  const theme = useTheme();
  const { oxyServices, activeSessionId } = useOxy();
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

  const myPropertiesQuery = useUserProperties();

  const myExchangeProperties = useMemo<Property[]>(() => {
    const target = propertyId(property);
    return (myPropertiesQuery.data?.properties ?? []).filter(
      (item) => isExchangeEnabled(item) && propertyId(item) !== target,
    );
  }, [myPropertiesQuery.data?.properties, property]);

  const propertyOptions = useMemo(
    () =>
      myExchangeProperties.map((item) => ({
        value: propertyId(item),
        label: getPropertyTitle(item),
      })),
    [myExchangeProperties],
  );

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
      openAccountDialog();
      return;
    }
    if (!requestedWindow) {
      toast.error(t('listing.exchange.errors.pickDates'));
      return;
    }
    if (isSwap && !offeredPropertyId) {
      toast.error(t('listing.exchange.errors.pickProperty'));
      return;
    }
    if (isSwap && !offeredWindow) {
      toast.error(t('listing.exchange.errors.pickOfferedDates'));
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
      toast.success(t('listing.exchange.requestSent'));
      onClose();
      router.push(`/exchange/${request.id}`);
    } catch (error) {
      const messageText =
        error instanceof Error
          ? error.message
          : t('listing.exchange.errors.failed');
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

  const title =
    calendarTarget === 'offered'
      ? t('listing.exchange.offeredWindow')
      : calendarTarget === 'requested'
        ? t('listing.exchange.requestedWindow')
        : t('listing.exchange.requestTitle');

  return (
    <Dialog
      open={visible}
      onClose={onClose}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={560}
      label={title}
      header={{
        title,
        largeTitle: false,
        onBack: calendarTarget ? () => setCalendarTarget(null) : undefined,
        primaryAction: calendarTarget
          ? undefined
          : {
              label: t('listing.exchange.sendRequest'),
              onPress: () => void handleSubmit(),
              disabled: createMutation.isPending,
              loading: createMutation.isPending,
            },
      }}
    >
      {calendarTarget ? (
        <AvailabilityCalendar
          mode="modal"
          initialRange={calendarTarget === 'offered' ? offeredWindow : requestedWindow}
          onApply={calendarTarget === 'offered' ? handleApplyOffered : handleApplyRequested}
        />
      ) : (
        <View style={styles.form}>
          {/* Mode (only when the listing accepts both) */}
          {allowsBoth ? (
            <View style={styles.field}>
              <BloomText style={[styles.label, { color: theme.colors.text }]}>
                {t('listing.exchange.requestModeLabel')}
              </BloomText>
              <SegmentedControl<RequestMode>
                label={t('listing.exchange.requestModeLabel')}
                type="radio"
                value={mode}
                onChange={setMode}
              >
                <SegmentedControlItem value={ExchangeMode.SWAP}>
                  <RiArrowLeftRightLine size="sm" fill={theme.colors.text} />
                  <SegmentedControlItemText>
                    {t('listing.exchange.mode.swap')}
                  </SegmentedControlItemText>
                </SegmentedControlItem>
                <SegmentedControlItem value={ExchangeMode.HOST}>
                  <RiHotelBedLine size="sm" fill={theme.colors.text} />
                  <SegmentedControlItemText>
                    {t('listing.exchange.mode.host')}
                  </SegmentedControlItemText>
                </SegmentedControlItem>
              </SegmentedControl>
            </View>
          ) : null}

          {/* Requested window */}
          <DateField
            label={t('listing.exchange.requestedWindow')}
            value={requestedWindow ? formatRange(requestedWindow) : ''}
            placeholder={t('listing.exchange.addDates')}
            onPress={() => setCalendarTarget('requested')}
          />

          {/* Swap-only: offered property + window */}
          {isSwap ? (
            <>
              <View style={styles.field}>
                <BloomText style={[styles.label, { color: theme.colors.text }]}>
                  {t('listing.exchange.offeredProperty')}
                </BloomText>
                {propertyOptions.length > 0 ? (
                  <RadioGroup
                    label={t('listing.exchange.offeredProperty')}
                    variant="card"
                    value={offeredPropertyId || undefined}
                    onValueChange={setOfferedPropertyId}
                    options={propertyOptions}
                  />
                ) : (
                  <BloomText style={[styles.helperText, { color: theme.colors.textSecondary }]}>
                    {t('listing.exchange.noExchangeProperties')}
                  </BloomText>
                )}
              </View>

              <DateField
                label={t('listing.exchange.offeredWindow')}
                value={offeredWindow ? formatRange(offeredWindow) : ''}
                placeholder={t('listing.exchange.addDates')}
                onPress={() => setCalendarTarget('offered')}
              />
            </>
          ) : null}

          {/* Message */}
          <Textarea
            label={t('listing.exchange.messageLabel')}
            value={message}
            onChangeText={setMessage}
            placeholder={t('listing.exchange.messagePlaceholder')}
            rows={4}
            autoResize
            maxLength={MAX_MESSAGE}
          />
        </View>
      )}
    </Dialog>
  );
};

interface DateFieldProps {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
}

/** A labelled date-range trigger: opens the calendar step inside the dialog. */
const DateField: React.FC<DateFieldProps> = ({ label, value, placeholder, onPress }) => {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <BloomText style={[styles.label, { color: theme.colors.text }]}>{label}</BloomText>
      <Button
        variant="outline"
        size="large"
        leadingIcon={RiCalendarLine}
        onPress={onPress}
        accessibilityLabel={label}
        style={styles.dateTrigger}
      >
        {value || placeholder}
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  form: {
    gap: spacing.lg,
  },
  field: {
    gap: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  dateTrigger: {
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 19,
  },
});

export default ExchangeRequestBottomSheet;
