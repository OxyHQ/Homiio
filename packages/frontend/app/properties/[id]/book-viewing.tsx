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
  Platform
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { useProperty } from '@/hooks';
import { Property } from '@/services/propertyService';

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
  const [property, setProperty] = useState<PropertyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const { property: apiProperty, loading: apiLoading, error: apiError, loadProperty } = useProperty(id);

  useEffect(() => {
    loadProperty();
  }, [id, loadProperty]);

  useEffect(() => {
    if (apiProperty) {
      const generatedTitle = generatePropertyTitle({
        type: apiProperty.type,
        address: apiProperty.address,
        bedrooms: apiProperty.bedrooms,
        bathrooms: apiProperty.bathrooms
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
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00'
  ];

  const availableDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i + 1);
    return date.toISOString().split('T')[0];
  });

  const handleSubmit = async () => {
    if (!selectedDate || !selectedTime) {
      Alert.alert(t('Error'), t('Please select a date and time'));
      return;
    }

    setSubmitting(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 2000));

      Alert.alert(
        t('Success'),
        t('Viewing request submitted successfully! We will contact you soon.'),
        [
          {
            text: t('OK'),
            onPress: () => router.back()
          }
        ]
      );
    } catch (error) {
      Alert.alert(t('Error'), t('Failed to submit viewing request. Please try again.'));
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
            title: t("Loading..."),
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primaryColor} />
          <Text style={styles.loadingText}>{t("Loading property details...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: t("Schedule Viewing"),
          titlePosition: 'center',
        }}
      />

      <ScrollView style={styles.container}>
        <View style={styles.propertyCard}>
          <Text style={styles.propertyTitle}>{property.title}</Text>
          <Text style={styles.propertyLocation}>
            <Ionicons name="location-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} /> {property.location}
          </Text>

          <View style={styles.landlordInfo}>
            <View style={styles.landlordAvatar}>
              <Text style={styles.landlordAvatarText}>
                {property.landlordName.charAt(0)}
              </Text>
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
          <Text style={styles.sectionTitle}>{t("Select Date")}</Text>
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
            {t("Available Time Slots")} - {selectedDate && new Date(selectedDate).toLocaleDateString()}
          </Text>

          <View style={styles.timeSlotsContainer}>
            {timeSlots.map((time, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.timeSlot,
                  selectedTime === time && styles.selectedSlot,
                ]}
                onPress={() => setSelectedTime(time)}
              >
                <Text
                  style={[
                    styles.timeSlotText,
                    selectedTime === time && styles.selectedSlotText,
                  ]}
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
          <Text style={styles.sectionTitle}>{t("Additional Notes")}</Text>
          <TextInput
            style={styles.notesInput}
            multiline
            numberOfLines={4}
            placeholder={t("Any questions for the landlord? (optional)")}
            placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
            value={message}
            onChangeText={setMessage}
          />
        </View>

        <View style={styles.policyContainer}>
          <Ionicons name="information-circle" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
          <Text style={styles.policyText}>
            {t("Please be on time for your appointment. If you need to cancel, please do so at least 2 hours in advance.")}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.submitButton, !selectedDate || !selectedTime && styles.disabledButton]}
          onPress={handleSubmit}
          disabled={!selectedDate || !selectedTime || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={styles.submitButtonText}>{t("Request Viewing")}</Text>
          )}
        </TouchableOpacity>
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
  submitButton: {
    backgroundColor: colors.primaryColor,
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  disabledButton: {
    backgroundColor: '#cccccc',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});