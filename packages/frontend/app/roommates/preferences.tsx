/**
 * Roommate preferences — toggle matching and review preference summary.
 *
 * Stream Q polish:
 *   - Bloom Switch replaces RN Switch, Bloom Typography for every text,
 *     Bloom Button for navigation.
 *   - withShadow('sm') cards with radius.lg, no border-only separators.
 *   - Shared EmptyState component, SectionEyebrow for hierarchy.
 *   - No more "as any" Ionicons alias.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { Switch } from '@oxyhq/bloom/switch';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useProfile } from '@/context/ProfileContext';
import { roommateService } from '@/services/roommateService';
import { useProfileStore } from '@/store/profileStore';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

type Cleanliness = 'very_clean' | 'clean' | 'average' | 'relaxed';
type NoiseLevel = 'quiet' | 'moderate' | 'lively';
type StudyHabits = 'early_bird' | 'night_owl' | 'flexible';
type SocialLevel = 'introvert' | 'ambivert' | 'extrovert';

interface PreferencesState {
  maxRent: number;
  moveInDate: string;
  leaseLength: number;
  smoking: boolean;
  pets: boolean;
  cleanliness: Cleanliness;
  noiseLevel: NoiseLevel;
  studyHabits: StudyHabits;
  socialLevel: SocialLevel;
  interests: string[];
}

const INITIAL_PREFERENCES: PreferencesState = {
  maxRent: 1500,
  moveInDate: '2024-09-01',
  leaseLength: 12,
  smoking: false,
  pets: false,
  cleanliness: 'clean',
  noiseLevel: 'moderate',
  studyHabits: 'flexible',
  socialLevel: 'ambivert',
  interests: [],
};

interface PreferenceRowProps {
  title: string;
  value: string;
  onPress?: () => void;
}

const PreferenceRow: React.FC<PreferenceRowProps> = ({
  title,
  value,
  onPress,
}) => {
  const [pressed, setPressed] = useState(false);
  return (
  <Pressable
    onPress={onPress}
    disabled={!onPress}
    onPressIn={() => setPressed(true)}
    onPressOut={() => setPressed(false)}
    style={[
      styles.preferenceRow,
      pressed && onPress ? styles.preferenceRowPressed : null,
    ]}
    accessibilityRole={onPress ? 'button' : undefined}
  >
    <BloomText style={styles.preferenceTitle}>{title}</BloomText>
    <View style={styles.preferenceValueWrap}>
      <BloomText style={styles.preferenceValueText}>{value}</BloomText>
      {onPress ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.muted}
        />
      ) : null}
    </View>
  </Pressable>
  );
};

export default function RoommatePreferencesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [roommateEnabled, setRoommateEnabled] = useState(false);
  const [preferences, setPreferences] =
    useState<PreferencesState>(INITIAL_PREFERENCES);
  const { primaryProfile, isPersonalProfile, hasPersonalProfile } = useProfile();

  useEffect(() => {
    if (primaryProfile && isPersonalProfile) {
      const roommateSettings =
        primaryProfile.personalProfile?.settings?.roommate;
      if (roommateSettings) {
        setRoommateEnabled(Boolean(roommateSettings.enabled));
        if (roommateSettings.preferences) {
          setPreferences((prev) => ({
            ...prev,
            ...roommateSettings.preferences,
          }));
        }
      }
    }
  }, [primaryProfile, isPersonalProfile]);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const status = await roommateService.getMyRoommateStatus();
      if (cancelled) return;
      if (status && typeof status.hasRoommateMatching === 'boolean') {
        setRoommateEnabled(Boolean(status.hasRoommateMatching));
      }
    };
    sync();
    return () => {
      cancelled = true;
    };
  }, []);

  const preferencesQuery = useQuery({
    queryKey: ['roommates', 'preferences'],
    queryFn: async () => roommateService.getMyRoommatePreferences(),
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });

  useEffect(() => {
    if (preferencesQuery.data) {
      setPreferences((prev) => ({ ...prev, ...preferencesQuery.data }));
    }
  }, [preferencesQuery.data]);

  const toggleMutation = useMutation({
    mutationKey: ['roommates', 'toggle'],
    mutationFn: async (enabled: boolean) =>
      roommateService.toggleRoommateMatching(enabled),
    onMutate: async (enabled: boolean) => {
      const previous = roommateEnabled;
      setRoommateEnabled(enabled);
      return { previous };
    },
    onSuccess: async (data) => {
      await useProfileStore.getState().fetchPrimaryProfile();
      const storeEnabled = Boolean(
        useProfileStore.getState().primaryProfile?.personalProfile?.settings
          ?.roommate?.enabled,
      );
      const nextEnabled =
        typeof data?.enabled === 'boolean' ? data.enabled : storeEnabled;
      setRoommateEnabled(nextEnabled);
      Alert.alert(
        'Success',
        data?.message ||
          `Roommate matching ${nextEnabled ? 'enabled' : 'disabled'}`,
      );
    },
    onError: (_err, _enabled, context) => {
      if (context?.previous !== undefined) {
        setRoommateEnabled(context.previous);
      }
      Alert.alert('Error', 'Failed to update roommate matching settings');
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['roommates', 'preferences'],
      });
    },
  });

  const handleToggleRoommateMatching = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await toggleMutation.mutateAsync(enabled);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isPersonalProfile || !hasPersonalProfile) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            title: 'Roommate preferences',
            showBackButton: true,
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="person-outline"
              title="Personal profile required"
              description="Roommate preferences are only available for personal profiles. Please switch to your personal profile to manage your roommate settings."
              actionText="Switch to personal profile"
              actionIcon="person-circle"
              onAction={() => router.push('/profile')}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: 'Roommate preferences',
          showBackButton: true,
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>Sharing a place</SectionEyebrow>
            <H2 style={styles.title}>Roommate matching</H2>
            <BloomText style={styles.subtitle}>
              Let other Homiio users find you when their preferences and yours
              line up.
            </BloomText>
          </View>

          <View style={styles.card}>
            <View style={styles.toggleHeader}>
              <View style={styles.toggleHeaderText}>
                <BloomText style={styles.toggleTitle}>
                  Enable roommate matching
                </BloomText>
                <BloomText style={styles.toggleDescription}>
                  Allow other users to discover your profile for matching.
                </BloomText>
              </View>
              <Switch
                value={roommateEnabled}
                onValueChange={handleToggleRoommateMatching}
                disabled={isSaving || toggleMutation.isPending}
              />
            </View>
          </View>

          {roommateEnabled ? (
            <>
              <View style={styles.card}>
                <H3 style={styles.cardTitle}>Budget & timeline</H3>
                <PreferenceRow
                  title="Maximum rent"
                  value={`€${preferences.maxRent} / month`}
                />
                <PreferenceRow
                  title="Move-in date"
                  value={preferences.moveInDate}
                />
                <PreferenceRow
                  title="Lease length"
                  value={`${preferences.leaseLength} months`}
                />
              </View>

              <View style={styles.card}>
                <H3 style={styles.cardTitle}>Lifestyle</H3>
                <PreferenceRow
                  title="Smoking"
                  value={preferences.smoking ? 'Yes' : 'No'}
                />
                <PreferenceRow
                  title="Pets"
                  value={preferences.pets ? 'Yes' : 'No'}
                />
                <PreferenceRow
                  title="Cleanliness"
                  value={preferences.cleanliness}
                />
                <PreferenceRow
                  title="Noise level"
                  value={preferences.noiseLevel}
                />
                <PreferenceRow
                  title="Study habits"
                  value={preferences.studyHabits}
                />
                <PreferenceRow
                  title="Social level"
                  value={preferences.socialLevel}
                />
              </View>

              <View style={styles.card}>
                <H3 style={styles.cardTitle}>Interests</H3>
                <View style={styles.interestsWrap}>
                  {preferences.interests.length > 0 ? (
                    preferences.interests.map((interest) => (
                      <View key={interest} style={styles.interestTag}>
                        <BloomText style={styles.interestText}>
                          {interest}
                        </BloomText>
                      </View>
                    ))
                  ) : (
                    <BloomText style={styles.emptyHint}>
                      No interests added yet.
                    </BloomText>
                  )}
                </View>
              </View>

              <Button
                variant="primary"
                size="large"
                onPress={() => router.push('/profile/edit')}
                style={styles.editButton}
              >
                Edit profile
              </Button>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  titleBlock: {
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    ...withShadow('sm'),
  },
  cardTitle: {
    letterSpacing: -0.3,
    marginBottom: spacing.xs,
  },
  toggleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  toggleHeaderText: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  toggleDescription: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  preferenceRowPressed: {
    opacity: 0.6,
  },
  preferenceTitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  preferenceValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  preferenceValueText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  interestsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  interestTag: {
    backgroundColor: colors.infoSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  interestText: {
    fontSize: 12,
    color: colors.info,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 13,
    color: colors.muted,
  },
  editButton: {
    alignSelf: 'stretch',
  },
});
