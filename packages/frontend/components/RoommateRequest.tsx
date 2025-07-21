import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Image,
    Alert,
    TextInput
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import type { RoommateRequest } from '@/hooks/useRoommate';
import Button from '@/components/Button';

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
    onViewProfile
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
        if (personal?.firstName && personal?.lastName) {
            return `${personal.firstName} ${personal.lastName}`;
        }
        if (personal?.firstName) {
            return personal.firstName;
        }
        return 'User';
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'accepted':
                return colors.success;
            case 'declined':
                return colors.error;
            case 'expired':
                return colors.gray[500];
            default:
                return colors.warning;
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
                    {otherProfile.personalProfile?.avatar ? (
                        <Image
                            source={{ uri: otherProfile.personalProfile.avatar }}
                            style={styles.avatar}
                        />
                    ) : (
                        <View style={styles.avatarPlaceholder}>
                            <IconComponent name="person" size={24} color={colors.gray[400]} />
                        </View>
                    )}
                </TouchableOpacity>

                <View style={styles.headerInfo}>
                    <Text style={styles.name}>{getDisplayName(otherProfile)}</Text>
                    <Text style={styles.date}>{formatDate(request.createdAt)}</Text>
                    <View style={styles.matchScore}>
                        <Text style={styles.matchScoreText}>{request.matchScore}% Match</Text>
                    </View>
                </View>

                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(request.status) }]}>
                    <Text style={styles.statusText}>{getStatusText(request.status)}</Text>
                </View>
            </View>

            {/* Message */}
            {request.message && (
                <View style={styles.messageSection}>
                    <Text style={styles.messageLabel}>
                        {type === 'sent' ? 'Your message:' : 'Message:'}
                    </Text>
                    <Text style={styles.message}>{request.message}</Text>
                </View>
            )}

            {/* Response input */}
            {showResponseInput && type === 'received' && request.status === 'pending' && (
                <View style={styles.responseSection}>
                    <Text style={styles.responseLabel}>Add a response (optional):</Text>
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
                            <Button
                                title="Decline"
                                onPress={handleDecline}
                                variant="secondary"
                                loading={isLoading}
                                style={styles.declineButton}
                            />
                            <Button
                                title="Accept"
                                onPress={handleAccept}
                                variant="primary"
                                loading={isLoading}
                                style={styles.acceptButton}
                            />
                        </>
                    ) : (
                        <View style={styles.sentActions}>
                            <Text style={styles.sentStatusText}>Waiting for response...</Text>
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
                        <Text style={styles.viewProfileText}>View Profile</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.white,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        shadowColor: colors.black,
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
        backgroundColor: colors.gray[200],
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerInfo: {
        flex: 1,
    },
    name: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.gray[900],
        marginBottom: 2,
    },
    date: {
        fontSize: 12,
        color: colors.gray[600],
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
        color: colors.white,
        fontWeight: '500',
    },
    messageSection: {
        marginBottom: 16,
    },
    messageLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.gray[900],
        marginBottom: 4,
    },
    message: {
        fontSize: 14,
        color: colors.gray[700],
        lineHeight: 20,
    },
    responseSection: {
        marginBottom: 16,
    },
    responseLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.gray[900],
        marginBottom: 8,
    },
    responseInput: {
        borderWidth: 1,
        borderColor: colors.gray[300],
        borderRadius: 8,
        padding: 12,
        fontSize: 14,
        color: colors.gray[900],
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
        color: colors.gray[600],
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