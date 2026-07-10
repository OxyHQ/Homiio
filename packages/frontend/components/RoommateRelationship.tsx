import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';
import type { RoommateRelationship, RoommateProfile } from '@/hooks/useRoommate';
import { ActionButton } from '@/components/ui/ActionButton';
import { getDateLocale } from '@/utils/dateLocale';

interface RoommateRelationshipProps {
  relationship: RoommateRelationship;
  onEndRelationship: (relationshipId: string) => Promise<boolean>;
  onViewProfile: (profileId: string) => void;
}

export const RoommateRelationshipComponent: React.FC<RoommateRelationshipProps> = ({
  relationship,
  onEndRelationship,
  onViewProfile,
}) => {
  const { t, i18n } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  const handleEndRelationship = async () => {
    Alert.alert(
      t('roommates.relationship.confirmEndTitle'),
      t('roommates.relationship.confirmEndBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('roommates.relationship.confirmEndAction'),
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              const success = await onEndRelationship(relationship.id);
              if (success) {
                Alert.alert(t('roommates.alert.successTitle'), t('roommates.alert.relationshipEnded'));
              }
            } catch {
              Alert.alert(t('roommates.alert.errorTitle'), t('roommates.alert.relationshipEndFailed'));
            } finally {
              setIsLoading(false);
            }
          },
        },
      ],
    );
  };

  const getDisplayName = (profile: RoommateProfile) =>
    profile.displayName?.trim() || t('roommates.screen.fallbackName');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return colors.online;
      case 'inactive':
        return colors.away;
      case 'ended':
        return colors.busy;
      default:
        return colors.COLOR_BLACK_LIGHT_4;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active':
        return t('roommates.relationship.statusActive');
      case 'inactive':
        return t('roommates.relationship.statusInactive');
      case 'ended':
        return t('roommates.relationship.statusEnded');
      default:
        return t('roommates.relationship.statusUnknown');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(getDateLocale(i18n.language));
  };

  const getDuration = () => {
    const startDate = new Date(relationship.startDate);
    const endDate = relationship.endDate ? new Date(relationship.endDate) : new Date();
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 30) {
      return t('roommates.relationship.durationDays', { count: diffDays });
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return months > 1
        ? t('roommates.relationship.durationMonths', { count: months })
        : t('roommates.relationship.durationMonth', { count: months });
    }
    const years = Math.floor(diffDays / 365);
    return years > 1
      ? t('roommates.relationship.durationYears', { count: years })
      : t('roommates.relationship.durationYear', { count: years });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.relationshipInfo}>
          <Text style={styles.relationshipTitle}>{t('roommates.relationship.title')}</Text>
          <Text style={styles.duration}>
            {t('roommates.relationship.duration', { duration: getDuration() })}
          </Text>
          <Text style={styles.startDate}>
            {t('roommates.relationship.started', { date: formatDate(relationship.startDate) })}
          </Text>
        </View>

        <View
          style={[styles.statusBadge, { backgroundColor: getStatusColor(relationship.status) }]}
        >
          <Text style={styles.statusText}>{getStatusText(relationship.status)}</Text>
        </View>
      </View>

      <View style={styles.matchScoreSection}>
        <Text style={styles.matchScoreText}>
          {t('roommates.relationship.percentMatch', { score: relationship.matchScore })}
        </Text>
        <Text style={styles.matchScoreLabel}>{t('roommates.compatibility')}</Text>
      </View>

      <View style={styles.profilesSection}>
        <Text style={styles.sectionTitle}>{t('roommates.relationship.roommatesSection')}</Text>

        <View style={styles.profileRow}>
          <TouchableOpacity
            style={styles.profileContainer}
            onPress={() => onViewProfile(relationship.profile1.id)}
          >
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
            </View>
            <Text style={styles.profileName}>{getDisplayName(relationship.profile1)}</Text>
          </TouchableOpacity>

          <View style={styles.connectionLine}>
            <Ionicons name="people" size={20} color={colors.primaryDark} />
          </View>

          <TouchableOpacity
            style={styles.profileContainer}
            onPress={() => onViewProfile(relationship.profile2.id)}
          >
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
            </View>
            <Text style={styles.profileName}>{getDisplayName(relationship.profile2)}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {relationship.status === 'active' && (
        <View style={styles.actions}>
          <ActionButton
            icon="close-circle"
            text={t('roommates.relationship.endRelationship')}
            onPress={handleEndRelationship}
            variant="secondary"
            loading={isLoading}
            style={styles.endButton}
          />
        </View>
      )}

      {relationship.status === 'ended' && relationship.endDate && (
        <View style={styles.endedInfo}>
          <Text style={styles.endedText}>
            {t('roommates.relationship.endedOn', { date: formatDate(relationship.endDate) })}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    ...shadowToken({ y: 2, blur: 4, color: colors.COLOR_BLACK, opacity: 0.1, elevation: 3 }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  relationshipInfo: {
    flex: 1,
  },
  relationshipTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_1,
    marginBottom: 4,
  },
  duration: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 2,
  },
  startDate: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_5,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    color: colors.primaryLight,
    fontWeight: '500',
  },
  matchScoreSection: {
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 12,
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
    borderRadius: 8,
  },
  matchScoreText: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  matchScoreLabel: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_5,
    marginTop: 2,
  },
  profilesSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_1,
    marginBottom: 12,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileContainer: {
    alignItems: 'center',
    flex: 1,
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  profileName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.COLOR_BLACK_LIGHT_1,
    textAlign: 'center',
  },
  connectionLine: {
    paddingHorizontal: 16,
  },
  actions: {
    alignItems: 'center',
  },
  endButton: {
    minWidth: 150,
  },
  endedInfo: {
    alignItems: 'center',
    paddingTop: 8,
  },
  endedText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_5,
    fontStyle: 'italic',
  },
});
