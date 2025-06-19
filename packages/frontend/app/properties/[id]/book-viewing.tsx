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

type Property = {
  id: string;
  title: string;
  location: string;
  landlordName: string;
  landlordRating: number;
};

type TimeSlot = {
  id: string;
  date: string;
  time: string;
  isAvailable: boolean;
};

export default function BookViewingPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [property, setProperty] = useState<Property | null>(null);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const today = new Date();
  const nextWeekDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    return date;
  });

  useEffect(() => {
    // Simulate API call to fetch property and available time slots
    const fetchData = setTimeout(() => {
      // Mock property data
      const mockProperty: Property = {
        id: id as string,
        title: 'Spacious Apartment with Balcony',
        location: 'Barcelona, Spain',
        landlordName: 'Maria Garcia',
        landlordRating: 4.9,
      };
      
      setProperty(mockProperty);
      
      // Set active date to today
      setActiveDate(formatDate(nextWeekDates[0]));
      
      // Generate mock time slots for the next 7 days
      const mockTimeSlots: TimeSlot[] = [];
      
      nextWeekDates.forEach((date, dateIndex) => {
        // Generate 3-5 time slots per day
        const slotsCount = 3 + Math.floor(Math.random() * 3);
        const startHour = 9 + Math.floor(Math.random() * 2); // Start between 9-10 AM
        
        for (let i = 0; i < slotsCount; i++) {
          const hour = startHour + (i * 2); // 2-hour intervals
          if (hour >= 18) continue; // Don't go past 6 PM
          
          mockTimeSlots.push({
            id: `${formatDate(date)}-${hour}`,
            date: formatDate(date),
            time: `${hour}:00 - ${hour + 1}:00`,
            isAvailable: Math.random() > 0.3, // 70% of slots are available
          });
        }
      });
      
      setTimeSlots(mockTimeSlots);
      setLoading(false);
    }, 1000);
    
    return () => clearTimeout(fetchData);
  }, [id]);

  const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  const formatDisplayDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const getTimeSlotsByDate = (date: string): TimeSlot[] => {
    return timeSlots.filter(slot => slot.date === date);
  };

  const handleSelectSlot = (slotId: string) => {
    setSelectedSlot(selectedSlot === slotId ? null : slotId);
  };

  const handleSubmit = () => {
    if (!selectedSlot) {
      Alert.alert(t('Error'), t('Please select a time slot'));
      return;
    }
    
    setIsSubmitting(true);
    
    // Simulate API call
    setTimeout(() => {
      setIsSubmitting(false);
      
      // Show success message and navigate back
      if (Platform.OS === 'web') {
        alert(t('Viewing request submitted successfully!'));
      } else {
        Alert.alert(
          t('Success'),
          t('Your viewing request has been submitted. The landlord will confirm shortly.'),
          [{ text: t('OK'), onPress: () => router.back() }]
        );
      }
      
      router.back();
    }, 1500);
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
        {/* Property Summary */}
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

        {/* Calendar Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("Select Date")}</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            style={styles.datesContainer}
          >
            {nextWeekDates.map((date, index) => {
              const dateString = formatDate(date);
              const isActive = activeDate === dateString;
              return (
                <TouchableOpacity
                  key={index}
                  style={[styles.dateCard, isActive && styles.activeDateCard]}
                  onPress={() => setActiveDate(dateString)}
                >
                  <Text style={[styles.dateDay, isActive && styles.activeDateText]}>
                    {date.toLocaleDateString(undefined, { weekday: 'short' })}
                  </Text>
                  <Text style={[styles.dateNumber, isActive && styles.activeDateText]}>
                    {date.getDate()}
                  </Text>
                  <Text style={[styles.dateMonth, isActive && styles.activeDateText]}>
                    {date.toLocaleDateString(undefined, { month: 'short' })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Time Slots Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("Available Time Slots")} - {activeDate && formatDisplayDate(activeDate)}
          </Text>
          
          <View style={styles.timeSlotsContainer}>
            {activeDate && getTimeSlotsByDate(activeDate).length > 0 ? (
              getTimeSlotsByDate(activeDate).map((slot) => (
                <TouchableOpacity
                  key={slot.id}
                  style={[
                    styles.timeSlot,
                    !slot.isAvailable && styles.disabledSlot,
                    selectedSlot === slot.id && styles.selectedSlot,
                  ]}
                  onPress={() => slot.isAvailable && handleSelectSlot(slot.id)}
                  disabled={!slot.isAvailable}
                >
                  <Text
                    style={[
                      styles.timeSlotText,
                      !slot.isAvailable && styles.disabledSlotText,
                      selectedSlot === slot.id && styles.selectedSlotText,
                    ]}
                  >
                    {slot.time}
                  </Text>
                  
                  {selectedSlot === slot.id && (
                    <Ionicons name="checkmark-circle" size={18} color="white" />
                  )}
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.noSlotsText}>
                {t("No time slots available for this date")}
              </Text>
            )}
          </View>
        </View>

        {/* Additional Notes Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("Additional Notes")}</Text>
          <TextInput
            style={styles.notesInput}
            multiline
            numberOfLines={4}
            placeholder={t("Any questions for the landlord? (optional)")}
            placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
            value={note}
            onChangeText={setNote}
          />
        </View>
        
        {/* Viewing Policy */}
        <View style={styles.policyContainer}>
          <Ionicons name="information-circle" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
          <Text style={styles.policyText}>
            {t("Please be on time for your appointment. If you need to cancel, please do so at least 2 hours in advance.")}
          </Text>
        </View>

        {/* Submit Button */}
        <TouchableOpacity 
          style={[styles.submitButton, !selectedSlot && styles.disabledButton]}
          onPress={handleSubmit}
          disabled={!selectedSlot || isSubmitting}
        >
          {isSubmitting ? (
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
  disabledSlot: {
    backgroundColor: '#f5f5f5',
  },
  selectedSlot: {
    backgroundColor: colors.primaryColor,
  },
  timeSlotText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    marginRight: 5,
  },
  disabledSlotText: {
    color: colors.COLOR_BLACK_LIGHT_3,
    textDecorationLine: 'line-through',
  },
  selectedSlotText: {
    color: 'white',
    fontWeight: '600',
  },
  noSlotsText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    width: '100%',
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