import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Image,
    Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import type { RoommateRelationship } from '@/hooks/useRoommate';
import Button from '@/components/Button';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

interface RoommateRelationshipProps {
    relationship: RoommateRelationship;
    onEndRelationship: (relationshipId: string) => Promise<boolean>;
    onViewProfile: (profileId: string) => void;
}

export const RoommateRelationshipComponent: React.FC<RoommateRelationshipProps> = ({
    relationship,
    onEndRelationship,
    onViewProfile
}) => {
    const [isLoading, setIsLoading] = useState(false);

    const handleEndRelationship = async () => {
        Alert.alert(
            'End Relationship',
            'Are you sure you want to end this roommate relationship? This action cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'End Relationship',
                    style: 'destructive',
                    onPress: async () => {
                        setIsLoading(true);
                        try {
                            const success = await onEndRelationship(relationship.id);
                            if (success) {
                                Alert.alert('Success', 'Roommate relationship ended');
                            }
                        } catch (error) {
                            Alert.alert('Error', 'Failed to end roommate relationship');
                        } finally {
                            setIsLoading(false);
                        }
                    }
                }
            ]
        );
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
                return 'Active';
            case 'inactive':
                return 'Inactive';
            case 'ended':
                return 'Ended';
            default:
                return 'Unknown';
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString();
    };

    const getDuration = () => {
        const startDate = new Date(relationship.startDate);
        const endDate = relationship.endDate ? new Date(relationship.endDate) : new Date();
        const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 30) {
            return `${diffDays} days`;
        } else if (diffDays < 365) {
            const months = Math.floor(diffDays / 30);
            return `${months} month${months > 1 ? 's' : ''}`;
        } else {
            const years = Math.floor(diffDays / 365);
            return `${years} year${years > 1 ? 's' : ''}`;
        }
    };

    return (
        <View style={styles.container}>
            {/* Header with relationship info */}
            <View style={styles.header}>
                <View style={styles.relationshipInfo}>
                    <Text style={styles.relationshipTitle}>Roommate Relationship</Text>
                    <Text style={styles.duration}>Duration: {getDuration()}</Text>
                    <Text style={styles.startDate}>Started: {formatDate(relationship.startDate)}</Text>
                </View>

                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(relationship.status) }]}>
                    <Text style={styles.statusText}>{getStatusText(relationship.status)}</Text>
                </View>
            </View>

            {/* Match score */}
            <View style={styles.matchScoreSection}>
                <Text style={styles.matchScoreText}>{relationship.matchScore}% Match</Text>
                <Text style={styles.matchScoreLabel}>Compatibility Score</Text>
            </View>

            {/* Roommate profiles */}
            <View style={styles.profilesSection}>
                <Text style={styles.sectionTitle}>Roommates</Text>

                <View style={styles.profileRow}>
                    <TouchableOpacity
                        style={styles.profileContainer}
                        onPress={() => onViewProfile(relationship.profile1.id)}
                    >
                        {relationship.profile1.personalProfile?.avatar ? (
                            <Image
                                source={{ uri: relationship.profile1.personalProfile.avatar }}
                                style={styles.profileAvatar}
                            />
                        ) : (
                            <View style={styles.avatarPlaceholder}>
                                <IconComponent name="person" size={20} color={colors.gray[400]} />
                            </View>
                        )}
                        <Text style={styles.profileName}>{getDisplayName(relationship.profile1)}</Text>
                    </TouchableOpacity>

                    <View style={styles.connectionLine}>
                        <IconComponent name="people" size={20} color={colors.primaryDark} />
                    </View>

                    <TouchableOpacity
                        style={styles.profileContainer}
                        onPress={() => onViewProfile(relationship.profile2.id)}
                    >
                        {relationship.profile2.personalProfile?.avatar ? (
                            <Image
                                source={{ uri: relationship.profile2.personalProfile.avatar }}
                                style={styles.profileAvatar}
                            />
                        ) : (
                            <View style={styles.avatarPlaceholder}>
                                <IconComponent name="person" size={20} color={colors.gray[400]} />
                            </View>
                        )}
                        <Text style={styles.profileName}>{getDisplayName(relationship.profile2)}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Actions */}
            {relationship.status === 'active' && (
                <View style={styles.actions}>
                    <Button
                        title="End Relationship"
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
                        Ended on {formatDate(relationship.endDate)}
                    </Text>
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
        color: colors.gray[900],
        marginBottom: 4,
    },
    duration: {
        fontSize: 14,
        color: colors.gray[700],
        marginBottom: 2,
    },
    startDate: {
        fontSize: 12,
        color: colors.gray[600],
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
    matchScoreSection: {
        alignItems: 'center',
        marginBottom: 20,
        paddingVertical: 12,
        backgroundColor: colors.gray[50],
        borderRadius: 8,
    },
    matchScoreText: {
        fontSize: 24,
        fontWeight: '700',
        color: colors.primaryDark,
    },
    matchScoreLabel: {
        fontSize: 12,
        color: colors.gray[600],
        marginTop: 2,
    },
    profilesSection: {
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.gray[900],
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
    profileAvatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        marginBottom: 8,
    },
    avatarPlaceholder: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: colors.gray[200],
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    profileName: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.gray[900],
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
        color: colors.gray[600],
        fontStyle: 'italic',
    },
}); 