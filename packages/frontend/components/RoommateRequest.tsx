import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import type { RoommateRequest } from '@/hooks/useRoommate';
import { ActionButton } from '@/components/ui/ActionButton';
import { ThemedText } from './ThemedText';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

interface RoommateRequestProps {
  request: RoommateRequest;
  type: 'sent' | 'received';
  onAccept?: (requestId: string, message?: string) => Promise<boolean>;
  onDecline?: (requestId: string, message?: string) => Promise<boolean>;
  onViewProfile: (profileId: string) => void;
}

export const RoommateRequestComponent: React.FC<RoommateRequestProps> = ({
  request,
  type,
  onAccept,
  onDecline,
  onViewProfile,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [showResponseInput, setShowResponseInput] = useState(false);
  const [responseMessage, setResponseMessage] = useState('');

  const handleAccept = async () => {
    if (!onAccept) return;

    if (!showResponseInput) {
      setShowResponseInput(true);
      return;
    }

    setIsLoading(true);
    try {
      const success = await onAccept(request.id, responseMessage);
      if (success) {
        setShowResponseInput(false);
        setResponseMessage('');
        Alert.alert('Success', 'Roommate request accepted!');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to accept roommate request');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDecline = async () => {
    if (!onDecline) return;

    if (!showResponseInput) {
      setShowResponseInput(true);
      return;
    }

    setIsLoading(true);
    try {
      const success = await onDecline(request.id, responseMessage);
      if (success) {
        setShowResponseInput(false);
        setResponseMessage('');
        Alert.alert('Success', 'Roommate request declined');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to decline roommate request');
    } finally {
      setIsLoading(false);
    }
  };

  const getDisplayName = (profile: any) => {
    const personal = profile.personalProfile;
    // Try to get name from bio or use default
    if (personal?.personalInfo?.bio) {
      const bioWords = personal.personalInfo.bio.split(' ');
      if (bioWords.length > 0 && bioWords[0].length > 2) {
        return bioWords[0];
      }
    }
    return 'User';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted':
        return '#00C853'; // Green for success
      case 'declined':
        return '#FF3B30'; // Red for error
      case 'expired':
        return colors.COLOR_BLACK_LIGHT_5;
      default:
        return '#FFCC00'; // Yellow for warning
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'accepted':
        return 'Accepted';
      case 'declined':
        return 'Declined';
      case 'expired':
        return 'Expired';
      default:
        return 'Pending';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const otherProfile = type === 'sent' ? request.receiver : request.sender;

  return (
    <View style={styles.container}>
      {/* Header with profile info */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.avatarContainer}
          onPress={() => onViewProfile(otherProfile.id)}
        >
          {/* Avatar placeholder since avatar is not in PersonalProfile type */}
          <View style={styles.avatarPlaceholder}>
            <IconComponent name="person" size={24} color={colors.COLOR_BLACK_LIGHT_5} />
          </View>
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <ThemedText style={styles.name}>{getDisplayName(otherProfile)}</ThemedText>
          <ThemedText style={styles.date}>{formatDate(request.createdAt)}</ThemedText>
          <View style={styles.matchScore}>
            <ThemedText style={styles.matchScoreText}>{request.matchScore}% Match</ThemedText>
          </View>
        </View>

        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(request.status) }]}>
          <ThemedText style={styles.statusText}>{getStatusText(request.status)}</ThemedText>
        </View>
      </View>

      {/* Message */}
      {request.message && (
        <View style={styles.messageSection}>
          <ThemedText style={styles.messageLabel}>
            {type === 'sent' ? 'Your message:' : 'Message:'}
          </ThemedText>
          <ThemedText style={styles.message}>{request.message}</ThemedText>
        </View>
      )}

      {/* Response input */}
      {showResponseInput && type === 'received' && request.status === 'pending' && (
        <View style={styles.responseSection}>
          <ThemedText style={styles.responseLabel}>Add a response (optional):</ThemedText>
          <TextInput
            style={styles.responseInput}
            value={responseMessage}
            onChangeText={setResponseMessage}
            placeholder="Thanks for the request! I'd love to connect..."
            multiline
            maxLength={500}
          />
        </View>
      )}

      {/* Actions */}
      {request.status === 'pending' && (
        <View style={styles.actions}>
          {type === 'received' ? (
            <>
              <ActionButton
                icon="close-circle"
                text="Decline"
                onPress={handleDecline}
                variant="secondary"
                loading={isLoading}
                style={styles.declineButton}
              />
              <ActionButton
                icon="checkmark-circle"
                text="Accept"
                onPress={handleAccept}
                variant="primary"
                loading={isLoading}
                style={styles.acceptButton}
              />
            </>
          ) : (
            <View style={styles.sentActions}>
              <ThemedText style={styles.sentStatusText}>Waiting for response...</ThemedText>
            </View>
          )}
        </View>
      )}

      {request.status !== 'pending' && (
        <View style={styles.completedActions}>
          <TouchableOpacity
            style={styles.viewProfileButton}
            onPress={() => onViewProfile(otherProfile.id)}
          >
            <IconComponent name="eye-outline" size={16} color={colors.primaryDark} />
            <ThemedText style={styles.viewProfileText}>View Profile</ThemedText>
          </TouchableOpacity>
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
    shadowColor: colors.COLOR_BLACK,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerInfo: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_1,
    marginBottom: 2,
  },
  date: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_5,
    marginBottom: 4,
  },
  matchScore: {
    alignSelf: 'flex-start',
  },
  matchScoreText: {
    fontSize: 12,
    color: colors.primaryDark,
    fontWeight: '500',
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
  messageSection: {
    marginBottom: 16,
  },
  messageLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.COLOR_BLACK_LIGHT_1,
    marginBottom: 4,
  },
  message: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
  responseSection: {
    marginBottom: 16,
  },
  responseLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.COLOR_BLACK_LIGHT_1,
    marginBottom: 8,
  },
  responseInput: {
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_1,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  declineButton: {
    flex: 1,
  },
  acceptButton: {
    flex: 1,
  },
  sentActions: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  sentStatusText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_5,
    fontStyle: 'italic',
  },
  completedActions: {
    alignItems: 'center',
    paddingTop: 8,
  },
  viewProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  viewProfileText: {
    fontSize: 14,
    color: colors.primaryDark,
    marginLeft: 4,
  },
});
