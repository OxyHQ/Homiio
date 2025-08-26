import React, { useContext } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
} from 'react-native';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import Button from '@/components/Button';
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
                        <SindiIcon size={32} color="#fff" />
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
                        backgroundColor="#fff"
                        textColor={colors.primaryColor}
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
                        style={{
                            backgroundColor: '#f5f5f5',
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 16,
                            flexDirection: 'row',
                            alignItems: 'center',
                        }}
                    >
                        <ThemedText
                            style={{
                                fontSize: 12,
                                color: '#333'
                            }}
                        >
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
        borderRadius: 16,
        padding: 0,
        marginBottom: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 6,
    },
    bannerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20,
    },
    leftSection: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    rightSection: {
        marginLeft: 16,
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    textContainer: {
        flex: 1,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: '#fff',
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
        paddingHorizontal: 16,
        paddingVertical: 12,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        gap: 8,
    },
    featureBadge: {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.4)',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.15,
        shadowRadius: 3,
        elevation: 2,
        alignSelf: 'flex-start',
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '500',
        color: colors.primaryColor,
        lineHeight: 14,
    },
});
