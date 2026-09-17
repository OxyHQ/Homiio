/**
 * Host calendar — bookings and blocked dates per property.
 *
 * Composed from Bloom's CalendarView parts (`@oxy.so/bloom/calendar`):
 *   - `CalendarViewHeader` owns the month switcher and the "Block dates" action;
 *   - `CalendarViewMonthGrid` draws reservations and blocked windows as event
 *     chips, one per day. Its details popover is off (`showEventDetails`): a
 *     booking chip opens `/reservations/[id]` instead.
 *
 * The month grid has no day-press, so blocking dates happens in a Bloom
 * `Dialog` holding a `RangeCalendar`, with booked, blocked and past days
 * unavailable. Availability windows are half-open `[start, end)`, matching the
 * backend, so the chosen last day is extended by one.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isBefore,
  max as maxDate,
  min as minDate,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns';
import { toast } from '@oxy.so/bloom/toast';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import {
  CalendarViewHeader,
  CalendarViewMonthGrid,
  type CalendarViewEvent,
  type CalendarViewEventColor,
} from '@oxy.so/bloom/calendar';
import { Chip, type ChipHue } from '@oxy.so/bloom/chip';
import { RangeCalendar, type DateRange } from '@oxy.so/bloom/date-picker';
import { Dialog } from '@oxy.so/bloom/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Z_INDEX } from '@oxy.so/bloom/styles';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText, H2 } from '@oxy.so/bloom/typography';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import { useTranslation } from 'react-i18next';
import {
  AvailabilityWindow,
  AvailabilityWindowStatus,
  Property,
  Reservation,
  ReservationStatus,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import {
  reservationKeys,
  usePropertyAvailabilityQuery,
  useReservationsQuery,
} from '@/hooks/useReservationQueries';
import { useUserProperties } from '@/hooks/usePropertyQueries';
import { propertyService } from '@/services/propertyService';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { getFormatLocale } from '@/utils/dateLocale';
import { radius, spacing } from '@/constants/styles';

/** Web scrolls the document; native screens own their ScrollView. */
const IS_WEB = Platform.OS === 'web';

type SpanKind = 'confirmed' | 'pending' | 'blocked';

interface Span {
  kind: SpanKind;
  /** Inclusive start day. */
  start: Date;
  /** Exclusive end day (half-open, as stored). */
  end: Date;
  reservationId?: string;
}

/** Event chip colour per span kind, and the legend Chip hue closest to it. */
const SPAN_STYLE: Record<
  SpanKind,
  { event: CalendarViewEventColor; hue: ChipHue; i18nKey: string }
> = {
  confirmed: { event: 'lime', hue: 'lime', i18nKey: 'host.calendar.legendConfirmed' },
  pending: { event: 'blue', hue: 'blue', i18nKey: 'host.calendar.legendPending' },
  blocked: { event: 'pink', hue: 'rose', i18nKey: 'host.calendar.legendBlocked' },
};

const toSpan = (
  kind: SpanKind,
  start: string,
  end: string,
  reservationId?: string,
): Span | null => {
  const s = startOfDay(new Date(start));
  const e = startOfDay(new Date(end));
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || !isBefore(s, e)) return null;
  return { kind, start: s, end: e, reservationId };
};

const buildSpans = (
  windows: AvailabilityWindow[] | undefined,
  reservations: Reservation[],
): Span[] => {
  const spans: Span[] = [];
  for (const window of windows ?? []) {
    if (window.status !== AvailabilityWindowStatus.BLOCKED) continue;
    const span = toSpan('blocked', window.start, window.end);
    if (span) spans.push(span);
  }
  for (const reservation of reservations) {
    const kind = reservation.status === ReservationStatus.CONFIRMED ? 'confirmed' : 'pending';
    const span = toSpan(kind, reservation.checkIn, reservation.checkOut, reservation.id);
    if (span) spans.push(span);
  }
  return spans;
};

const isInSpan = (day: Date, span: Span) =>
  day.getTime() >= span.start.getTime() && day.getTime() < span.end.getTime();

