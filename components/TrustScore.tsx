import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
            container: { height: 24, width: 24 },
            innerCircle: { height: 18, width: 18 },
            fontSize: 10,
            labelSize: 10,
            iconSize: 10,
        },
        medium: {
            container: { height: 36, width: 36 },
            innerCircle: { height: 28, width: 28 },
            fontSize: 14,
            labelSize: 12,
            iconSize: 14,
        },
        large: {
            container: { height: 52, width: 52 },
            innerCircle: { height: 44, width: 44 },
            fontSize: 18,
            labelSize: 14,
            iconSize: 18,
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
                    <Ionicons name="shield-checkmark" size={sizeStyle.iconSize} color={color} />
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
        borderWidth: 2,
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
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    label: {
        marginLeft: 4,
        fontWeight: '500',
    },
}); 