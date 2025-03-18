import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';

interface PropertyItem {
    id: string;
    title: string;
    location: string;
    price: string;
    imageUrl: string;
    isEcoCertified?: boolean;
}

export function RecentlyViewedWidget() {
    const { t } = useTranslation();
    const router = useRouter();

    // Mock data for recently viewed properties
    const recentProperties: PropertyItem[] = [
        {
            id: '101',
            title: 'Modern Loft in City Center',
            location: 'Madrid, Spain',
            price: '⊜950/month',
            imageUrl: 'https://via.placeholder.com/80',
            isEcoCertified: true
        },
        {
            id: '102',
            title: 'Cozy Studio near Beach',
            location: 'Barcelona, Spain',
            price: '⊜800/month',
            imageUrl: 'https://via.placeholder.com/80'
        },
        {
            id: '103',
            title: 'Spacious Apartment with Terrace',
            location: 'Berlin, Germany',
            price: '⊜1,200/month',
            imageUrl: 'https://via.placeholder.com/80',
            isEcoCertified: true
        }
    ];

    const navigateToProperty = (propertyId: string) => {
        router.push(`/properties/${propertyId}`);
    };

    return (
        <BaseWidget
            title={t("Recently Viewed")}
            icon={<Ionicons name="time-outline" size={22} color={colors.primaryColor} />}
        >
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
            >
                {recentProperties.map((property) => (
                    <TouchableOpacity
                        key={property.id}
                        style={styles.propertyCard}
                        onPress={() => navigateToProperty(property.id)}
                    >
                        <Image
                            source={{ uri: property.imageUrl }}
                            style={styles.propertyImage}
                        />

                        <View style={styles.propertyInfo}>
                            <View style={styles.propertyHeader}>
                                <Text style={styles.propertyTitle} numberOfLines={1}>
                                    {property.title}
                                </Text>
                                {property.isEcoCertified && (
                                    <Ionicons name="leaf" size={14} color="green" />
                                )}
                            </View>

                            <Text style={styles.propertyLocation} numberOfLines={1}>
                                {property.location}
                            </Text>

                            <Text style={styles.propertyPrice}>
                                {property.price}
                            </Text>
                        </View>
                    </TouchableOpacity>
                ))}

                <TouchableOpacity
                    style={styles.viewAllButton}
                    onPress={() => router.push('/properties/history')}
                >
                    <Text style={styles.viewAllText}>View All</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.primaryColor} />
                </TouchableOpacity>
            </ScrollView>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    container: {
        marginVertical: 5,
    },
    scrollContent: {
        paddingRight: 20,
    },
    propertyCard: {
        width: 140,
        marginRight: 12,
        borderRadius: 8,
        backgroundColor: 'white',
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
        overflow: 'hidden',
    },
    propertyImage: {
        width: '100%',
        height: 90,
        backgroundColor: '#e1e1e1',
    },
    propertyInfo: {
        padding: 8,
    },
    propertyHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    propertyTitle: {
        fontSize: 13,
        fontWeight: '600',
        flex: 1,
        marginRight: 4,
    },
    propertyLocation: {
        fontSize: 11,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 4,
    },
    propertyPrice: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primaryColor,
    },
    viewAllButton: {
        width: 80,
        height: 140,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderStyle: 'dashed',
        flexDirection: 'column',
    },
    viewAllText: {
        color: colors.primaryColor,
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 4,
    },
}); 