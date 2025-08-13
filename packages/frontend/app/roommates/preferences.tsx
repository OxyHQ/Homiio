import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { useProfile } from '@/context/ProfileContext';
import { useOxy } from '@oxyhq/services';
import { roommateService } from '@/services/roommateService';
import { useProfileStore } from '@/store/profileStore';
import Button from '@/components/Button';
import { EmptyState } from '@/components/ui/EmptyState';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

export default function RoommatePreferencesPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [roommateEnabled, setRoommateEnabled] = useState(false);
  const [preferences, setPreferences] = useState({
    maxRent: 1500,
    moveInDate: '2024-09-01',
    leaseLength: 12,
    smoking: false,
    pets: false,
    cleanliness: 'clean' as 'very_clean' | 'clean' | 'average' | 'relaxed',
    noiseLevel: 'moderate' as 'quiet' | 'moderate' | 'lively',
    studyHabits: 'flexible' as 'early_bird' | 'night_owl' | 'flexible',
    socialLevel: 'ambivert' as 'introvert' | 'ambivert' | 'extrovert',
    interests: [] as string[],
  });

  const { primaryProfile, isPersonalProfile, hasPersonalProfile } = useProfile();

  useEffect(() => {
    if (primaryProfile && isPersonalProfile) {
      const roommateSettings = primaryProfile.personalProfile?.settings?.roommate;
      if (roommateSettings) {
        setRoommateEnabled(roommateSettings.enabled || false);
        if (roommateSettings.preferences) {
          setPreferences((prev) => ({
            ...prev,
            ...roommateSettings.preferences,
          }));
        }
      }
    }
  }, [primaryProfile, isPersonalProfile]);

  const { oxyServices, activeSessionId } = useOxy();

  const handleToggleRoommateMatching = async (enabled: boolean) => {
    if (!oxyServices || !activeSessionId) return;

    setIsSaving(true);
    try {
      await roommateService.toggleRoommateMatching(enabled, oxyServices, activeSessionId);
      setRoommateEnabled(enabled);
      await useProfileStore.getState().fetchPrimaryProfile(oxyServices, activeSessionId);
      Alert.alert('Success', `Roommate matching ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error: any) {
      console.error('Error toggling roommate matching:', error);
      Alert.alert('Error', 'Failed to update roommate matching settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePreferences = async () => {
    if (!oxyServices || !activeSessionId) return;

    setIsSaving(true);
    try {
      const preferencesWithEnabled = {
        ...preferences,
        enabled: roommateEnabled,
      };
      await roommateService.updateRoommatePreferences(
        preferencesWithEnabled,
        oxyServices,
        activeSessionId,
      );
      await useProfileStore.getState().fetchPrimaryProfile(oxyServices, activeSessionId);
      Alert.alert('Success', 'Preferences saved successfully');
    } catch (error: any) {
      console.error('Error saving preferences:', error);
      Alert.alert('Error', 'Failed to save preferences');
    } finally {
      setIsSaving(false);
    }
  };

  const renderPreferenceItem = (title: string, value: any, onPress?: () => void) => (
    <TouchableOpacity style={styles.preferenceItem} onPress={onPress} disabled={!onPress}>
      <Text style={styles.preferenceTitle}>{title}</Text>
      <View style={styles.preferenceValue}>
        <Text style={styles.preferenceValueText}>{String(value)}</Text>
        {onPress && <IconComponent name="chevron-forward" size={20} color={colors.primaryDark_1} />}
      </View>
    </TouchableOpacity>
  );

  // Check if user is on a personal profile
  if (!isPersonalProfile || !hasPersonalProfile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <IconComponent name="arrow-back" size={24} color={colors.primaryDark} />
          </TouchableOpacity>
          <Text style={styles.title}>Roommate Preferences</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.emptyStateContainer}>
          <EmptyState
            icon="person-outline"
            title="Personal Profile Required"
            description="Roommate preferences are only available for personal profiles. Please switch to your personal profile to manage your roommate settings."
            actionText="Switch to Personal Profile"
            actionIcon="person-circle"
            onAction={() => router.push('/profile')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <IconComponent name="arrow-back" size={24} color={colors.primaryDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Roommate Preferences</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Roommate Matching Toggle */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Roommate Matching</Text>
          <View style={styles.toggleContainer}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Enable Roommate Matching</Text>
              <Text style={styles.toggleDescription}>
                Allow other users to discover your profile for roommate matching
              </Text>
            </View>
            <Switch
              value={roommateEnabled}
              onValueChange={handleToggleRoommateMatching}
              trackColor={{ false: colors.COLOR_BLACK_LIGHT_6, true: colors.primaryColor }}
              thumbColor={colors.primaryLight}
              disabled={isSaving}
            />
          </View>
        </View>

        {roommateEnabled && (
          <>
            {/* Budget Preferences */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Budget & Timeline</Text>
              {renderPreferenceItem('Maximum Rent', `$${preferences.maxRent}/month`)}
              {renderPreferenceItem('Move-in Date', preferences.moveInDate)}
              {renderPreferenceItem('Lease Length', `${preferences.leaseLength} months`)}
            </View>

            {/* Lifestyle Preferences */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Lifestyle</Text>
              {renderPreferenceItem('Smoking', preferences.smoking ? 'Yes' : 'No')}
              {renderPreferenceItem('Pets', preferences.pets ? 'Yes' : 'No')}
              {renderPreferenceItem('Cleanliness', preferences.cleanliness)}
              {renderPreferenceItem('Noise Level', preferences.noiseLevel)}
              {renderPreferenceItem('Study Habits', preferences.studyHabits)}
              {renderPreferenceItem('Social Level', preferences.socialLevel)}
            </View>

            {/* Interests */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Interests</Text>
              <View style={styles.interestsContainer}>
                {preferences.interests.length > 0 ? (
                  preferences.interests.map((interest, index) => (
                    <View key={index} style={styles.interestTag}>
                      <Text style={styles.interestText}>{interest}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noInterestsText}>No interests added yet</Text>
                )}
              </View>
            </View>

            {/* Save Button */}
            <View style={styles.saveSection}>
              <Button onPress={handleSavePreferences} disabled={isSaving} style={styles.saveButton}>
                {isSaving ? 'Saving...' : 'Save Preferences'}
              </Button>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  emptyStateContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 32,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 16,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.primaryDark,
    marginBottom: 4,
  },
  toggleDescription: {
    fontSize: 14,
    color: colors.primaryDark_1,
    lineHeight: 20,
  },
  preferenceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  preferenceTitle: {
    fontSize: 16,
    color: colors.primaryDark,
  },
  preferenceValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  preferenceValueText: {
    fontSize: 16,
    color: colors.primaryDark_1,
    marginRight: 8,
  },
  interestsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  interestTag: {
    backgroundColor: colors.primaryLight_2,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  interestText: {
    fontSize: 14,
    color: colors.primaryColor,
    fontWeight: '500',
  },
  noInterestsText: {
    fontSize: 14,
    color: colors.primaryDark_1,
    fontStyle: 'italic',
  },
  saveSection: {
    marginTop: 32,
    marginBottom: 32,
  },
  saveButton: {
    width: '100%',
  },
});
