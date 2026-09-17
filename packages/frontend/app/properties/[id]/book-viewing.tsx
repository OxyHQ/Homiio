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
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import { PropertyType, formatDate } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';
import { useOxy } from '@oxy.so/services';
import ViewingService, { type ViewingRequest } from '@/services/viewingService';
import { ApiError } from '@/utils/api';
import { toast } from '@oxy.so/bloom/toast';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '@/utils/logger';

type PropertyData = {
  id: string;
  title: string;
  location: string;
};

/** Viewings can be booked from tomorrow up to a week out. */
const BOOKABLE_DAYS = 7;

const TIME_SLOTS = [
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
];

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
          // Parse date and time from scheduledAt, adjusting for timezone
          const scheduledDate = new Date(viewing.scheduledAt);
          const dateStr = scheduledDate.toISOString().split('T')[0]; // YYYY-MM-DD
          // NOT a display string: this is the `HH:MM` key matched against the
          // time-slot list below, so it is deliberately locale-INDEPENDENT and
          // must not go through the locale-aware formatter.
          const timeStr = scheduledDate.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          setSelectedDate(dateStr);
          setSelectedTime(timeStr);
          setMessage(viewing.message || '');
        }
      } catch (error: unknown) {
        logger.error('Failed to load existing viewing:', error);
        toast.error(t('viewings.error.generic'));
      }
    };

    loadExistingViewing();
  }, [isModifyMode, modifyViewingIdString, oxyServices, activeSessionId, t]);

  const bookableRange = useMemo(() => {
    const min = new Date();
    min.setHours(0, 0, 0, 0);
    min.setDate(min.getDate() + 1);
    const max = new Date(min);
    max.setDate(max.getDate() + BOOKABLE_DAYS - 1);
    return { min, max };
  }, []);

  const selectedDateValue = useMemo(() => civilToLocalDate(selectedDate), [selectedDate]);

  const handleSubmit = async () => {
    if (!selectedDate || !selectedTime) {
      toast.error(t('viewings.validation.selectDateTime'));
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
        await ViewingService.update(
          modifyViewingIdString,
          { date: selectedDate, time: selectedTime, message: message?.trim() || undefined },
        );
        toast.success(t('viewings.success.modified'));
        // Invalidate both the viewing list and the specific viewing
        await queryClient.invalidateQueries({ queryKey: ['viewings', 'me'] });
      } else {
        await ViewingService.createViewingRequest(
          property.id,
          { date: selectedDate, time: selectedTime, message: message?.trim() || undefined },
        );
        toast.success(t('viewings.success.created'));
        // Invalidate the viewing list
        await queryClient.invalidateQueries({ queryKey: ['viewings', 'me'] });
      }
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
              {t('viewings.availableTimeSlots')}
              {selectedDate ? ` - ${formatDate(selectedDate, locale, 'UTC')}` : ''}
            </Text>

            <View style={styles.timeSlotsContainer} accessibilityRole="radiogroup">
              {TIME_SLOTS.map((time) => {
                const isSelected = selectedTime === time;
                return (
                  <Chip
                    key={time}
                    size="large"
                    selected={isSelected}
                    onPress={() => setSelectedTime(time)}
                    style={styles.timeSlot}
                    accessibilityLabel={time}
                  >
                    {time}
                  </Chip>
                );
              })}
            </View>
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
          disabled={!selectedDate || !selectedTime || submitting}
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
});
