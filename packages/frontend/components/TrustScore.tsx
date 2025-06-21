import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/styles/colors';

type TrustScoreProps = {
    score: number; // 0-100 score
    size?: 'small' | 'medium' | 'large';
    showLabel?: boolean;
};

export function TrustScore({
    score,
    size = 'medium',
    showLabel = true,
}: TrustScoreProps) {
    // Calculate the appropriate color based on the score
    const getColor = (score: number) => {
        if (score >= 90) return '#4CAF50'; // Excellent
        if (score >= 70) return '#8BC34A'; // Good
        if (score >= 50) return '#FFC107'; // Average
        if (score >= 30) return '#FF9800'; // Below Average
        return '#F44336'; // Poor
    };

    const getTrustLevel = (score: number) => {
        if (score >= 90) return 'Excellent';
        if (score >= 70) return 'Good';
        if (score >= 50) return 'Average';
        if (score >= 30) return 'Fair';
        return 'Needs Improvement';
    };

    const sizeStyles = {
        small: {
            container: { height: 32, width: 32 },
            innerCircle: { height: 26, width: 26 },
            fontSize: 12,
            labelSize: 12,
        },
        medium: {
            container: { height: 48, width: 48 },
            innerCircle: { height: 40, width: 40 },
            fontSize: 18,
            labelSize: 14,
        },
        large: {
            container: { height: 72, width: 72 },
            innerCircle: { height: 64, width: 64 },
            fontSize: 28,
            labelSize: 16,
        },
    };

    const color = getColor(score);
    const trustLevel = getTrustLevel(score);
    const sizeStyle = sizeStyles[size];

    return (
        <View style={styles.wrapper}>
            <View style={[styles.container, sizeStyle.container, { borderColor: color }]}>
                <View style={[styles.innerCircle, sizeStyle.innerCircle, { backgroundColor: color }]}>
                    <Text style={[styles.scoreText, { fontSize: sizeStyle.fontSize }]}>
                        {score}
                    </Text>
                </View>
            </View>
            {showLabel && (
                <View style={styles.labelContainer}>
                    <Text style={[styles.label, { fontSize: sizeStyle.labelSize, color }]}>
                        {trustLevel}
                    </Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        alignItems: 'center',
    },
    container: {
        borderWidth: 3,
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
    },
    innerCircle: {
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scoreText: {
        color: 'white',
        fontWeight: 'bold',
    },
    labelContainer: {
        alignItems: 'center',
        marginTop: 6,
    },
    label: {
        fontWeight: '600',
    },
}); 