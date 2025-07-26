import React, { useRef, useState, isValidElement } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { PropertyCard } from './PropertyCard';
import { LinearGradient } from 'expo-linear-gradient';
import type { Property } from '@homiio/shared-types';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { phuduFontWeights } from '@/styles/fonts';

export interface HomePropertyCarouselSectionProps {
    title: string;
    properties: Property[];
    loading: boolean;
    onCardPress: (property: Property) => void;
    leftBadgeContent?: React.ReactNode;
    rightBadgeContent?: React.ReactNode;
}

// Helper to check if a React element is a TouchableOpacity
function isTouchableElement(element: React.ReactElement): boolean {
    // Check for displayName or type name
    const type = element.type as any;
    return (
        type === TouchableOpacity ||
        type?.displayName === 'TouchableOpacity' ||
        type?.name === 'TouchableOpacity'
    );
}

export const HomePropertyCarouselSection: React.FC<HomePropertyCarouselSectionProps> = ({
    title,
    properties,
    loading,
    onCardPress,
    leftBadgeContent,
    rightBadgeContent,
}) => {
    const carouselRef = useRef<ScrollView>(null);
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [cardWidth, setCardWidth] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    const itemsPerPage = 2;
    // Calculate the maximum index so the last card is fully in view
    const leftSpacer = 15;
    const totalContentWidth = properties.length * cardWidth + leftSpacer;
    const maxScroll = Math.max(0, totalContentWidth - containerWidth);
    const maxCarouselIndex = cardWidth > 0 ? Math.max(0, Math.ceil((totalContentWidth - containerWidth) / cardWidth)) : 0;
    const handleScroll = cardWidth > 0 ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x;
        const clampedScroll = Math.min(x, maxScroll);
        const clampedIndex = Math.max(0, Math.round(clampedScroll / cardWidth));
        setCarouselIndex(clampedIndex);
    } : undefined;

    const handleScrollLeft = () => {
        if (carouselIndex > 0) {
            const newIndex = Math.max(0, carouselIndex - 1);
            setCarouselIndex(newIndex);
            if (cardWidth > 0) {
                const scrollX = Math.min(newIndex * cardWidth, maxScroll);
                carouselRef.current?.scrollTo({ x: scrollX, animated: true });
            }
        }
    };

    const handleScrollRight = () => {
        if (carouselIndex < maxCarouselIndex) {
            const newIndex = Math.min(maxCarouselIndex, carouselIndex + 1);
            setCarouselIndex(newIndex);
            if (cardWidth > 0) {
                const scrollX = Math.min(newIndex * cardWidth, maxScroll);
                carouselRef.current?.scrollTo({ x: scrollX, animated: true });
            }
        }
    };

    return (
        <View style={styles.featuredSection}>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity
                        onPress={handleScrollLeft}
                        disabled={carouselIndex === 0}
                        style={[
                            styles.arrowButton,
                            { opacity: carouselIndex === 0 ? 0.3 : 1, marginRight: 8 },
                        ]}
                    >
                        <Ionicons name="chevron-back" size={20} color="#2563eb" />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={handleScrollRight}
                        disabled={carouselIndex >= maxCarouselIndex}
                        style={[
                            styles.arrowButton,
                            { opacity: carouselIndex >= maxCarouselIndex ? 0.3 : 1 },
                        ]}
                    >
                        <Ionicons name="chevron-forward" size={20} color="#2563eb" />
                    </TouchableOpacity>
                </View>
            </View>
            {loading ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.horizontalScroll}
                    contentContainerStyle={{}}
                >
                    {Array.from({ length: 4 }).map((_, index) => (
                        <View key={index} style={styles.propertyCardContainer}>
                            <View style={styles.propertyCardSkeleton}>
                                {/* Image skeleton */}
                                <View style={styles.propertyCardImageSkeleton}>
                                    <LinearGradient
                                        colors={['#f0f0f0', '#e0e0e0']}
                                        style={{ width: '100%', height: '100%' }}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                    />
                                    {/* Save button skeleton */}
                                    <View style={styles.propertyCardSaveButtonSkeleton} />
                                    {/* Badge skeleton */}
                                    <View style={styles.propertyCardBadgeSkeleton} />
                                </View>
                                {/* Content skeleton */}
                                <View style={styles.propertyCardContentSkeleton}>
                                    {/* Title skeleton */}
                                    <View style={{ backgroundColor: '#e0e0e0', height: 18, borderRadius: 4, width: '85%', marginBottom: 6 }} />
                                    {/* Location skeleton */}
                                    <View style={{ backgroundColor: '#f0f0f0', height: 14, borderRadius: 4, width: '70%', marginBottom: 8 }} />
                                    {/* Price and rating row */}
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <View style={{ backgroundColor: '#e0e0e0', height: 16, borderRadius: 4, width: '40%' }} />
                                        <View style={{ backgroundColor: '#f0f0f0', height: 14, borderRadius: 4, width: '25%' }} />
                                    </View>
                                </View>
                            </View>
                        </View>
                    ))}
                </ScrollView>
            ) : properties.length > 0 ? (
                <View
                    style={{ flexDirection: 'row', alignItems: 'center' }}
                    onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
                >
                    <ScrollView
                        ref={carouselRef}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.horizontalScroll}
                        contentContainerStyle={{}}
                        scrollEnabled={true}
                        onMomentumScrollEnd={cardWidth > 0 ? (e) => {
                            const x = e.nativeEvent.contentOffset.x;
                            const clampedScroll = Math.min(x, maxScroll);
                            const clampedIndex = Math.max(0, Math.round(clampedScroll / cardWidth));
                            setCarouselIndex(clampedIndex);
                        } : undefined}
                        onScroll={handleScroll}
                        scrollEventThrottle={16}
                    >
                        {/* Left spacer for visual balance */}
                        <View style={{ width: 15 }} />
                        {properties.map((property, idx) => (
                            <View
                                key={property._id || property.id}
                                style={styles.propertyCardContainer}
                                onLayout={idx === 0 ? (e) => {
                                    const { width } = e.nativeEvent.layout;
                                    // Add marginRight (from style) to width
                                    setCardWidth(width + 15);
                                } : undefined}
                            >
                                <PropertyCard
                                    property={property}
                                    variant="featured"
                                    onPress={() => onCardPress(property)}
                                    badgeContent={
                                        property.amenities?.includes('verified') && (
                                            <View style={styles.verifiedBadge}>
                                                <Text style={styles.verifiedBadgeText}>VERIFIED</Text>
                                            </View>
                                        )
                                    }
                                />
                            </View>
                        ))}
                    </ScrollView>
                </View>
            ) : (
                <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>No properties available</Text>
                    <Text style={styles.emptySubtext}>Check back later for new listings</Text>
                </View>
            )}
        </View>
    );
};

