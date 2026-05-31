import React, { useContext } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
} from 'react-native';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { SECTION_GUTTER } from '@/components/property/Section';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@oxyhq/bloom/button';
import { SindiIcon } from '@/assets/icons';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SindiChatBottomSheet } from './SindiChatBottomSheet';
import { Property } from '@homiio/shared-types';
import { useSindiSuggestions } from '@/hooks/useSindiSuggestions';

interface SindiSectionProps {
    property: Property;
}

export function SindiSection({ property }: SindiSectionProps) {
    const bottomSheet = useContext(BottomSheetContext);
    const { suggestions } = useSindiSuggestions({ property });

    const handleOpenSindi = (initialMessage?: string) => {
        bottomSheet.openBottomSheet(
            <SindiChatBottomSheet
                property={property}
                onClose={bottomSheet.closeBottomSheet}
                initialMessage={initialMessage}
            />
        );
    };

    const handleChatNowPress = () => {
        handleOpenSindi();
    };

    return (
        <View style={styles.bannerContainer}>
            <View style={styles.bannerContent}>
                <View style={styles.leftSection}>
                    <View style={styles.iconContainer}>
                        <SindiIcon size={32} color={colors.primaryForeground} />
                    </View>
                    <View style={styles.textContainer}>
                        <ThemedText style={styles.title}>Ask Sindi AI</ThemedText>
                        <ThemedText style={styles.subtitle}>
                            Your 24/7 rental assistant
                        </ThemedText>
                    </View>
                </View>

                <View style={styles.rightSection}>
                    <Button
                        onPress={handleChatNowPress}
                        variant="inverse"
                        textStyle={{ color: colors.primaryColor }}
                        accessibilityLabel="Start conversation with Sindi AI assistant"
                    >
                        Chat Now
                    </Button>
                </View>
            </View>

            <View style={styles.featuresRow}>
                {suggestions.map((suggestion, index: number) => (
                    <TouchableOpacity
                        key={index}
                        onPress={() => handleOpenSindi(suggestion.text)}
                        style={styles.suggestionChip}
                    >
                        <ThemedText style={styles.suggestionText}>
                            {suggestion.text}
                        </ThemedText>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    bannerContainer: {
        backgroundColor: colors.primaryColor,
        borderRadius: radius.lg,
        marginHorizontal: SECTION_GUTTER,
        overflow: 'hidden',
    },
    bannerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: spacing.xl,
    },
    leftSection: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    rightSection: {
        marginLeft: spacing.lg,
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.lg,
    },
    textContainer: {
        flex: 1,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.primaryForeground,
        marginBottom: 2,
    },
    subtitle: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.9)',
        lineHeight: 18,
    },
    featuresRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        gap: spacing.sm,
    },
    suggestionChip: {
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radius.lg,
        flexDirection: 'row',
        alignItems: 'center',
    },
    suggestionText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
});
