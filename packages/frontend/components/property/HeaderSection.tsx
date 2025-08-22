import React from 'react';
import { View, Image, Platform, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import type { PropertyImage } from '@homiio/shared-types';

interface HeaderSectionProps {
    title: string;
    location: string;
    bedrooms: number;
    bathrooms: number;
    size: number;
    images: (string | PropertyImage)[];
}

export const HeaderSection: React.FC<HeaderSectionProps> = ({
    title,
    location,
    bedrooms,
    bathrooms,
    size,
    images,
}) => {
    return (
        <>
            <Image
                source={getPropertyImageSource(images)}
                style={Platform.OS === 'web' ? styles.mainImageWeb : styles.mainImage}
                resizeMode="cover"
            />
            <View style={styles.enhancedHeader}>
                <ThemedText style={styles.headerTitle} numberOfLines={2}>
                    {title}
                </ThemedText>
                <View style={styles.headerLocation}>
                    <ThemedText style={styles.headerLocationText}>{location}</ThemedText>
                </View>
                <View style={styles.headerStats}>
                    <View style={styles.headerStat}>
                        <ThemedText style={styles.headerStatText}>{bedrooms} Bed</ThemedText>
                    </View>
                    <View style={styles.headerStat}>
                        <ThemedText style={styles.headerStatText}>{bathrooms} Bath</ThemedText>
                    </View>
                    <View style={styles.headerStat}>
                        <ThemedText style={styles.headerStatText}>{size}m²</ThemedText>
                    </View>
                </View>
            </View>
        </>
    );
};

const styles = StyleSheet.create({
    enhancedHeader: {
        backgroundColor: colors.primaryLight,
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    headerLocation: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    headerLocationText: {
        marginLeft: 5,
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    headerStats: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerStat: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerStatText: {
        marginLeft: 5,
        fontSize: 14,
    },
    mainImage: {
        width: '100%',
        height: 300,
        marginTop: -50,
    } as any,
    mainImageWeb: {
        width: '100%',
        height: 300,
        marginTop: -80,
    } as any,
});
