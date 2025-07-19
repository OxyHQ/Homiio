import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { TrustScore } from './TrustScore';

export type LifestylePreference = 'early_bird' | 'night_owl' | 'clean' | 'social' | 'quiet' | 'pets' | 'smoker' | 'non_smoker' | 'vegan' | 'creative';

export type MatchPercentage = number; // 0-100

type RoommateMatchProps = {
    id: string;
    name: string;
    age: number;
    occupation: string;
    bio: string;
    imageUrl: string;
    matchPercentage: MatchPercentage;
    trustScore: number;
    lifestylePreferences: LifestylePreference[];
    interests: string[];
    onViewProfilePress?: () => void;
    onMessagePress?: () => void;
};

const preferenceLabels: Record<LifestylePreference, { label: string; icon: string }> = {
    early_bird: { label: 'Early Bird', icon: 'sunny-outline' },
    night_owl: { label: 'Night Owl', icon: 'moon-outline' },
    clean: { label: 'Clean', icon: 'sparkles-outline' },
    social: { label: 'Social', icon: 'people-outline' },
    quiet: { label: 'Quiet', icon: 'volume-low-outline' },
    pets: { label: 'Pet Friendly', icon: 'paw-outline' },
    smoker: { label: 'Smoker', icon: 'flame-outline' },
    non_smoker: { label: 'Non-Smoker', icon: 'flame-outline' },
    vegan: { label: 'Vegan', icon: 'leaf-outline' },
    creative: { label: 'Creative', icon: 'color-palette-outline' },
};

export function RoommateMatch({
    name,
    age,
    occupation,
    bio,
    imageUrl,
    matchPercentage,
    trustScore,
    lifestylePreferences,
    interests,
    onViewProfilePress,
    onMessagePress,
}: RoommateMatchProps) {
    // Get match color based on percentage
    const getMatchColor = (percentage: number) => {
        if (percentage >= 90) return '#4CAF50';
        if (percentage >= 70) return '#8BC34A';
        if (percentage >= 50) return '#FFC107';
        if (percentage >= 30) return '#FF9800';
        return '#F44336';
    };

    const matchColor = getMatchColor(matchPercentage);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.profileSection}>
                    <Image
                        source={{ uri: imageUrl }}
                        style={styles.profileImage}
                    />
                    <View style={styles.profileInfo}>
                        <View style={styles.nameRow}>
                            <Text style={styles.name}>{name}, {age}</Text>
                            <View style={[styles.matchBadge, { backgroundColor: matchColor }]}>
                                <Text style={styles.matchText}>{matchPercentage}% Match</Text>
                            </View>
                        </View>
                        <Text style={styles.occupation}>{occupation}</Text>
                        <View style={styles.trustScoreContainer}>
                            <TrustScore score={trustScore} size="small" showLabel={false} />
                            <Text style={styles.trustText}>Trust Score: {trustScore}</Text>
                        </View>
                    </View>
                </View>
            </View>

            <Text style={styles.bioText} numberOfLines={3}>{bio}</Text>

            <View style={styles.sectionTitle}>
                <Ionicons name="options-outline" size={16} color={colors.primaryDark_1} />
                <Text style={styles.sectionTitleText}>Lifestyle</Text>
            </View>

            <View style={styles.preferencesContainer}>
                {lifestylePreferences.map((preference, index) => (
                    <View key={index} style={styles.preferenceTag}>
                        <Ionicons
                            name={preferenceLabels[preference].icon as any}
                            size={14}
                            color={colors.primaryDark_1}
                        />
                        <Text style={styles.preferenceText}>{preferenceLabels[preference].label}</Text>
                    </View>
                ))}
            </View>

            <View style={styles.sectionTitle}>
                <Ionicons name="heart-outline" size={16} color={colors.primaryDark_1} />
                <Text style={styles.sectionTitleText}>Interests</Text>
            </View>

            <View style={styles.interestsContainer}>
                {interests.map((interest, index) => (
                    <View key={index} style={styles.interestTag}>
                        <Text style={styles.interestText}>{interest}</Text>
                    </View>
                ))}
            </View>

            <View style={styles.actionsContainer}>
                <TouchableOpacity
                    style={[styles.actionButton, styles.primaryButton]}
                    onPress={onMessagePress}
                >
                    <Ionicons name="chatbubble-outline" size={18} color="white" />
                    <Text style={styles.primaryButtonText}>Message</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.actionButton, styles.secondaryButton]}
                    onPress={onViewProfilePress}
                >
                    <Ionicons name="person-outline" size={18} color={colors.primaryColor} />
                    <Text style={styles.secondaryButtonText}>View Profile</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        padding: 16,
        marginHorizontal: 12,
        marginBottom: 16,
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    header: {
        marginBottom: 12,
    },
    profileSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    profileImage: {
        width: 70,
        height: 70,
        borderRadius: 35,
        marginRight: 12,
    },
    profileInfo: {
        flex: 1,
    },
    nameRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    name: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    matchBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    matchText: {
        color: 'white',
        fontSize: 12,
        fontWeight: '500',
    },
    occupation: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginBottom: 4,
    },
    trustScoreContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    trustText: {
        fontSize: 12,
        color: colors.primaryDark_1,
        marginLeft: 8,
    },
    bioText: {
        fontSize: 14,
        color: colors.primaryDark,
        marginBottom: 16,
        lineHeight: 20,
    },
    sectionTitle: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    sectionTitleText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primaryDark,
        marginLeft: 6,
    },
    preferencesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 16,
    },
    preferenceTag: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.COLOR_BLACK_LIGHT_5,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 20,
        marginRight: 8,
        marginBottom: 8,
    },
    preferenceText: {
        fontSize: 12,
        color: colors.primaryDark,
        marginLeft: 4,
    },
    interestsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 16,
    },
    interestTag: {
        backgroundColor: 'rgba(33, 150, 243, 0.1)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        marginRight: 8,
        marginBottom: 8,
    },
    interestText: {
        fontSize: 12,
        color: '#2196F3',
    },
    actionsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 25,
        flex: 1,
        marginHorizontal: 5,
    },
    primaryButton: {
        backgroundColor: colors.primaryColor,
    },
    primaryButtonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 6,
        fontFamily: 'Phudu',
    },
    secondaryButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    secondaryButtonText: {
        color: colors.primaryColor,
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 6,
        fontFamily: 'Phudu',
    },
}); 