// You can copy the relevant styles from index.tsx or import them if shared
const styles = StyleSheet.create({
    featuredSection: {
        paddingVertical: 12,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
        paddingHorizontal: 16,
    },
    sectionTitle: {
        fontSize: 24,
        color: colors.COLOR_BLACK,
        fontFamily: phuduFontWeights.semiBold,
        letterSpacing: -0.3,
    },
    horizontalScroll: {
        flexDirection: 'row',
    },
    propertyCardContainer: {
        marginRight: 15,
        width: 280,
    },
    propertyCardSkeleton: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
        width: '100%',
        height: 280,
    },
    propertyCardImageSkeleton: {
        height: 140,
        backgroundColor: '#f0f0f0',
        position: 'relative',
    },
    propertyCardContentSkeleton: {
        padding: 12,
        flex: 1,
        justifyContent: 'space-between',
    },
    propertyCardSaveButtonSkeleton: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#d0d0d0',
    },
    propertyCardBadgeSkeleton: {
        position: 'absolute',
        top: 8,
        left: 8,
        width: 60,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#d0d0d0',
    },
    emptyContainer: {
        alignItems: 'center',
        paddingVertical: 40,
        paddingHorizontal: 16,
    },
    emptyText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#888',
        marginTop: 10,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#bbb',
        marginTop: 5,
    },
    verifiedBadge: {
        position: 'absolute',
        top: 8,
        left: 36,
        zIndex: 2,
    },
    verifiedBadgeText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#fff',
        backgroundColor: '#4CAF50',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    arrowButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2,
        elevation: 2,
    },
}); 