interface BlockDialogState {
  visible: boolean;
  range: DateRange | null;
  reason: string;
}

const INITIAL_BLOCK_STATE: BlockDialogState = { visible: false, range: null, reason: '' };

export default function HostCalendarScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  const propertiesQuery = useUserProperties();
  const propertyList = propertiesQuery.data?.properties;
  const properties = useMemo(() => propertyList ?? [], [propertyList]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const locale = getFormatLocale(i18n.language);

  const effectivePropertyId = useMemo(() => {
    if (selectedPropertyId) return selectedPropertyId;
    return properties[0]?.id ?? null;
  }, [properties, selectedPropertyId]);

  const selectedProperty = useMemo<Property | null>(() => {
    if (!effectivePropertyId) return null;
    return properties.find((item) => item.id === effectivePropertyId) ?? null;
  }, [effectivePropertyId, properties]);

  const availabilityQuery = usePropertyAvailabilityQuery(effectivePropertyId ?? undefined);
  const hostReservationsQuery = useReservationsQuery(
    { asHost: true, limit: 100 },
    { enabled: isAuthed },
  );

  const reservationsForProperty = useMemo<Reservation[]>(() => {
    if (!effectivePropertyId) return [];
    return (
      hostReservationsQuery.data?.items.filter(
        (item) =>
          item.propertyId === effectivePropertyId &&
          (item.status === ReservationStatus.PENDING ||
            item.status === ReservationStatus.CONFIRMED),
      ) ?? []
    );
  }, [effectivePropertyId, hostReservationsQuery.data?.items]);

  const spans = useMemo(
    () => buildSpans(availabilityQuery.data?.windows, reservationsForProperty),
    [availabilityQuery.data?.windows, reservationsForProperty],
  );

  /** One event chip per day of each span, limited to the six weeks the grid shows. */
  const events = useMemo<CalendarViewEvent[]>(() => {
    const gridStart = subDays(startOfMonth(month), 7);
    const gridEnd = addDays(endOfMonth(month), 14);
    const out: CalendarViewEvent[] = [];
    spans.forEach((span, index) => {
      const first = maxDate([span.start, gridStart]);
      const last = minDate([subDays(span.end, 1), gridEnd]);
      if (isBefore(last, first)) return;
      const style = SPAN_STYLE[span.kind];
      for (const date of eachDayOfInterval({ start: first, end: last })) {
        out.push({
          id: `${span.reservationId ?? `blocked-${index}`}:${format(date, 'yyyyMMdd')}`,
          date,
          title: t(style.i18nKey),
          color: style.event,
        });
      }
    });
    return out;
  }, [month, spans, t]);

  const handleSelectEvent = useCallback(
    (event: CalendarViewEvent) => {
      const [key] = event.id.split(':');
      if (key && !key.startsWith('blocked-')) router.push(`/reservations/${key}`);
    },
    [router],
  );

  const queryClient = useQueryClient();
  const [blockState, setBlockState] = useState<BlockDialogState>(INITIAL_BLOCK_STATE);
  const [submitting, setSubmitting] = useState(false);

  const isDateUnavailable = useCallback(
    (date: Date) => {
      const day = startOfDay(date);
      return spans.some((span) => isInSpan(day, span));
    },
    [spans],
  );

  const openDialog = useCallback(() => {
    setBlockState({ ...INITIAL_BLOCK_STATE, visible: true });
  }, []);

  const closeDialog = useCallback(() => {
    setBlockState(INITIAL_BLOCK_STATE);
  }, []);

  const handleRange = useCallback(
    (range: DateRange) => {
      // A block must not swallow an existing booking or block: collapse onto
      // the last press so the host starts again from there.
      const crosses = eachDayOfInterval({ start: range.start, end: range.end }).some(
        isDateUnavailable,
      );
      setBlockState((state) => ({
        ...state,
        range: crosses ? { start: range.end, end: range.end } : range,
      }));
    },
    [isDateUnavailable],
  );

  const handleConfirmBlock = useCallback(async () => {
    const range = blockState.range;
    if (!effectivePropertyId || !range) return;
    setSubmitting(true);
    try {
      const property = await propertyService.getPropertyById(effectivePropertyId);
      if (!property) {
        throw new Error(t('host.calendar.propertyNotFound'));
      }
      const next: AvailabilityWindow = {
        start: startOfDay(range.start).toISOString(),
        // Half-open [start, end): include the last chosen day.
        end: addDays(startOfDay(range.end), 1).toISOString(),
        status: AvailabilityWindowStatus.BLOCKED,
      };
      await propertyService.updateProperty(effectivePropertyId, {
        availabilityWindows: [...(property.availabilityWindows ?? []), next],
      });
      queryClient.invalidateQueries({
        queryKey: reservationKeys.availability(effectivePropertyId),
      });
      toast.success(t('host.calendar.toastBlocked'));
      closeDialog();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('host.calendar.toastBlockFailed');
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }, [blockState.range, closeDialog, effectivePropertyId, queryClient, t]);

  const header = <Header options={{ showBackButton: true, title: t('host.calendar.title') }} />;

  if (!isAuthed) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="calendar-outline"
              title={t('host.calendar.signInTitle')}
              description={t('host.calendar.signInDescription')}
              actionText={t('host.calendar.signIn')}
              actionIcon="log-in-outline"
              onAction={() => openAccountDialog()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (propertiesQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <View style={styles.content}>
          <View style={styles.stack}>
            <Skeleton.Text style={{ width: 120, lineHeight: 14 }} />
            <Skeleton.Box height={48} borderRadius={radius.md} />
          </View>
          <View style={styles.stack}>
            <Skeleton.Text style={{ width: 200, lineHeight: 28 }} />
            <Skeleton.Text style={{ width: 160, lineHeight: 16 }} />
          </View>
          <Skeleton.Box height={320} borderRadius={radius.lg} />
        </View>
      </View>
    );
  }

  if (propertiesQuery.error) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <ErrorState
            icon="cloud-offline-outline"
            title={t('host.calendar.loadPropertiesError')}
            description={
              typeof propertiesQuery.error === 'string'
                ? propertiesQuery.error
                : t('host.calendar.tryAgain')
            }
            onRetry={() => propertiesQuery.refetch()}
          />
        </SafeAreaView>
      </View>
    );
  }

  if (properties.length === 0) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="home-outline"
              title={t('host.calendar.emptyTitle')}
              description={t('host.calendar.emptyDescription')}
              actionText={t('host.calendar.createListing')}
              actionIcon="add"
              onAction={() => router.push('/properties/create')}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const blockRange = blockState.range;
  const body = (
    <View style={styles.content}>
      <Card variant="outlined" radius="radius-16" className="p-4">
        <View style={styles.stack}>
          <SectionEyebrow>{t('host.calendar.property')}</SectionEyebrow>
          <DropdownMenu>
            <DropdownMenuTrigger asChild label={t('host.calendar.chooseProperty')}>
              <Button
                variant="secondary"
                size="large"
                style={styles.pickerButton}
                trailingIcon={RiArrowDownSLine}
              >
                {selectedProperty
                  ? getPropertyTitle(selectedProperty)
                  : t('host.calendar.chooseProperty')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                {properties.map((property) => {
                  const id = property.id ?? '';
                  return (
                    <DropdownMenuItem key={id} onPress={() => setSelectedPropertyId(id)}>
                      {getPropertyTitle(property)}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
      </Card>

      {selectedProperty ? (
        <>
          <View style={styles.titleBlock}>
            <H2 style={styles.title}>{getPropertyTitle(selectedProperty)}</H2>
            {selectedProperty.address ? (
              <BloomText style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                {[selectedProperty.address.cityName, selectedProperty.address.countryName]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </View>

          <View style={styles.calendarBlock}>
            {/* The month switcher grows down over the grid: keep the header above it. */}
            <View style={styles.headerLayer}>
              <CalendarViewHeader
                month={month}
                locale={locale}
                headingLevel={2}
                onPreviousMonth={() => setMonth((current) => startOfMonth(subDays(current, 1)))}
                onNextMonth={() =>
                  setMonth((current) => startOfMonth(addDays(endOfMonth(current), 1)))
                }
                onSelectDate={(date) => setMonth(startOfMonth(date))}
                onNewEvent={availabilityQuery.isSuccess ? openDialog : undefined}
                newEventLabel={t('host.calendar.blockDates')}
                actions={
                  <View style={styles.legendRow}>
                    {(Object.keys(SPAN_STYLE) as SpanKind[]).map((kind) => (
                      <Chip key={kind} size="small" hue={SPAN_STYLE[kind].hue}>
                        {t(SPAN_STYLE[kind].i18nKey)}
                      </Chip>
                    ))}
                  </View>
                }
              />
            </View>

            {availabilityQuery.isLoading ? (
              <View style={styles.loadingWrap}>
                <Loading variant="spinner" />
              </View>
            ) : availabilityQuery.isError ? (
              <ErrorState
                icon="cloud-offline-outline"
                title={t('host.calendar.availabilityError')}
                description={availabilityQuery.error?.message ?? t('host.calendar.tryAgain')}
                onRetry={() => availabilityQuery.refetch()}
              />
            ) : (
              <View
                style={[styles.gridCard, { backgroundColor: theme.colors.backgroundSecondary }]}
              >
                <CalendarViewMonthGrid
                  month={month}
                  events={events}
                  locale={locale}
                  showEventDetails={false}
                  onSelectEvent={handleSelectEvent}
                />
              </View>
            )}
          </View>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        {IS_WEB ? body : <ScrollView>{body}</ScrollView>}

        <Dialog
          placement="center"
          open={blockState.visible}
          onClose={closeDialog}
          dismissOnBackdrop={!submitting}
          maxWidth={420}
          title={t('host.calendar.blockTitle')}
          label={t('host.calendar.blockTitle')}
          description={
            blockRange
              ? t('host.calendar.blockBodyRange', {
                  start: format(blockRange.start, 'EEE, MMM d'),
                  end: format(blockRange.end, 'EEE, MMM d, yyyy'),
                })
              : t('host.calendar.blockBodySingle')
          }
          actions={[
            {
              label: t('host.calendar.blockConfirm'),
              disabled: submitting || !blockRange,
              shouldCloseOnPress: false,
              onPress: () => void handleConfirmBlock(),
            },
            {
              label: t('common.cancel'),
              color: 'cancel',
              disabled: submitting,
              shouldCloseOnPress: false,
              onPress: closeDialog,
            },
          ]}
        >
          <View style={styles.dialogBody}>
            <RangeCalendar
              value={blockRange}
              onChange={handleRange}
              minDate={startOfDay(new Date())}
              isDateUnavailable={isDateUnavailable}
              weekStartsOn={1}
              locale={locale}
              defaultMonth={month}
              accessibilityLabel={t('host.calendar.blockTitle')}
            />
            <TextFieldInput
              label={t('host.calendar.blockReasonLabel')}
              value={blockState.reason}
              onChangeText={(reason) => setBlockState((state) => ({ ...state, reason }))}
              editable={!submitting}
              placeholder={t('host.calendar.blockReasonPlaceholder')}
            />
          </View>
        </Dialog>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing['2xl'],
  },
  stack: {
    gap: spacing.sm,
  },
  loadingWrap: {
    padding: spacing['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  pickerButton: {
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  titleBlock: {
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
  },
  calendarBlock: {
    gap: 10,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerLayer: {
    zIndex: Z_INDEX.floating,
  },
  gridCard: {
    borderRadius: 24,
    padding: 12,
    overflow: 'hidden',
  },
  dialogBody: {
    gap: spacing.lg,
    alignItems: 'stretch',
  },
});
