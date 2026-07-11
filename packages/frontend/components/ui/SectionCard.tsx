import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';

interface SectionCardProps {
    /**
     * Optional title to display above the card
     */
    title?: string;

    /**
     * Content to render inside the card
     */
    children: React.ReactNode;

    /**
     * Additional styling for the container
     */
    containerStyle?: ViewStyle;

    /**
     * Additional styling for the card itself
     */
    cardStyle?: ViewStyle;

    /**
     * Additional styling for the title
     */
    titleStyle?: ViewStyle;

    /**
     * Custom padding for the card content
     * @default 16
     */
    padding?: number;

    /**
     * Custom border radius for the card
     * @default 12
     */
    borderRadius?: number;

    /**
     * Custom margin bottom for the container
     * @default 20
     */
    marginBottom?: number;
}

export const SectionCard: React.FC<SectionCardProps> = ({
    title,
    children,
    containerStyle,
    cardStyle,
    titleStyle,
    padding = 16,
    borderRadius = 12,
    marginBottom = 20,
}) => {
    const cardStyles = [
        styles.card,
        {
            padding,
            borderRadius,
        },
        cardStyle,
    ];

    const containerStyles = [
        styles.container,
        { marginBottom },
        containerStyle,
    ];

    return (
        <View style={containerStyles}>
            {title && (
                <ThemedText style={[styles.title, titleStyle]}>
                    {title}
                </ThemedText>
            )}
            <View style={cardStyles}>
                {children}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: 20,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 12,
    },
    card: {
        backgroundColor: colors.white,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: 16,
    },
});

export default SectionCard;
