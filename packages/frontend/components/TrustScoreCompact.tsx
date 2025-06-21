import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '@/styles/colors';
import { usePrimaryProfile } from '@/hooks/useProfileQueries';
import { TrustScore } from './TrustScore';

type TrustScoreCompactProps = {
    size?: 'small' | 'medium' | 'large';
    showLabel?: boolean;
    onPress?: () => void;
    profileId?: string; // Optional: if you want to show a specific profile's score
};

export function TrustScoreCompact({
    size = 'medium',
    showLabel = true,
    onPress,
    profileId,
}: TrustScoreCompactProps) {
    const { data: profile, isLoading } = usePrimaryProfile();

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <View style={[
                    styles.loadingCircle,
                    {
                        width: size === 'small' ? 24 : size === 'medium' ? 32 : 48,
                        height: size === 'small' ? 24 : size === 'medium' ? 32 : 48
                    }
                ]} />
            </View>
        );
    }

    if (!profile?.personalProfile) {
        return null;
    }

    const { trustScore } = profile.personalProfile;
    const score = trustScore.score;

    const getTrustLevel = (score: number) => {
        if (score >= 90) return 'Excellent';
        if (score >= 70) return 'Good';
        if (score >= 50) return 'Average';
        if (score >= 30) return 'Fair';
        return 'Poor';
    };

    const getTrustColor = (score: number) => {
        if (score >= 90) return '#4CAF50';
        if (score >= 70) return '#8BC34A';
        if (score >= 50) return '#FFC107';
        if (score >= 30) return '#FF9800';
        return '#F44336';
    };

    const trustLevel = getTrustLevel(score);
    const trustColor = getTrustColor(score);

    const getLabelSize = () => {
        switch (size) {
            case 'small': return 10;
            case 'medium': return 12;
            case 'large': return 14;
            default: return 12;
        }
    };

    const content = (
        <View style={styles.container}>
            <TrustScore
                score={score}
                size={size}
                showLabel={false}
            />
            {showLabel && (
                <Text style={[styles.label, { color: trustColor, fontSize: getLabelSize() }]}>
                    {trustLevel}
                </Text>
            )}
        </View>
    );

    if (onPress) {
        return (
            <TouchableOpacity onPress={onPress} style={styles.touchable}>
                {content}
            </TouchableOpacity>
        );
    }

    return content;
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
    },
    loadingContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingCircle: {
        borderRadius: 50,
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    },
    label: {
        fontWeight: '600',
        marginTop: 4,
    },
    touchable: {
        alignItems: 'center',
    },
}); 