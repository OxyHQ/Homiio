import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNotifications } from '@/context/NotificationContext';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { ThemedText } from './ThemedText';

interface NotificationBadgeProps {
    size?: 'small' | 'medium' | 'large';
    showCount?: boolean;
    onPress?: () => void;
    style?: any;
    iconName?: string;
    iconSize?: number;
    iconColor?: string;
}

export function NotificationBadge({
    size = 'medium',
    showCount = true,
    onPress,
    style,
    iconName = 'notifications-outline',
    iconSize,
    iconColor = colors.text,
}: NotificationBadgeProps) {
    const { unreadCount, badgeCount } = useNotifications();
    const router = useRouter();

    const handlePress = () => {
        if (onPress) {
            onPress();
        } else {
            router.push('/notifications');
        }
    };

    const getBadgeSize = () => {
        switch (size) {
            case 'small':
                return { container: 16, text: 10 };
            case 'large':
                return { container: 24, text: 14 };
            default:
                return { container: 20, text: 12 };
        }
    };

    const getIconSizeValue = () => {
        if (iconSize) return iconSize;
        switch (size) {
            case 'small':
                return 16;
            case 'large':
                return 28;
            default:
                return 24;
        }
    };

    const badgeSize = getBadgeSize();
    const iconSizeValue = getIconSizeValue();
    const count = unreadCount || badgeCount;

    return (
        <TouchableOpacity onPress={handlePress} style={[styles.container, style]}>
            <Ionicons
                name={iconName as any}
                size={iconSizeValue}
                color={iconColor}
            />
            {showCount && count > 0 && (
                <View style={[
                    styles.badge,
                    {
                        width: badgeSize.container,
                        height: badgeSize.container,
                        borderRadius: badgeSize.container / 2,
                    }
                ]}>
                    <ThemedText style={[
                        styles.badgeText,
                        { fontSize: badgeSize.text }
                    ]}>
                        {count > 99 ? '99+' : count.toString()}
                    </ThemedText>
                </View>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -4,
        backgroundColor: colors.error,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 16,
        paddingHorizontal: 2,
    },
    badgeText: {
        color: colors.white,
        fontFamily: 'Inter-Bold',
        textAlign: 'center',
        lineHeight: 12,
    },
});
