import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
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
import viewingService from '@/services/viewingService';
import { ApiError } from '@/utils/api';
import { toast } from 'sonner';

type PropertyData = {
  id: string;
  title: string;
  location: string;
  landlordName: string;
  landlordRating: number;
};

export default function BookViewingPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { oxyServices, activeSessionId } = useOxy();
  const [property, setProperty] = useState<PropertyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const normalizedId = Array.isArray(id) ? id[0] : id;
  const {
    property: apiProperty,
    loading: apiLoading,
    error: apiError,
    loadProperty,
  } = useProperty(normalizedId || '');

  useEffect(() => {
    loadProperty();
  }, [id, loadProperty]);

  const extractErrorMessage = (err: unknown): string => {
    let fallback = t('viewings.error.generic');
    try {
      if (err instanceof ApiError) {
        const resp: any = err.response;
        const code = (resp?.error?.code || resp?.code || resp?.error) as string | undefined;
        let msg: string | undefined;
        if (typeof resp?.error?.message === 'string') msg = resp.error.message;
        else if (typeof resp?.message === 'string') msg = resp.message;
        else if (typeof resp?.data?.message === 'string') msg = resp.data.message;
        else if (typeof resp?.error === 'string') msg = resp.error;
        else if (typeof resp?.data?.error === 'string') msg = resp.data.error;
        else if (Array.isArray(resp?.details) && resp.details.length > 0) {
          const first = resp.details[0];
          if (typeof first?.message === 'string') msg = first.message;
        }
        if (code === 'ALREADY_REQUESTED') return t('viewings.error.alreadyRequested');
        if (code === 'TIME_CONFLICT') return t('viewings.error.timeConflict');
        if (code === 'TIME_IN_PAST') return t('viewings.error.timeInPast');
        if (code === 'AUTHENTICATION_REQUIRED') return t('viewings.error.authRequired');
        if (msg) return msg;
        if (err.message) return err.message;
      } else if (err && typeof err === 'object') {
        const anyErr: any = err as any;
        if (typeof anyErr.message === 'string') return anyErr.message;
        try {
          return JSON.stringify(anyErr);
        } catch { }
      } else if (typeof err === 'string') {
        return err;
      }
    } catch { }
    return fallback;
  };

  useEffect(() => {
    if (apiProperty) {
      // Map API property type to PropertyData type
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

      const propertyData: PropertyData = {
        id: apiProperty._id || apiProperty.id || '',
        title: generatedTitle,
        location: `${apiProperty.address?.city || ''}, ${apiProperty.address?.state || ''}`,
        landlordName: 'Property Owner',
        landlordRating: 4.8,
      };

      setProperty(propertyData);
      setLoading(false);
    }
  }, [apiProperty]);

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
      await viewingService.createViewingRequest(
        property.id,
        { date: selectedDate, time: selectedTime, message: message?.trim() || undefined },
        oxyServices,
        activeSessionId,
      );
      toast.success(t('viewings.success.created'));
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
      <SafeAreaView style={styles.safeArea} edges={['top']}>
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
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: t('properties.bookViewing'),
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
                <Ionicons name="star" size={14} color="#FFD700" />
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
                  <Ionicons name="checkmark-circle" size={18} color="white" />
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
          text={t('properties.bookViewing')}
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
    fontFamily: 'Phudu',
  },
  propertyCard: {
    backgroundColor: 'white',
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
    borderTopColor: '#f0f0f0',
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
    fontFamily: 'Phudu',
  },
  landlordDetails: {
    flex: 1,
  },
  landlordName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    marginBottom: 3,
    fontFamily: 'Phudu',
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
    fontFamily: 'Phudu',
  },
  datesContainer: {
    flexDirection: 'row',
  },
  dateCard: {
    width: 70,
    height: 90,
    backgroundColor: 'white',
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
    fontFamily: 'Phudu',
  },
  dateMonth: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  activeDateText: {
    color: 'white',
  },
  timeSlotsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  timeSlot: {
    minWidth: 100,
    backgroundColor: 'white',
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
    color: 'white',
    fontWeight: '600',
    fontFamily: 'Phudu',
  },
  notesInput: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    height: 100,
    textAlignVertical: 'top',
    fontSize: 14,
    color: colors.COLOR_BLACK,
    borderWidth: 1,
    borderColor: '#e0e0e0',
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
