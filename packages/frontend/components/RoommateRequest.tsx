/**
 * A sent or received roommate request. Built from Bloom `Card`, `Avatar`,
 * `Chip` and `Textarea`; the outcome of accept/decline is a Bloom `toast`.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { deviceTimeZone, formatDate } from '@homiio/shared-types';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { RiCheckboxCircleFill, RiCloseCircleLine, RiEyeLine } from '@oxy.so/bloom/icons';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { useFormatting } from '@/utils/format';
import type { RoommateRequest, RoommateProfile } from '@/hooks/useRoommate';
import { spacing } from '@/constants/styles';

interface RoommateRequestProps {
  request: RoommateRequest;
  type: 'sent' | 'received';
  onAccept?: (requestId: string, message?: string) => Promise<boolean>;
  onDecline?: (requestId: string, message?: string) => Promise<boolean>;
  onViewProfile: (profileId: string) => void;
}

type StatusTone = 'success' | 'error' | 'warning' | 'default';

export const RoommateRequestComponent: React.FC<RoommateRequestProps> = ({
  request,
  type,
  onAccept,
  onDecline,
  onViewProfile,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale } = useFormatting();
  const timeZone = deviceTimeZone();
  const [isLoading, setIsLoading] = useState(false);
  const [showResponseInput, setShowResponseInput] = useState(false);
  const [responseMessage, setResponseMessage] = useState('');

  const respond = async (
    handler: ((requestId: string, message?: string) => Promise<boolean>) | undefined,
    successKey: string,
    failureKey: string,
  ) => {
    if (!handler) return;

    if (!showResponseInput) {
      setShowResponseInput(true);
      return;
    }

    setIsLoading(true);
    try {
      const success = await handler(request.id, responseMessage);
      if (success) {
        setShowResponseInput(false);
        setResponseMessage('');
        toast.success(t(successKey));
      }
    } catch {
      toast.error(t(failureKey));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccept = () =>
    respond(onAccept, 'roommates.alert.accepted', 'roommates.alert.acceptFailed');
  const handleDecline = () =>
    respond(onDecline, 'roommates.alert.declined', 'roommates.alert.declineFailed');

  const getDisplayName = (profile: RoommateProfile) =>
    profile.displayName?.trim() || t('roommates.screen.fallbackName');

  const statusTone = (status: string): StatusTone => {
    switch (status) {
      case 'accepted':
        return 'success';
      case 'declined':
        return 'error';
      case 'expired':
        return 'default';
      default:
        return 'warning';
    }
  };

  const statusText = (status: string) => {
    switch (status) {
      case 'accepted':
        return t('roommates.request.accepted');
      case 'declined':
        return t('roommates.request.declined');
      case 'expired':
        return t('roommates.request.expired');
      default:
        return t('roommates.request.pending');
    }
  };

  // `toLocaleDateString()` with no argument formats in the DEVICE's locale, not
  // the language the reader picked in Homiio.
  const formatRequestDate = (dateString: string): string =>
    formatDate(dateString, locale, timeZone);

  const otherProfile = type === 'sent' ? request.receiver : request.sender;
  const otherName = getDisplayName(otherProfile);
  const secondary = { color: theme.colors.textSecondary };

  return (
    <Card variant="outlined" radius="radius-16" style={styles.card}>
      <View style={styles.header}>
        <Avatar name={otherName} size={48} onPress={() => onViewProfile(otherProfile.id)} />

        <View style={styles.headerInfo}>
          <BloomText style={styles.name} numberOfLines={1}>
            {otherName}
          </BloomText>
          <BloomText style={[styles.metaSmall, secondary]}>
            {formatRequestDate(request.createdAt)}
          </BloomText>
          <BloomText style={[styles.metaSmall, { color: theme.colors.primary }]}>
            {t('roommates.relationship.percentMatch', { score: request.matchScore })}
          </BloomText>
        </View>

        <Chip size="small" variant="subtle" color={statusTone(request.status)}>
          {statusText(request.status)}
        </Chip>
      </View>

      {request.message ? (
        <View style={styles.messageSection}>
          <BloomText style={styles.messageLabel}>
            {type === 'sent'
              ? t('roommates.request.yourMessage')
              : t('roommates.relationship.message')}
          </BloomText>
          <BloomText style={[styles.message, secondary]}>{request.message}</BloomText>
        </View>
      ) : null}

      {showResponseInput && type === 'received' && request.status === 'pending' ? (
        <Textarea
          label={t('roommates.request.responseLabel')}
          value={responseMessage}
          onChangeText={setResponseMessage}
          placeholder={t('roommates.request.responsePlaceholder')}
          maxLength={500}
          showCount
          autoResize
          maxRows={6}
        />
      ) : null}

      {request.status === 'pending' ? (
        type === 'received' ? (
          <View style={styles.actions}>
            <Button
              leadingIcon={RiCloseCircleLine}
              onPress={handleDecline}
              variant="secondary"
              loading={isLoading}
              style={styles.actionButton}
            >
              {t('roommates.request.decline')}
            </Button>
            <Button
              leadingIcon={RiCheckboxCircleFill}
              onPress={handleAccept}
              variant="primary"
              loading={isLoading}
              style={styles.actionButton}
            >
              {t('roommates.request.accept')}
            </Button>
          </View>
        ) : (
          <BloomText style={[styles.waiting, secondary]}>
            {t('roommates.request.waiting')}
          </BloomText>
        )
      ) : (
        <Button
          variant="ghost"
          size="small"
          leadingIcon={RiEyeLine}
          onPress={() => onViewProfile(otherProfile.id)}
          style={styles.viewProfile}
        >
          {t('roommates.request.viewProfile')}
        </Button>
      )}
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
    alignItems: 'center',
    gap: spacing.md,
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  metaSmall: {
    fontSize: 12,
  },
  messageSection: {
    gap: spacing.xs,
  },
  messageLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
  waiting: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  viewProfile: {
    alignSelf: 'center',
  },
});
