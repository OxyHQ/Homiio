import React from 'react';
import { View, Image, Platform, StyleSheet } from 'react-native';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';
import { barContent, spacing } from '@/constants/styles';
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
                source={getPropertyImageSource(images[0], 'large')}
                style={Platform.OS === 'web' ? styles.mainImageWeb : styles.mainImage}
                resizeMode="cover"
            />
            <View style={styles.enhancedHeader}>
                <BloomText className="text-2xl font-bold text-foreground" numberOfLines={2}>
                    {title}
                </BloomText>
                <BloomText className="text-base text-muted-foreground">{location}</BloomText>
                <View style={styles.headerStats}>
                    <BloomText className="text-sm text-foreground">{bedrooms} Bed</BloomText>
                    <BloomText className="text-sm text-foreground">{bathrooms} Bath</BloomText>
                    <BloomText className="text-sm text-foreground">{size}m²</BloomText>
                </View>
            </View>
        </>
    );
};

const styles = StyleSheet.create({
    // Hero identity block — adopts the shared bar clamp so it lines up with the
    // sticky header, on one `spacing` gap rhythm (no per-line margins).
    enhancedHeader: {
        ...barContent,
        backgroundColor: colors.primaryLight,
        padding: spacing.xl,
        gap: spacing.md,
    },
    headerStats: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    mainImage: {
        width: '100%',
        height: 300,
        marginTop: -50,
    },
    mainImageWeb: {
        width: '100%',
        height: 300,
        marginTop: -80,
    },
});
