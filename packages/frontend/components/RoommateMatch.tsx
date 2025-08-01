import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Image,
    Alert,
    Platform,
    TextInput
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import type { RoommateProfile } from '@/hooks/useRoommate';
import { ActionButton } from '@/components/ui/ActionButton';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

interface RoommateMatchProps {
    profile: RoommateProfile;
    onSendRequest: (profileId: string, message?: string) => Promise<boolean>;
    onViewProfile: (profileId: string) => void;
}

export const RoommateMatch: React.FC<RoommateMatchProps> = ({
    profile,
    onSendRequest,
    onViewProfile
}) => {
    const [isLoading, setIsLoading] = useState(false);
    const [showMessageInput, setShowMessageInput] = useState(false);
    const [message, setMessage] = useState('');

    const handleSendRequest = async () => {
        if (!showMessageInput) {
            setShowMessageInput(true);
            return;
        }

        setIsLoading(true);
        try {
            const success = await onSendRequest(profile.id, message);
            if (success) {
                setShowMessageInput(false);
                setMessage('');
                Alert.alert('Success', 'Roommate request sent successfully!');
            }
        } catch (error) {
            Alert.alert('Error', 'Failed to send roommate request');
        } finally {
            setIsLoading(false);
        }
    };

    const getDisplayName = () => {
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

    const getMatchScoreColor = (score: number) => {
        if (score >= 80) return '#00C853'; // Green for success
        if (score >= 60) return '#FFCC00'; // Yellow for warning
        return '#FF3B30'; // Red for error
    };

    const getMatchScoreText = (score: number) => {
        if (score >= 80) return 'Excellent Match';
        if (score >= 60) return 'Good Match';
        return 'Fair Match';
    };

    return (
        <View style={styles.container}>
            {/* Header with avatar and basic info */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.avatarContainer}
                    onPress={() => onViewProfile(profile.id)}
                >
                    {/* Avatar placeholder since avatar is not in PersonalProfile type */}
                    <View style={styles.avatarPlaceholder}>
                        <IconComponent name="person" size={24} color={colors.COLOR_BLACK_LIGHT_5} />
                    </View>
                </TouchableOpacity>

                <View style={styles.headerInfo}>
                    <Text style={styles.name}>{getDisplayName()}</Text>
                    <Text style={styles.age}>25 years old</Text>
                    <Text style={styles.location}>Los Angeles, CA</Text>
                </View>

                {profile.matchScore && (
                    <View style={styles.matchScore}>
                        <Text style={[styles.matchScoreText, { color: getMatchScoreColor(profile.matchScore) }]}>
                            {profile.matchScore}%
                        </Text>
                        <Text style={styles.matchScoreLabel}>
                            {getMatchScoreText(profile.matchScore)}
                        </Text>
                    </View>
                )}
            </View>

            {/* Bio */}
            {profile.personalProfile?.personalInfo?.bio && (
                <View style={styles.bioSection}>
                    <Text style={styles.bio}>{profile.personalProfile.personalInfo.bio}</Text>
                </View>
            )}

            {/* Preferences */}
            {profile.personalProfile?.settings?.roommate?.preferences && (
                <View style={styles.preferencesSection}>
                    <Text style={styles.sectionTitle}>Preferences</Text>
                    <View style={styles.preferencesGrid}>
                        <View style={styles.preferenceItem}>
                            <IconComponent name="cash-outline" size={16} color={colors.COLOR_BLACK_LIGHT_5} />
                            <Text style={styles.preferenceText}>
                                ${profile.personalProfile.settings.roommate.preferences.budget?.max || 0}/mo
                            </Text>
                        </View>
                        <View style={styles.preferenceItem}>
                            <IconComponent name="calendar-outline" size={16} color={colors.COLOR_BLACK_LIGHT_5} />
                            <Text style={styles.preferenceText}>
                                {profile.personalProfile.settings.roommate.preferences.moveInDate || 'Flexible'}
                            </Text>
                        </View>
                        <View style={styles.preferenceItem}>
                            <IconComponent name="home-outline" size={16} color={colors.COLOR_BLACK_LIGHT_5} />
                            <Text style={styles.preferenceText}>
                                {profile.personalProfile.settings.roommate.preferences.leaseDuration || 'Flexible'}
                            </Text>
                        </View>
                    </View>
                </View>
            )}

            {/* Message input */}
            {showMessageInput && (
                <View style={styles.messageSection}>
                    <Text style={styles.messageLabel}>Add a message (optional):</Text>
                    <TextInput
                        style={styles.messageInput}
                        value={message}
                        onChangeText={setMessage}
                        placeholder="Hi! I think we'd be great roommates..."
                        multiline
                        maxLength={500}
                    />
                </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
                <TouchableOpacity
                    style={styles.viewProfileButton}
                    onPress={() => onViewProfile(profile.id)}
                >
                    <IconComponent name="eye-outline" size={20} color={colors.primaryDark} />
                    <Text style={styles.viewProfileText}>View Profile</Text>
                </TouchableOpacity>

                <ActionButton
                    icon={showMessageInput ? "send" : "person-add"}
                    text={showMessageInput ? 'Send Request' : 'Send Request'}
                    onPress={handleSendRequest}
                    variant="primary"
                    loading={isLoading}
                    style={styles.sendRequestButton}
                />
            </View>
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
        width: 60,
        height: 60,
        borderRadius: 30,
    },
    avatarPlaceholder: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerInfo: {
        flex: 1,
    },
    name: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_1,
        marginBottom: 2,
    },
    age: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 2,
    },
    location: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
    },
    matchScore: {
        alignItems: 'center',
    },
    matchScoreText: {
        fontSize: 20,
        fontWeight: '700',
    },
    matchScoreLabel: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginTop: 2,
    },
    bioSection: {
        marginBottom: 16,
    },
    bio: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        lineHeight: 20,
    },
    preferencesSection: {
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_1,
        marginBottom: 8,
    },
    preferencesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    preferenceItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.COLOR_BLACK_LIGHT_7,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    preferenceText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginLeft: 4,
    },
    messageSection: {
        marginBottom: 16,
    },
    messageLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.COLOR_BLACK_LIGHT_1,
        marginBottom: 8,
    },
    messageInput: {
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
        alignItems: 'center',
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
    sendRequestButton: {
        flex: 1,
        marginLeft: 12,
    },
}); 