import React, { useEffect, useState } from 'react'
import { View, StyleSheet, Text, Platform, TouchableOpacity, GestureResponderEvent, ActivityIndicator, Image } from "react-native";
import { Link } from "expo-router";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from 'react-responsive'
import { colors } from '../styles/colors'
import { SearchBar } from './SearchBar'
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from '@expo/vector-icons';

export function RightBar() {
    const isRightBarVisible = useMediaQuery({ minWidth: 990 });
    const pathname = usePathname();
    const isPropertiesPage = pathname === '/properties';
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { t } = useTranslation();

    useEffect(() => {
        const fakeLoading = () => {
            setLoading(true);
            setTimeout(() => {
                setLoading(false);
            }, 1000);
        };
        
        fakeLoading();
    }, []);

    if (!isRightBarVisible) return null;

    return (
        <View style={styles.container}>
            <SearchBar />
            
            {/* Trust Score Widget */}
            <View style={styles.widgetContainer}>
                <View style={styles.widgetHeader}>
                    <Text style={styles.widgetTitle}>
                        {t("Trust Score")}
                    </Text>
                    <Ionicons name="shield-checkmark" size={22} color={colors.primaryColor} />
                </View>
                <View style={styles.trustScoreContent}>
                    <View style={styles.scoreCircle}>
                        <Text style={styles.scoreNumber}>87</Text>
                    </View>
                    <Text style={styles.trustScoreText}>Your trust score is Good</Text>
                    <TouchableOpacity style={styles.improveButton}>
                        <Text style={styles.improveButtonText}>Improve Score</Text>
                    </TouchableOpacity>
                </View>
            </View>
            
            {/* Featured Properties */}
            {!isPropertiesPage && (
                <View style={styles.widgetContainer}>
                    <View style={styles.widgetHeader}>
                        <Text style={styles.widgetTitle}>
                            {t("Featured Properties")}
                        </Text>
                    </View>
                    <View>
                        {loading ? (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="small" color={colors.primaryColor} />
                                <Text style={styles.loadingText}>Loading properties...</Text>
                            </View>
                        ) : (
                            <FeaturedProperties />
                        )}
                    </View>
                </View>
            )}
            
            {/* Eco Certification */}
            <View style={styles.widgetContainer}>
                <View style={styles.widgetHeader}>
                    <Text style={styles.widgetTitle}>
                        {t("Eco Certified")}
                    </Text>
                    <Ionicons name="leaf" size={22} color="green" />
                </View>
                <View style={styles.ecoCertContent}>
                    <Text style={styles.ecoText}>
                        Properties with this badge meet our sustainability standards
                    </Text>
                    <TouchableOpacity style={styles.learnMoreButton}>
                        <Text style={styles.learnMoreText}>Learn More</Text>
                    </TouchableOpacity>
                </View>
            </View>
            
            {/* Horizon Membership */}
            <View style={styles.widgetContainer}>
                <View style={styles.widgetHeader}>
                    <Text style={styles.widgetTitle}>
                        {t("Horizon Membership")}
                    </Text>
                    <Ionicons name="star" size={22} color="#FFD700" />
                </View>
                <Text style={styles.membershipText}>
                    Join Horizon to get access to premium properties and priority verification.
                </Text>
                <TouchableOpacity style={styles.joinButton}>
                    <Text style={styles.joinButtonText}>Join Horizon</Text>
                </TouchableOpacity>
            </View>
        </View>
    )
}

