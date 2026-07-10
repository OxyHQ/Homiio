import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';
import { useTrustScore } from '@/hooks/useTrustScore';
import { useActiveProfile } from '@/hooks/useProfileQueries';
import { TrustScore } from './TrustScore';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const TRUST_FACTOR_TYPES = [
  'verification',
  'reviews',
  'payment_history',
  'communication',
  'rental_history',
] as const;

type TrustFactorType = (typeof TRUST_FACTOR_TYPES)[number];

function isTrustFactorType(value: string): value is TrustFactorType {
  return (TRUST_FACTOR_TYPES as readonly string[]).includes(value);
}

const PROFILE_SECTIONS: Record<TrustFactorType, string> = {
  verification: 'personal',
  reviews: 'references',
  payment_history: 'rental-history',
  communication: 'personal',
  rental_history: 'rental-history',
};

export function TrustScoreManager() {
  const { t } = useTranslation();
  const { data: activeProfile } = useActiveProfile();
  const currentProfileId = activeProfile?.id || activeProfile?._id;
  const router = useRouter();

  const {
    trustScoreData,
    loading: isLoading,
    error,
    setCurrentProfileId,
    fetchTrustScoreData,
  } = useTrustScore(currentProfileId);

  useEffect(() => {
    if (currentProfileId) {
      setCurrentProfileId(currentProfileId);
      fetchTrustScoreData(currentProfileId);
    }
  }, [currentProfileId, setCurrentProfileId, fetchTrustScoreData]);

  const factorLabel = (factorType: string) =>
    isTrustFactorType(factorType)
      ? t(`trust.manager.factors.${factorType}.label`)
      : factorType;

  const factorDescription = (factorType: string) =>
    isTrustFactorType(factorType)
      ? t(`trust.manager.factors.${factorType}.description`)
      : t('trust.manager.factors.default.description');

  const factorActionText = (factorType: string) =>
    isTrustFactorType(factorType)
      ? t(`trust.manager.factors.${factorType}.action`)
      : t('trust.manager.factors.default.action');

  const getProfileSection = (factorType: string) =>
    isTrustFactorType(factorType) ? PROFILE_SECTIONS[factorType] : 'personal';

  const handleEditProfile = (section?: string) => {
    if (section) {
      router.push(`/profile/edit?section=${section}`);
    } else {
      router.push('/profile/edit');
    }
  };

  const showFactorDetails = (factorType: string) => {
    const factor = trustScoreData?.factors.find((f) => f.type === factorType);
    if (!factor) return;

    const section = getProfileSection(factorType);
    Alert.alert(
      factorLabel(factorType),
      t('trust.manager.factorAlertBody', {
        description: factorDescription(factorType),
        score: factor.value,
        action: factorActionText(factorType),
      }),
      [
        { text: t('trust.manager.cancel'), style: 'cancel' },
        {
          text: t('trust.manager.editProfile'),
          onPress: () => handleEditProfile(section),
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>{t('trust.manager.loading')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{t('trust.manager.error')}</Text>
      </View>
    );
  }

  if (!trustScoreData || trustScoreData.type !== 'personal') {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{t('trust.manager.noData')}</Text>
      </View>
    );
  }

  const factors = trustScoreData.factors;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('trust.manager.title')}</Text>
        <Text style={styles.subtitle}>{t('trust.manager.subtitle')}</Text>
      </View>

      <View style={styles.scoreSection}>
        <TrustScore score={trustScoreData.score} size="large" showLabel={true} />
        <Text style={styles.scoreDescription}>
          {t('trust.manager.scoreDescription', { score: trustScoreData.score })}
        </Text>
      </View>

      <View style={styles.factorsSection}>
        <Text style={styles.sectionTitle}>{t('trust.manager.factorsTitle')}</Text>
        <Text style={styles.sectionSubtitle}>{t('trust.manager.factorsSubtitle')}</Text>

        {factors.map((factor) => (
          <TouchableOpacity
            key={factor.type}
            style={styles.factorCard}
            onPress={() => showFactorDetails(factor.type)}
          >
            <View style={styles.factorHeader}>
              <Text style={styles.factorTitle}>{factorLabel(factor.type)}</Text>
              <Text style={styles.factorScore}>{factor.value}/100</Text>
            </View>

            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${factor.value}%`,
                    backgroundColor:
                      factor.value >= 70
                        ? colors.online
                        : factor.value >= 50
                          ? colors.away
                          : colors.busy,
                  },
                ]}
              />
            </View>

            <Text style={styles.factorDescription}>{factorDescription(factor.type)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.tipsSection}>
        <Text style={styles.sectionTitle}>{t('trust.manager.quickActionsTitle')}</Text>

        <TouchableOpacity style={styles.actionCard} onPress={() => handleEditProfile('personal')}>
          <View style={styles.actionCardHeader}>
            <Ionicons name="person-outline" size={24} color={colors.primaryColor} />
            <Text style={styles.actionCardTitle}>{t('trust.manager.actions.personalInfo.title')}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
          </View>
          <Text style={styles.actionCardText}>
            {t('trust.manager.actions.personalInfo.description')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => handleEditProfile('references')}>
          <View style={styles.actionCardHeader}>
            <Ionicons name="people-outline" size={24} color={colors.primaryColor} />
            <Text style={styles.actionCardTitle}>{t('trust.manager.actions.references.title')}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
          </View>
          <Text style={styles.actionCardText}>
            {t('trust.manager.actions.references.description')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => handleEditProfile('rental-history')}
        >
          <View style={styles.actionCardHeader}>
            <Ionicons name="home-outline" size={24} color={colors.primaryColor} />
            <Text style={styles.actionCardTitle}>{t('trust.manager.actions.rentalHistory.title')}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
          </View>
          <Text style={styles.actionCardText}>
            {t('trust.manager.actions.rentalHistory.description')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.primaryActionButton} onPress={() => handleEditProfile()}>
          <Ionicons name="create-outline" size={20} color={colors.primaryLight} />
          <Text style={styles.primaryActionButtonText}>{t('trust.manager.completeProfile')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
  },
  header: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_5,
    textAlign: 'center',
  },
  scoreSection: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: colors.primaryLight,
    margin: 20,
    borderRadius: 12,
    ...shadowToken({ y: 2, blur: 4, color: colors.shadow, opacity: 0.1, elevation: 3 }),
  },
  scoreDescription: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_5,
    marginTop: 12,
    textAlign: 'center',
  },
  factorsSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_5,
    marginBottom: 16,
  },
  factorCard: {
    backgroundColor: colors.primaryLight,
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    ...shadowToken({ y: 1, blur: 2, color: colors.shadow, opacity: 0.1, elevation: 2 }),
  },
  factorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  factorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    flex: 1,
  },
  factorScore: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.primaryColor,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 3,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  factorDescription: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_5,
    marginBottom: 4,
  },
  tipsSection: {
    padding: 20,
  },
  actionCard: {
    backgroundColor: colors.primaryLight,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    ...shadowToken({ y: 2, blur: 4, color: colors.shadow, opacity: 0.1, elevation: 3 }),
    borderLeftWidth: 4,
    borderLeftColor: colors.primaryColor,
  },
  actionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  actionCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    flex: 1,
  },
  actionCardText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 20,
    marginLeft: 36,
  },
  primaryActionButton: {
    backgroundColor: colors.primaryColor,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
    gap: 8,
  },
  primaryActionButtonText: {
    color: colors.primaryLight,
    fontSize: 16,
    fontWeight: 'bold',
  },
  loadingText: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_5,
    textAlign: 'center',
    marginTop: 50,
  },
  errorText: {
    fontSize: 16,
    color: colors.busy,
    textAlign: 'center',
    marginTop: 50,
  },
});
