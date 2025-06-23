import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { colors } from '@/styles/colors';
import { useProfileRedux } from '@/hooks/useProfileQueries';

type TrustFactor = {
    type: string;
    value: number;
    maxValue: number;
    label: string;
};

type TrustScoreProps = {
    score: number; // 0-100 score
    size?: 'small' | 'medium' | 'large';
    showLabel?: boolean;
    factors?: TrustFactor[];
    showDetails?: boolean;
    onRecalculate?: () => void;
};

export function TrustScore({
    score,
    size = 'medium',
    showLabel = true,
    factors = [],
    showDetails = false,
    onRecalculate,
}: TrustScoreProps) {
    const { updateProfile, isLoading } = useProfileRedux();

    // Memoize expensive calculations
    const { color, trustLevel, sizeStyle } = useMemo(() => {
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

        return {
            color: getColor(score),
            trustLevel: getTrustLevel(score),
            sizeStyle: sizeStyles[size],
        };
    }, [score, size]);

    // Memoize factor color calculation
    const getFactorColor = useCallback((value: number, maxValue: number) => {
        const percentage = (value / maxValue) * 100;
        if (percentage >= 80) return '#4CAF50';
        if (percentage >= 60) return '#8BC34A';
        if (percentage >= 40) return '#FFC107';
        if (percentage >= 20) return '#FF9800';
        return '#F44336';
    }, []);

    // Memoize recalculate handler
    const handleRecalculate = useCallback(async () => {
        try {
            // For now, we'll trigger a refetch of profiles which will recalculate trust scores
            // In the future, we can add a specific recalculate action to Redux
            onRecalculate?.();
        } catch (error) {
            console.error('Failed to recalculate trust score:', error);
        }
    }, [onRecalculate]);

    // Memoize factor items to prevent unnecessary re-renders
    const factorItems = useMemo(() => {
        return factors.map((factor, index) => (
            <View key={`${factor.type}-${index}`} style={styles.factorItem}>
                <View style={styles.factorHeader}>
                    <Text style={styles.factorLabel}>{factor.label}</Text>
                    <Text style={styles.factorScore}>
                        {factor.value}/{factor.maxValue}
                    </Text>
                </View>
                <View style={styles.progressBar}>
                    <View
                        style={[
                            styles.progressFill,
                            {
                                width: `${(factor.value / factor.maxValue) * 100}%`,
                                backgroundColor: getFactorColor(factor.value, factor.maxValue)
                            }
                        ]}
                    />
                </View>
            </View>
        ));
    }, [factors, getFactorColor]);

    return (
        <View style={styles.wrapper}>
            <View style={styles.mainContainer}>
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

            {showDetails && factors.length > 0 && (
                <View style={styles.detailsContainer}>
                    <View style={styles.detailsHeader}>
                        <Text style={styles.detailsTitle}>Trust Score Breakdown</Text>
                        <TouchableOpacity
                            style={styles.recalculateButton}
                            onPress={handleRecalculate}
                            disabled={isLoading}
                        >
                            <Text style={styles.recalculateButtonText}>
                                {isLoading ? 'Recalculating...' : 'Recalculate'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.factorsContainer} showsVerticalScrollIndicator={false}>
                        {factorItems}
                    </ScrollView>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        alignItems: 'center',
    },
    mainContainer: {
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
    detailsContainer: {
        marginTop: 20,
        width: '100%',
        maxWidth: 400,
    },
    detailsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    detailsTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.primaryDark,
    },
    recalculateButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    recalculateButtonText: {
        color: 'white',
        fontSize: 12,
        fontWeight: '600',
    },
    factorsContainer: {
        maxHeight: 300,
    },
    factorItem: {
        marginBottom: 16,
    },
    factorHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    factorLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primaryDark,
        flex: 1,
    },
    factorScore: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.primaryDark_1,
    },
    progressBar: {
        height: 6,
        backgroundColor: colors.primaryLight_1,
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 3,
    },
}); 