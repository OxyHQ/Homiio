import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

export type EcoRating = 'A+' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type EcoFeature = 'solar' | 'water' | 'insulation' | 'recycling' | 'materials' | 'heating';

type EcoCertificationProps = {
    rating: EcoRating;
    features?: EcoFeature[];
    compact?: boolean;
};

const ecoFeatureInfo = {
    solar: {
        icon: 'sunny-outline',
        label: 'Solar Energy',
    },
    water: {
        icon: 'water-outline',
        label: 'Water Efficiency',
    },
    insulation: {
        icon: 'thermometer-outline',
        label: 'Insulation',
    },
    recycling: {
        icon: 'repeat-outline',
        label: 'Recycling',
    },
    materials: {
        icon: 'leaf-outline',
        label: 'Sustainable Materials',
    },
    heating: {
        icon: 'flame-outline',
        label: 'Efficient Heating',
    },
};

export function EcoCertification({
    rating,
    features = [],
    compact = false,
}: EcoCertificationProps) {
    // Get the color based on energy rating
    const getRatingColor = (rating: EcoRating) => {
        switch (rating) {
            case 'A+':
            case 'A':
                return '#4CAF50';
            case 'B':
                return '#8BC34A';
            case 'C':
                return '#CDDC39';
            case 'D':
                return '#FFC107';
            case 'E':
                return '#FF9800';
            case 'F':
                return '#FF5722';
            case 'G':
                return '#F44336';
            default:
                return '#9E9E9E';
        }
    };

    const ratingColor = getRatingColor(rating);

    if (compact) {
        return (
            <View style={styles.compactContainer}>
                <View style={[styles.ratingBadge, { backgroundColor: ratingColor }]}>
                    <Text style={styles.ratingText}>{rating}</Text>
                </View>
                <Text style={styles.compactLabel}>Eco-Certified</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Ionicons name="leaf" size={24} color="#4CAF50" />
                <Text style={styles.title}>Eco-Certified Property</Text>
            </View>

            <View style={styles.ratingContainer}>
                <Text style={styles.ratingLabel}>Energy Rating</Text>
                <View style={[styles.ratingBadge, { backgroundColor: ratingColor }]}>
                    <Text style={styles.ratingText}>{rating}</Text>
                </View>
            </View>

            {features.length > 0 && (
                <View style={styles.featuresContainer}>
                    <Text style={styles.featuresTitle}>Sustainability Features</Text>
                    <View style={styles.featuresList}>
                        {features.map((feature, index) => (
                            <View key={index} style={styles.featureItem}>
                                <Ionicons
                                    name={ecoFeatureInfo[feature].icon as any}
                                    size={16}
                                    color="#4CAF50"
                                />
                                <Text style={styles.featureText}>{ecoFeatureInfo[feature].label}</Text>
                            </View>
                        ))}
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#F1F8E9',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#C8E6C9',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2E7D32',
        marginLeft: 8,
    },
    ratingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    ratingLabel: {
        fontSize: 14,
        color: colors.primaryDark,
    },
    ratingBadge: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    ratingText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
    featuresContainer: {
        marginTop: 4,
    },
    featuresTitle: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.primaryDark,
        marginBottom: 8,
    },
    featuresList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    featureItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        marginRight: 8,
        marginBottom: 8,
    },
    featureText: {
        fontSize: 12,
        color: colors.primaryDark,
        marginLeft: 4,
    },
    compactContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    compactLabel: {
        fontSize: 12,
        fontWeight: '500',
        color: '#4CAF50',
        marginLeft: 8,
    },
}); 