import React from 'react';
import { View, StyleSheet, TouchableOpacity, Platform, Linking } from 'react-native';
import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { toast } from 'sonner';
import * as Haptics from 'expo-haptics';

const IconComponent = Ionicons as any;

export interface Address {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country?: string;
    coordinates?: {
        lat: number;
        lng: number;
    };
}

interface AddressDisplayProps {
    address: Address;
    variant?: 'compact' | 'detailed' | 'card';
    showActions?: boolean;
    showMap?: boolean;
    onPress?: () => void;
    style?: any;
}

export function AddressDisplay({
    address,
    variant = 'detailed',
    showActions = true,
    showMap = false,
    onPress,
    style
}: AddressDisplayProps) {
    const { t } = useTranslation();

    const formattedAddress = `${address.street || ''}, ${address.city || ''}, ${address.state || ''} ${address.zipCode || ''}`;
    const shortAddress = `${address.city || ''}, ${address.state || ''}`;

    const handleCopyAddress = async () => {
        try {
            await Clipboard.setStringAsync(formattedAddress);
            toast.success(t('Address copied to clipboard'));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
            toast.error(t('Failed to copy address'));
        }
    };

    const handleOpenInMaps = async () => {
        try {
            const url = Platform.select({
                ios: `maps://app?address=${encodeURIComponent(formattedAddress)}`,
                android: `geo:0,0?q=${encodeURIComponent(formattedAddress)}`,
                default: `https://maps.google.com/?q=${encodeURIComponent(formattedAddress)}`
            });

            const supported = await Linking.canOpenURL(url);
            if (supported) {
                await Linking.openURL(url);
            } else {
                await Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(formattedAddress)}`);
            }
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch (error) {
            toast.error(t('Failed to open maps'));
        }
    };

    const handlePress = () => {
        if (onPress) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPress();
        }
    };

    if (variant === 'compact') {
        return (
            <TouchableOpacity
                style={[styles.compactContainer, style]}
                onPress={handlePress}
                disabled={!onPress}
            >
                <IconComponent name="location-outline" size={16} color={colors.COLOR_BLACK_LIGHT_5} />
                <ThemedText style={styles.compactText} numberOfLines={1}>
                    {shortAddress}
                </ThemedText>
                {onPress && (
                    <IconComponent name="chevron-forward" size={16} color={colors.COLOR_BLACK_LIGHT_5} />
                )}
            </TouchableOpacity>
        );
    }

    if (variant === 'card') {
        return (
            <ThemedView style={[styles.cardContainer, style]}>
                <View style={styles.cardHeader}>
                    <View style={styles.addressInfo}>
                        <IconComponent name="location" size={20} color={colors.primaryColor} />
                        <View style={styles.addressTextContainer}>
                            <ThemedText style={styles.cardStreet}>{address.street}</ThemedText>
                            <ThemedText style={styles.cardCityState}>
                                {address.city}, {address.state} {address.zipCode}
                            </ThemedText>
                        </View>
                    </View>
                    {showActions && (
                        <View style={styles.cardActions}>
                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={handleCopyAddress}
                            >
                                <IconComponent name="copy-outline" size={16} color={colors.primaryColor} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={handleOpenInMaps}
                            >
                                <IconComponent name="map-outline" size={16} color={colors.primaryColor} />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
                {showMap && address.coordinates && (
                    <View style={styles.mapPlaceholder}>
                        <IconComponent name="map" size={24} color={colors.COLOR_BLACK_LIGHT_5} />
                        <ThemedText style={styles.mapPlaceholderText}>
                            {t('Map view available')}
                        </ThemedText>
                    </View>
                )}
            </ThemedView>
        );
    }

    // Detailed variant (default)
    return (
        <ThemedView style={[styles.detailedContainer, style]}>
            <View style={styles.detailedHeader}>
                <IconComponent name="location" size={24} color={colors.primaryColor} />
                <View style={styles.detailedAddressInfo}>
                    <ThemedText style={styles.detailedStreet}>{address.street}</ThemedText>
                    <ThemedText style={styles.detailedCityState}>
                        {address.city}, {address.state} {address.zipCode}
                    </ThemedText>
                    {address.country && address.country !== 'USA' && (
                        <ThemedText style={styles.detailedCountry}>{address.country}</ThemedText>
                    )}
                </View>
            </View>

            {showActions && (
                <View style={styles.detailedActions}>
                    <TouchableOpacity
                        style={styles.detailedActionButton}
                        onPress={handleCopyAddress}
                    >
                        <IconComponent name="copy-outline" size={16} color={colors.primaryColor} />
                        <ThemedText style={styles.actionButtonText}>{t('Copy')}</ThemedText>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.detailedActionButton}
                        onPress={handleOpenInMaps}
                    >
                        <IconComponent name="map-outline" size={16} color={colors.primaryColor} />
                        <ThemedText style={styles.actionButtonText}>{t('Open in Maps')}</ThemedText>
                    </TouchableOpacity>
                </View>
            )}
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    // Compact variant styles
    compactContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    compactText: {
        flex: 1,
        marginLeft: 8,
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
    },

    // Card variant styles
    cardContainer: {
        padding: 16,
        borderRadius: 12,
        backgroundColor: colors.COLOR_BLACK_LIGHT_9,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
    },
    addressInfo: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
    },
    addressTextContainer: {
        marginLeft: 12,
        flex: 1,
    },
    cardStreet: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 2,
    },
    cardCityState: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
    },
    cardActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    actionButton: {
        padding: 8,
        marginLeft: 8,
        borderRadius: 6,
        backgroundColor: colors.primaryColor + '10',
    },
    mapPlaceholder: {
        marginTop: 12,
        height: 100,
        backgroundColor: colors.COLOR_BLACK_LIGHT_8,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderStyle: 'dashed',
    },
    mapPlaceholderText: {
        marginTop: 8,
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
    },

    // Detailed variant styles
    detailedContainer: {
        padding: 16,
        borderRadius: 12,
        backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    },
    detailedHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    detailedAddressInfo: {
        marginLeft: 12,
        flex: 1,
    },
    detailedStreet: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 4,
    },
    detailedCityState: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 2,
    },
    detailedCountry: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
    },
    detailedActions: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    detailedActionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: colors.primaryColor + '10',
        borderRadius: 8,
        flex: 1,
        marginHorizontal: 4,
        justifyContent: 'center',
    },
    actionButtonText: {
        marginLeft: 8,
        fontSize: 14,
        fontWeight: '500',
        color: colors.primaryColor,
    },
}); 