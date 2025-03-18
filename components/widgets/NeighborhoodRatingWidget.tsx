import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';

interface RatingCategory {
    name: string;
    score: number;
    icon: string;
}

export function NeighborhoodRatingWidget() {
    const { t } = useTranslation();

    // Mock data for neighborhood - this would be dynamic in a real app
    const neighborhoodName = "El Born, Barcelona";
    const overallScore = 4.2;

    const categories: RatingCategory[] = [
        { name: 'Safety', score: 4.5, icon: 'shield-checkmark-outline' },
        { name: 'Dining', score: 4.8, icon: 'restaurant-outline' },
        { name: 'Transit', score: 4.3, icon: 'subway-outline' },
        { name: 'Nightlife', score: 4.0, icon: 'wine-outline' },
        { name: 'Shopping', score: 3.9, icon: 'bag-outline' },
    ];

    // Helper to render stars based on rating
    const renderStars = (rating: number) => {
        const fullStars = Math.floor(rating);
        const halfStar = rating % 1 >= 0.5;
        const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);

        return (
            <View style={styles.starsContainer}>
                {[...Array(fullStars)].map((_, i) => (
                    <Ionicons key={`full-${i}`} name="star" size={14} color="#FFD700" />
                ))}
                {halfStar && <Ionicons name="star-half" size={14} color="#FFD700" />}
                {[...Array(emptyStars)].map((_, i) => (
                    <Ionicons key={`empty-${i}`} name="star-outline" size={14} color="#FFD700" />
                ))}
                <Text style={styles.ratingNumber}>{rating.toFixed(1)}</Text>
            </View>
        );
    };

    return (
        <BaseWidget
            title={t("Neighborhood")}
            icon={<Ionicons name="location" size={22} color={colors.primaryColor} />}
        >
            <View style={styles.container}>
                <View style={styles.headerSection}>
                    <Text style={styles.neighborhoodName}>{neighborhoodName}</Text>
                    <View style={styles.overallRating}>
                        {renderStars(overallScore)}
                    </View>
                </View>

                <View style={styles.categoriesSection}>
                    {categories.map((category, index) => (
                        <View key={index} style={styles.categoryItem}>
                            <View style={styles.categoryInfo}>
                                <Ionicons name={category.icon as any} size={16} color={colors.primaryColor} />
                                <Text style={styles.categoryName}>{category.name}</Text>
                            </View>
                            {renderStars(category.score)}
                        </View>
                    ))}
                </View>

                <TouchableOpacity style={styles.moreButton}>
                    <Text style={styles.moreButtonText}>View Neighborhood Guide</Text>
                </TouchableOpacity>
            </View>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingVertical: 10,
    },
    headerSection: {
        marginBottom: 15,
    },
    neighborhoodName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 5,
    },
    overallRating: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    starsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    ratingNumber: {
        marginLeft: 5,
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    categoriesSection: {
        marginBottom: 15,
    },
    categoryItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    categoryInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    categoryName: {
        marginLeft: 8,
        fontSize: 14,
    },
    moreButton: {
        backgroundColor: '#f0f0f0',
        paddingVertical: 8,
        paddingHorizontal: 15,
        borderRadius: 20,
        alignItems: 'center',
    },
    moreButtonText: {
        color: colors.primaryColor,
        fontWeight: '600',
        fontSize: 14,
    },
}); 