function FeaturedProperties() {
    const router = useRouter();
    const propertyItems = [
        {
            id: '1',
            title: 'Modern Studio in City Center',
            location: 'Barcelona, Spain',
            price: '€850/month',
            isEcoCertified: true,
            rating: 4.8
        },
        {
            id: '2',
            title: 'Co-living Space with Garden',
            location: 'Berlin, Germany',
            price: '€550/month',
            isEcoCertified: true,
            rating: 4.9
        }
    ];

    return (
        <>
            {propertyItems.map((property) => (
                <Link href={`/properties/${property.id}`} key={property.id} asChild>
                    <TouchableOpacity style={styles.propertyItem}>
                        <View style={styles.propertyImagePlaceholder}>
                            <Text style={styles.propertyImageText}>Property Image</Text>
                        </View>
                        <View style={styles.propertyContent}>
                            <View style={styles.propertyHeader}>
                                <Text style={styles.propertyTitle} numberOfLines={1}>{property.title}</Text>
                                {property.isEcoCertified && (
                                    <Ionicons name="leaf" size={16} color="green" />
                                )}
                            </View>
                            <Text style={styles.propertyLocation}>{property.location}</Text>
                            <View style={styles.propertyFooter}>
                                <Text style={styles.propertyPrice}>{property.price}</Text>
                                <View style={styles.ratingContainer}>
                                    <Ionicons name="star" size={14} color="#FFD700" />
                                    <Text style={styles.ratingText}>{property.rating}</Text>
                                </View>
                            </View>
                        </View>
                    </TouchableOpacity>
                </Link>
            ))}
            <TouchableOpacity
                onPress={() => router.push('/properties')}
                style={styles.showMoreButton}
                activeOpacity={0.7}>
                <Text style={styles.showMoreText}>
                    View All Properties
                </Text>
            </TouchableOpacity>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        width: 350,
        paddingStart: 20,
        flexDirection: 'column',
        gap: 20,
        ...Platform.select({
            web: {
                position: 'sticky' as any,
                top: 50,
                bottom: 20,
            },
        }),
    },
    loadingContainer: {
        padding: 15,
        alignItems: 'center',
        borderRadius: 15,
        gap: 10,
    },
    loadingText: {
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    errorContainer: {
        padding: 15,
        backgroundColor: colors.primaryLight,
        borderRadius: 15,
    },
    errorText: {
        color: 'red',
    },
    widgetContainer: {
        backgroundColor: colors.primaryLight,
        borderRadius: 15,
        overflow: 'hidden',
        padding: 15,
    },
    widgetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
        marginBottom: 12,
    },
    widgetTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    trustScoreContent: {
        alignItems: 'center',
        padding: 10,
    },
    scoreCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: colors.primaryColor,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 15,
    },
    scoreNumber: {
        color: 'white',
        fontSize: 24,
        fontWeight: 'bold',
    },
    trustScoreText: {
        fontSize: 16,
        marginBottom: 15,
    },
    improveButton: {
        backgroundColor: '#f0f0f0',
        paddingVertical: 8,
        paddingHorizontal: 15,
        borderRadius: 20,
    },
    improveButtonText: {
        color: colors.primaryColor,
        fontWeight: '600',
    },
    propertyItem: {
        flexDirection: 'row',
        marginBottom: 15,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
        paddingBottom: 15,
    },
    propertyImagePlaceholder: {
        width: 80,
        height: 80,
        backgroundColor: '#e1e1e1',
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    propertyImageText: {
        color: '#666',
        fontSize: 12,
    },
    propertyContent: {
        flex: 1,
        marginLeft: 10,
        justifyContent: 'space-between',
    },
    propertyHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    propertyTitle: {
        fontWeight: 'bold',
        fontSize: 15,
        flex: 1,
        marginRight: 5,
    },
    propertyLocation: {
        color: colors.COLOR_BLACK_LIGHT_4,
        fontSize: 13,
        marginTop: 4,
    },
    propertyFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
    },
    propertyPrice: {
        fontWeight: '600',
        color: colors.primaryColor,
    },
    ratingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    ratingText: {
        marginLeft: 3,
        fontSize: 13,
    },
    showMoreButton: {
        padding: 12,
        backgroundColor: '#f5f5f5',
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 5,
    },
    showMoreText: {
        color: colors.primaryColor,
        fontWeight: '600',
    },
    ecoCertContent: {
        padding: 10,
        alignItems: 'center',
    },
    ecoText: {
        textAlign: 'center',
        marginBottom: 15,
        lineHeight: 20,
    },
    learnMoreButton: {
        paddingVertical: 8,
        paddingHorizontal: 15,
        backgroundColor: '#e7f4e4',
        borderRadius: 20,
    },
    learnMoreText: {
        color: 'green',
        fontWeight: '600',
    },
    membershipText: {
        marginBottom: 15,
        lineHeight: 20,
    },
    joinButton: {
        backgroundColor: '#FFD700',
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: 'center',
    },
    joinButtonText: {
        color: '#333',
        fontWeight: 'bold',
    },
});
