/**
 * An accepted roommate pairing: status, duration, compatibility and the two
 * people in it. Ending it asks through Bloom `confirm()` and reports the
 * outcome with a `toast`.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AvatarGroup } from '@oxy.so/bloom/avatar-group';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { RiCloseCircleLine } from '@oxy.so/bloom/icons';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { H3, Text as BloomText } from '@oxy.so/bloom/typography';
import type { RoommateRelationship, RoommateProfile } from '@/hooks/useRoommate';
import { getFormatLocale } from '@/utils/dateLocale';
import { spacing } from '@/constants/styles';

interface RoommateRelationshipProps {
  relationship: RoommateRelationship;
  onEndRelationship: (relationshipId: string) => Promise<boolean>;
  onViewProfile: (profileId: string) => void;
}

type StatusTone = 'success' | 'warning' | 'error' | 'default';

export const RoommateRelationshipComponent: React.FC<RoommateRelationshipProps> = ({
  relationship,
  onEndRelationship,
  onViewProfile,
}) => {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [isLoading, setIsLoading] = useState(false);

  const handleEndRelationship = async () => {
    const confirmed = await confirm({
      title: t('roommates.relationship.confirmEndTitle'),
      description: t('roommates.relationship.confirmEndBody'),
      confirmLabel: t('roommates.relationship.confirmEndAction'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) return;

    setIsLoading(true);
    try {
      const success = await onEndRelationship(relationship.id);
      if (success) {
        toast.success(t('roommates.alert.relationshipEnded'));
      }
    } catch {
      toast.error(t('roommates.alert.relationshipEndFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const getDisplayName = (profile: RoommateProfile) =>
    profile.displayName?.trim() || t('roommates.screen.fallbackName');

  const statusTone = (status: string): StatusTone => {
    switch (status) {
      case 'active':
        return 'success';
      case 'inactive':
        return 'warning';
      case 'ended':
        return 'error';
      default:
        return 'default';
    }
  };

  const statusText = (status: string) => {
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

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString(getFormatLocale(i18n.language));

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

  const people = [relationship.profile1, relationship.profile2];
  const secondary = { color: theme.colors.textSecondary };

  return (
    <Card variant="outlined" radius="radius-16" style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <H3>{t('roommates.relationship.title')}</H3>
          <BloomText style={[styles.meta, secondary]}>
            {t('roommates.relationship.duration', { duration: getDuration() })}
          </BloomText>
          <BloomText style={[styles.metaSmall, secondary]}>
            {t('roommates.relationship.started', { date: formatDate(relationship.startDate) })}
          </BloomText>
        </View>
        <Chip size="small" variant="subtle" color={statusTone(relationship.status)}>
          {statusText(relationship.status)}
        </Chip>
      </View>

      <View style={[styles.matchScore, { backgroundColor: theme.colors.backgroundSecondary }]}>
        <BloomText style={[styles.matchScoreText, { color: theme.colors.primary }]}>
          {t('roommates.relationship.percentMatch', { score: relationship.matchScore })}
        </BloomText>
        <BloomText style={[styles.metaSmall, secondary]}>{t('roommates.compatibility')}</BloomText>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <BloomText style={styles.sectionTitle}>
            {t('roommates.relationship.roommatesSection')}
          </BloomText>
          <AvatarGroup
            size={32}
            showInitials
            items={people.map((person) => ({
              id: person.id,
              name: getDisplayName(person),
            }))}
          />
        </View>
        <View style={styles.people}>
          {people.map((person) => (
            <Button
              key={person.id}
              variant="secondary"
              size="small"
              onPress={() => onViewProfile(person.id)}
              accessibilityLabel={`${t('roommates.actions.viewProfile')}: ${getDisplayName(person)}`}
              style={styles.personButton}
            >
              {getDisplayName(person)}
            </Button>
          ))}
        </View>
      </View>

      {relationship.status === 'active' ? (
        <Button
          leadingIcon={RiCloseCircleLine}
          onPress={handleEndRelationship}
          variant="secondary"
          loading={isLoading}
          style={styles.endButton}
        >
          {t('roommates.relationship.endRelationship')}
        </Button>
      ) : null}

      {relationship.status === 'ended' && relationship.endDate ? (
        <BloomText style={[styles.endedText, secondary]}>
          {t('roommates.relationship.endedOn', { date: formatDate(relationship.endDate) })}
        </BloomText>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  meta: {
    fontSize: 14,
  },
  metaSmall: {
    fontSize: 12,
  },
  matchScore: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 12,
  },
  matchScoreText: {
    fontSize: 24,
    fontWeight: '700',
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  people: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  personButton: {
    flex: 1,
  },
  endButton: {
    alignSelf: 'center',
    minWidth: 150,
  },
  endedText: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
