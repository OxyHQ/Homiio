/**
 * Ask to see a home — at a time the OWNER said they could (#518 §7.5).
 *
 * ## What this screen used to be
 *
 * Thirteen hardcoded half-hour labels, 09:00 to 17:00, offered on every listing
 * on earth for the next seven days. Nobody had said any of them were possible.
 * A visitor picked one, the request went in, and the first person to find out
 * whether the owner could actually make it was the owner.
 *
 * ## What it is now
 *
 * The slots come from `GET /api/properties/:id/viewing-availability`, which is
 * public, so they are there before anybody signs in. They are expressed in the
 * PROPERTY's timezone and the screen SAYS which one — an unqualified "10:00"
 * means three different moments to three readers, and this domain already had
 * that bug in both directions.
 *
 * ## And when the owner has published nothing
 *
 * The screen does not invent slots; it says so and lets the visitor PROPOSE a
 * time instead. That is a different thing from picking one, and it is labelled
 * as one. The server keeps that path open for exactly the same reason (see
 * `controllers/viewingAvailabilityController.ts`): refusing every request on
 * every listing nobody had configured yet would take a working feature away
 * from the whole catalogue to enforce a rule nobody had had the chance to
 * state.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { useProperty } from '@/hooks';
import { Button } from '@oxy.so/bloom/button';
import { Admonition } from '@oxy.so/bloom/admonition';
import { Card, CardDescription, CardHeader, CardTitle } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { Calendar } from '@oxy.so/bloom/date-picker';
import { RiCalendarLine, RiMapPinLine } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { Textarea } from '@oxy.so/bloom/textarea';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import {
  PropertyType,
  VIEWING_HORIZON_DEFAULT_DAYS,
  VIEWING_MODALITIES,
  formatDate,
  instantToZonedCivil,
  parseMinuteOfDay,
  type ViewingModality,
  type ViewingSlot,
} from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';
import { useOxy } from '@oxy.so/services';
import ViewingService, { type ViewingRequest } from '@/services/viewingService';
import { ApiError } from '@/utils/api';
import { toast } from '@oxy.so/bloom/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/utils/logger';

type PropertyData = {
  id: string;
  title: string;
  location: string;
};

/**
 * How far out a visitor may PROPOSE a time on a listing with no schedule.
 *
 * Only the free-form path uses it. When the owner has published windows the
 * bookable range is whatever their slots cover, which is a fact rather than a
 * number chosen here.
 */
const PROPOSABLE_DAYS = 14;

