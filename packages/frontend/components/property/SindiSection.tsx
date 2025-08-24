import React, { useContext } from 'react';
import {
    View,
    TouchableOpacity,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { SindiIcon } from '@/assets/icons';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SindiChatBottomSheet } from './SindiChatBottomSheet';
import { Property } from '@homiio/shared-types';

const IconComponent = Ionicons as any;

interface SindiSectionProps {
    property: Property;
}

export function SindiSection({ property }: SindiSectionProps) {
    const bottomSheet = useContext(BottomSheetContext);

    const handleOpenSindi = () => {
        bottomSheet.openBottomSheet(
            <SindiChatBottomSheet
                property={property}
                onClose={bottomSheet.closeBottomSheet}
            />
        );
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.iconContainer}>
                    <SindiIcon size={24} color={colors.primaryColor} />
                </View>
                <View style={styles.textContainer}>
                    <ThemedText style={styles.title}>Ask Sindi</ThemedText>
                    <ThemedText style={styles.subtitle}>
                        Get instant answers about this property, rental rights, and lease terms
                    </ThemedText>
                </View>
            </View>

            <TouchableOpacity style={styles.button} onPress={handleOpenSindi}>
                <IconComponent name="chatbubble-outline" size={20} color={colors.primaryColor} />
                <ThemedText style={styles.buttonText}>Start conversation</ThemedText>
                <IconComponent name="chevron-forward" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
            </TouchableOpacity>

            <View style={styles.featuresContainer}>
                <View style={styles.feature}>
                    <IconComponent name="help-circle-outline" size={16} color={colors.primaryColor} />
                    <ThemedText style={styles.featureText}>Rental advice</ThemedText>
                </View>
                <View style={styles.feature}>
                    <IconComponent name="document-text-outline" size={16} color={colors.primaryColor} />
                    <ThemedText style={styles.featureText}>Lease analysis</ThemedText>
                </View>
                <View style={styles.feature}>
                    <IconComponent name="shield-checkmark-outline" size={16} color={colors.primaryColor} />
                    <ThemedText style={styles.featureText}>Rights protection</ThemedText>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#f0f0f0',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: `${colors.primaryColor}15`,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        lineHeight: 20,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: `${colors.primaryColor}08`,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: `${colors.primaryColor}20`,
        marginBottom: 16,
    },
    buttonText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '500',
        color: colors.primaryColor,
        marginLeft: 8,
    },
    featuresContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    feature: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    featureText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginLeft: 4,
    },
});
