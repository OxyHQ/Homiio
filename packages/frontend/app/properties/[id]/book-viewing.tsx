import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { useProperty } from '@/hooks';
import { ActionButton } from '@/components/ui/ActionButton';
import { PropertyType } from '@homiio/shared-types';
import { useOxy } from '@oxyhq/services';
import ViewingService, { type ViewingRequest } from '@/services/viewingService';
import { ApiError } from '@/utils/api';
import { toast } from '@/lib/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '@/utils/logger';

type PropertyData = {
  id: string;
  title: string;
  location: string;
  landlordName: string;
  landlordRating: number;
};

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
        if (code === 'EXTERNAL_PROPERTY') return t('viewings.error.externalProperty', 'Cannot book viewings for external properties');
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
      id: apiProperty._id || apiProperty.id || '',
      title: generatedTitle,
      location: `${apiProperty.address?.city || ''}, ${apiProperty.address?.state || ''}`,
      landlordName: 'Property Owner',
      landlordRating: 4.8,
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
        const viewing = viewings.find(v => v._id === modifyViewingIdString);

        if (viewing) {
          setExistingViewing(viewing);
          // Parse date and time from scheduledAt, adjusting for timezone
          const scheduledDate = new Date(viewing.scheduledAt);
          const dateStr = scheduledDate.toISOString().split('T')[0]; // YYYY-MM-DD
          const timeStr = scheduledDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }); // HH:MM in local time
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

  const timeSlots = [
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

  const availableDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i + 1);
    return date.toISOString().split('T')[0];
  });

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
            title: t('Loading...'),
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primaryColor} />
          <Text style={styles.loadingText}>{t('property.loading')}</Text>
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
          titlePosition: 'center',
        }}
      />

      <ScrollView style={styles.container}>
        <View style={styles.propertyCard}>
          <Text style={styles.propertyTitle}>{property.title}</Text>
          <Text style={styles.propertyLocation}>
            <Ionicons name="location-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />{' '}
            {property.location}
          </Text>

          <View style={styles.landlordInfo}>
            <View style={styles.landlordAvatar}>
              <Text style={styles.landlordAvatarText}>{property.landlordName.charAt(0)}</Text>
            </View>
            <View style={styles.landlordDetails}>
              <Text style={styles.landlordName}>{property.landlordName}</Text>
              <View style={styles.ratingContainer}>
                <Ionicons name="star" size={14} color={colors.ratingStar} />
                <Text style={styles.ratingText}>{property.landlordRating}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('viewings.selectDate')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.datesContainer}
          >
            {availableDates.map((date, index) => {
              const isActive = selectedDate === date;
              return (
                <TouchableOpacity
                  key={index}
                  style={[styles.dateCard, isActive && styles.activeDateCard]}
                  onPress={() => setSelectedDate(date)}
                >
                  <Text style={[styles.dateDay, isActive && styles.activeDateText]}>
                    {new Date(date).toLocaleDateString(undefined, { weekday: 'short' })}
                  </Text>
                  <Text style={[styles.dateNumber, isActive && styles.activeDateText]}>
                    {new Date(date).getDate()}
                  </Text>
                  <Text style={[styles.dateMonth, isActive && styles.activeDateText]}>
                    {new Date(date).toLocaleDateString(undefined, { month: 'short' })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('viewings.availableTimeSlots')} -{' '}
            {selectedDate && new Date(selectedDate).toLocaleDateString()}
          </Text>

          <View style={styles.timeSlotsContainer}>
            {timeSlots.map((time, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.timeSlot, selectedTime === time && styles.selectedSlot]}
                onPress={() => setSelectedTime(time)}
              >
                <Text
                  style={[styles.timeSlotText, selectedTime === time && styles.selectedSlotText]}
                >
                  {time}
                </Text>

                {selectedTime === time && (
                  <Ionicons name="checkmark-circle" size={18} color={colors.primaryForeground} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('viewings.additionalNotes')}</Text>
          <TextInput
            style={styles.notesInput}
            multiline
            numberOfLines={4}
            placeholder={t('viewings.notesPlaceholder')}
            placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
            value={message}
            onChangeText={setMessage}
          />
        </View>

        <View style={styles.policyContainer}>
          <Ionicons name="information-circle" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
          <Text style={styles.policyText}>
            {t('viewings.policy')}
          </Text>
        </View>

        <ActionButton
          icon="calendar-outline"
          text={isModifyMode ? t('viewings.actions.modify') : t('properties.bookViewing')}
          onPress={handleSubmit}
          variant="primary"
          size="large"
          disabled={!selectedDate || !selectedTime || submitting}
          loading={submitting}
          style={{ marginBottom: 30 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.COLOR_BACKGROUND,
  },
  container: {
    flex: 1,
    padding: 15,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  propertyCard: {
    backgroundColor: colors.white,
    borderRadius: 15,
    padding: 15,
    marginBottom: 20,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  propertyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 5,
  },
  propertyLocation: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 15,
  },
  landlordInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.COLOR_BLACK_LIGHT_6,
    paddingTop: 15,
  },
  landlordAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  landlordAvatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primaryColor,
  },
  landlordDetails: {
    flex: 1,
  },
  landlordName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    marginBottom: 3,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    marginLeft: 5,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 15,
  },
  datesContainer: {
    flexDirection: 'row',
  },
  dateCard: {
    width: 70,
    height: 90,
    backgroundColor: colors.white,
    borderRadius: 12,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  activeDateCard: {
    backgroundColor: colors.primaryColor,
  },
  dateDay: {
    fontSize: 12,
    color: colors.COLOR_BLACK,
    marginBottom: 5,
  },
  dateNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 5,
  },
  dateMonth: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  activeDateText: {
    color: colors.primaryForeground,
  },
  timeSlotsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  timeSlot: {
    minWidth: 100,
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  selectedSlot: {
    backgroundColor: colors.primaryColor,
  },
  timeSlotText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    marginRight: 5,
  },
  selectedSlotText: {
    color: colors.primaryForeground,
    fontWeight: '600',
  },
  notesInput: {
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    height: 100,
    textAlignVertical: 'top',
    fontSize: 14,
    color: colors.COLOR_BLACK,
    borderWidth: 1,
    borderColor: colors.border,
  },
  policyContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
  },
  policyText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
});