/** A civil `YYYY-MM-DD` key as a local-midnight `Date` for the calendar. */
function civilToLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** A calendar day (local midnight) as the civil `YYYY-MM-DD` key the API takes. */
function localDateToCivil(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Loosely-typed shape of an API error payload as surfaced on `ApiError.response`. */
interface ApiErrorResponse {
  code?: string;
  message?: string;
  error?: string | { code?: string; message?: string };
  data?: { message?: string; error?: string };
  details?: { message?: string }[];
}

export default function BookViewingPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale } = useFormatting();
  const router = useRouter();
  const { id, modifyViewingId } = useLocalSearchParams();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [modality, setModality] = useState<ViewingModality>('in_person');
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [_existingViewing, setExistingViewing] = useState<ViewingRequest | null>(null);

  // Check if we're in modify mode
  const isModifyMode = Boolean(modifyViewingId);
  const modifyViewingIdString = Array.isArray(modifyViewingId) ? modifyViewingId[0] : modifyViewingId;

  const normalizedId = Array.isArray(id) ? id[0] : id;
  const {
    property: apiProperty,
    loading,
    loadProperty,
  } = useProperty(normalizedId || '');

  useEffect(() => {
    loadProperty();
  }, [id, loadProperty]);

  /**
   * The owner's real availability.
   *
   * Public, so it loads for a signed-out visitor too — and it is the ONLY
   * source of times on this screen. `staleTime` is short because a slot
   * somebody else takes must stop being offered here.
   */
  const availabilityQuery = useQuery({
    queryKey: ['viewings', 'availability', normalizedId],
    queryFn: async () => {
      const response = await ViewingService.getAvailability(normalizedId as string, {
        days: VIEWING_HORIZON_DEFAULT_DAYS,
      });
      return response.data;
    },
    enabled: Boolean(normalizedId),
    staleTime: 30_000,
  });

  const availability = availabilityQuery.data;
  const published = availability?.published ?? false;
  const timeZone = availability?.timeZone ?? null;

  /** Slots for the modality the visitor is asking for, grouped by civil day. */
  const slotsByDate = useMemo(() => {
    const grouped = new Map<string, ViewingSlot[]>();
    for (const slot of availability?.slots ?? []) {
      if (slot.modality !== modality) continue;
      const list = grouped.get(slot.date);
      if (list) list.push(slot);
      else grouped.set(slot.date, [slot]);
    }
    return grouped;
  }, [availability, modality]);

  /** Which modalities the owner actually offers. Not a fixed pair of chips. */
  const offeredModalities = useMemo(() => {
    const offered = new Set((availability?.windows ?? []).map((window) => window.modality));
    return VIEWING_MODALITIES.filter((value) => offered.has(value));
  }, [availability]);

  const daySlots = slotsByDate.get(selectedDate) ?? [];

  const extractErrorMessage = (err: unknown): string => {
    const fallback = t('viewings.error.generic');
    try {
      if (err instanceof ApiError) {
        const resp = (err.response ?? undefined) as ApiErrorResponse | undefined;
        const errorObject =
          resp?.error && typeof resp.error === 'object' ? resp.error : undefined;
        const errorString = typeof resp?.error === 'string' ? resp.error : undefined;
        const code = errorObject?.code || resp?.code || errorString;
        let msg: string | undefined;
        if (typeof errorObject?.message === 'string') msg = errorObject.message;
        else if (typeof resp?.message === 'string') msg = resp.message;
        else if (typeof resp?.data?.message === 'string') msg = resp.data.message;
        else if (errorString) msg = errorString;
        else if (typeof resp?.data?.error === 'string') msg = resp.data.error;
        else if (Array.isArray(resp?.details) && resp.details.length > 0) {
          const first = resp.details[0];
          if (typeof first?.message === 'string') msg = first.message;
        }
        if (code === 'ALREADY_REQUESTED') return t('viewings.error.alreadyRequested');
        if (code === 'TIME_CONFLICT') return t('viewings.error.timeConflict');
        if (code === 'TIME_IN_PAST') return t('viewings.error.timeInPast');
        if (code === 'AUTHENTICATION_REQUIRED') return t('viewings.error.authRequired');
        if (code === 'EXTERNAL_PROPERTY') return t('viewings.error.externalProperty');
        if (code === 'SLOT_NOT_OFFERED') return t('viewings.error.slotNotOffered');
        if (code === 'INVALID_DATETIME') return t('viewings.error.invalidDateTime');
        if (msg) return msg;
        if (err.message) return err.message;
      } else if (err instanceof Error) {
        return err.message;
      } else if (err && typeof err === 'object') {
        try {
          return JSON.stringify(err);
        } catch (stringifyError: unknown) {
          logger.error('Failed to stringify viewing error:', stringifyError);
        }
      } else if (typeof err === 'string') {
        return err;
      }
    } catch (parseError: unknown) {
      logger.error('Failed to parse viewing error:', parseError);
    }
    return fallback;
  };

  // Derive the view model from the fetched property instead of syncing it in an
  // effect (which caused cascading renders). `loading` comes from the query.
  const property = useMemo<PropertyData | null>(() => {
    if (!apiProperty) return null;

    const mapPropertyType = (type: string): PropertyType | undefined => {
      switch (type) {
        case 'apartment':
          return PropertyType.APARTMENT;
        case 'house':
          return PropertyType.HOUSE;
        case 'room':
          return PropertyType.ROOM;
        case 'studio':
          return PropertyType.STUDIO;
        default:
          return PropertyType.APARTMENT; // Default fallback
      }
    };

    const generatedTitle = generatePropertyTitle({
      type: mapPropertyType(apiProperty.type),
      address: apiProperty.address,
      bedrooms: apiProperty.bedrooms,
      bathrooms: apiProperty.bathrooms,
    });

    return {
      id: apiProperty.id || '',
      title: generatedTitle,
      location: [apiProperty.address?.cityName, apiProperty.address?.regionName]
        .filter(Boolean)
        .join(', '),
    };
  }, [apiProperty]);

  // Load existing viewing data if in modify mode
  useEffect(() => {
    const loadExistingViewing = async () => {
      if (!isModifyMode || !modifyViewingIdString || !oxyServices || !activeSessionId) {
        return;
      }

      try {
        // Get user's viewing requests and find the one we're modifying
        const response = await ViewingService.listMyViewingRequests(
          { page: 1, limit: 50 },
        );

        const viewings = Array.isArray(response?.data) ? response.data : [];
        const viewing = viewings.find(v => v.id === modifyViewingIdString);

        if (viewing) {
          setExistingViewing(viewing);
          // The civil day and clock time the SERVER derived, in the property's
          // zone. This used to be computed here with `toLocaleTimeString` in
          // the DEVICE's zone, which prefilled the form with a time the server
          // would then read as a different moment — and the two only agreed for
          // somebody who happened to be in the same zone as the flat.
          const zone = viewing.timeZone;
          const civil =
            viewing.date && viewing.time
              ? { date: viewing.date, time: viewing.time }
              : zone
                ? instantToZonedCivil(new Date(viewing.scheduledAt), zone)
                : null;
          if (civil) {
            setSelectedDate(civil.date);
            setSelectedTime(civil.time);
          }
          setModality(viewing.modality ?? 'in_person');
          setMessage(viewing.message || '');
        }
      } catch (error: unknown) {
        logger.error('Failed to load existing viewing:', error);
        toast.error(t('viewings.error.generic'));
      }
    };

    loadExistingViewing();
  }, [isModifyMode, modifyViewingIdString, oxyServices, activeSessionId, t]);

  /**
   * Which days the calendar will let somebody land on.
   *
   * With a published schedule it is the range the owner's OWN slots cover —
   * measured, not a constant. Without one it is the proposal horizon, and the
   * screen says that is what it is.
   */
  const bookableRange = useMemo(() => {
    const dates = [...slotsByDate.keys()].sort();
    if (published && dates.length > 0) {
      return {
        min: civilToLocalDate(dates[0]) as Date,
        max: civilToLocalDate(dates[dates.length - 1]) as Date,
      };
    }
    const min = new Date();
    min.setHours(0, 0, 0, 0);
    min.setDate(min.getDate() + 1);
    const max = new Date(min);
    max.setDate(max.getDate() + PROPOSABLE_DAYS - 1);
    return { min, max };
  }, [published, slotsByDate]);

  const selectedDateValue = useMemo(() => civilToLocalDate(selectedDate), [selectedDate]);

  /**
   * The time actually on the form.
   *
   * Switching day or modality can WITHDRAW what was picked — the owner may
   * offer 17:00 in person and not on video, and somebody else may take a slot
   * between two refetches. Deriving it, rather than clearing the state in an
   * effect, means there is never a render in which the form is holding a time
   * that is not on the list: the submit button is disabled by the same value
   * that draws the chips.
   */
  const activeTime =
    published && selectedTime && !daySlots.some((slot) => slot.time === selectedTime)
      ? ''
      : selectedTime;

  const handleSubmit = async () => {
    if (!selectedDate || !activeTime) {
      toast.error(t('viewings.validation.selectDateTime'));
      return;
    }
    if (!published && parseMinuteOfDay(activeTime) === null) {
      toast.error(t('viewings.validation.timeFormat'));
      return;
    }

    if (!oxyServices || !activeSessionId) {
      toast.error(t('viewings.error.authRequired'));
      return;
    }

    if (!property?.id) {
      toast.error(t('viewings.validation.invalidProperty'));
      return;
    }

    setSubmitting(true);

    try {
      if (isModifyMode && modifyViewingIdString) {
        // Update the existing viewing request
        await ViewingService.update(modifyViewingIdString, {
          date: selectedDate,
          time: activeTime,
          modality,
          message: message?.trim() || undefined,
        });
        toast.success(t('viewings.success.modified'));
        // Invalidate both the viewing list and the specific viewing
        await queryClient.invalidateQueries({ queryKey: ['viewings', 'me'] });
      } else {
        await ViewingService.createViewingRequest(property.id, {
          date: selectedDate,
          time: activeTime,
          modality,
          message: message?.trim() || undefined,
        });
        toast.success(t('viewings.success.created'));
        // Invalidate the viewing list
        await queryClient.invalidateQueries({ queryKey: ['viewings', 'me'] });
      }
      // The slot this request just took must stop being offered here.
      await queryClient.invalidateQueries({
        queryKey: ['viewings', 'availability', property.id],
      });
      router.back();
    } catch (error) {
      const msg = extractErrorMessage(error);
      // If backend returned a raw string, show it; else fallback to translated generic
      toast.error(typeof msg === 'string' ? msg : t('viewings.error.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !property) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Header
          options={{
            showBackButton: true,
            title: t('app.loading'),
          }}
        />
        <View style={styles.loadingContainer}>
          <Loading variant="spinner" size="large" text={t('property.loading')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Header
        options={{
          showBackButton: true,
          title: isModifyMode ? t('viewings.actions.modify') : t('properties.bookViewing'),
        }}
      />

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Card variant="outlined" radius="radius-16">
          <CardHeader>
            <CardTitle>{property.title}</CardTitle>
            {property.location ? (
              <View style={styles.locationRow}>
                <RiMapPinLine width={14} height={14} fill={theme.colors.textSecondary} />
                <CardDescription>{property.location}</CardDescription>
              </View>
            ) : null}
          </CardHeader>
        </Card>

        {availabilityQuery.isLoading ? (
          <Loading variant="spinner" size="small" text={t('viewings.loadingSlots')} />
        ) : null}

        {/*
          Which clock these times are on. Never omitted: an unqualified "10:00"
          is the bug this whole change exists to fix, and when nobody has told
          Homiio which zone the home is in, saying THAT is the honest answer
          rather than printing a number and hoping.
        */}
        {timeZone ? (
          <Admonition type={availability?.timeZoneSource === 'fallback' ? 'warning' : 'info'}>
            {availability?.timeZoneSource === 'fallback'
              ? t('viewings.timezoneUnknown', { zone: timeZone })
              : t('viewings.timezoneNotice', { zone: timeZone })}
          </Admonition>
        ) : null}

        {!availabilityQuery.isLoading && !published ? (
          // No invented slots. The owner has not published times, so this says
          // so and offers a PROPOSAL instead of a choice.
          <Admonition type="info">{t('viewings.noPublishedSlots')}</Admonition>
        ) : null}

        {offeredModalities.length > 1 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('viewings.modality.title')}</Text>
            <View style={styles.timeSlotsContainer} accessibilityRole="radiogroup">
              {offeredModalities.map((value) => (
                <Chip
                  key={value}
                  size="large"
                  selected={modality === value}
                  onPress={() => setModality(value)}
                  accessibilityLabel={t(`viewings.modality.${value}`)}
                >
                  {t(`viewings.modality.${value}`)}
                </Chip>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.schedule}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('viewings.selectDate')}</Text>
            <Calendar
              value={selectedDateValue}
              onChange={(date) => setSelectedDate(localDateToCivil(date))}
              minDate={bookableRange.min}
              maxDate={bookableRange.max}
              defaultMonth={selectedDateValue ?? bookableRange.min}
              weekStartsOn={1}
              locale={locale}
              accessibilityLabel={t('viewings.selectDate')}
            />
          </View>

          <View style={[styles.section, styles.slotsSection]}>
            <Text style={styles.sectionTitle}>
              {published ? t('viewings.availableTimeSlots') : t('viewings.proposeTime')}
              {selectedDate ? ` - ${formatDate(selectedDate, locale, 'UTC')}` : ''}
            </Text>

            {published ? (
              daySlots.length > 0 ? (
                <View style={styles.timeSlotsContainer} accessibilityRole="radiogroup">
                  {daySlots.map((slot) => (
                    <Chip
                      key={slot.startsAt}
                      size="large"
                      selected={activeTime === slot.time}
                      onPress={() => setSelectedTime(slot.time)}
                      style={styles.timeSlot}
                      accessibilityLabel={t('viewings.slotLabel', {
                        time: slot.time,
                        minutes: slot.durationMinutes,
                      })}
                    >
                      {slot.time}
                    </Chip>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyDay}>
                  {selectedDate ? t('viewings.noSlotsThatDay') : t('viewings.pickADay')}
                </Text>
              )
            ) : (
              // A free-text clock time, because the visitor is PROPOSING one.
              // Deliberately not a list: a list here would be thirteen numbers
              // nobody chose, which is what this screen used to draw.
              <TextFieldInput
                label={t('viewings.proposeTime')}
                value={activeTime}
                onChangeText={setSelectedTime}
                placeholder="17:30"
                maxLength={5}
                keyboardType="numbers-and-punctuation"
              />
            )}
          </View>
        </View>

        <Textarea
          label={t('viewings.additionalNotes')}
          rows={4}
          autoResize
          maxRows={10}
          placeholder={t('viewings.notesPlaceholder')}
          value={message}
          onChangeText={setMessage}
        />

        <Admonition type="info">{t('viewings.policy')}</Admonition>

        <Button
          leadingIcon={RiCalendarLine}
          onPress={handleSubmit}
          variant="primary"
          size="large"
          disabled={!selectedDate || !activeTime || submitting}
          loading={submitting}
        >
          {isModifyMode ? t('viewings.actions.modify') : t('properties.bookViewing')}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
    padding: 16,
    paddingBottom: 32,
    gap: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  schedule: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  section: {
    gap: 12,
  },
  slotsSection: {
    flex: 1,
    minWidth: 280,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  timeSlotsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeSlot: {
    minWidth: 88,
    justifyContent: 'center',
  },
  emptyDay: {
    opacity: 0.7,
  },
});
