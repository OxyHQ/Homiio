import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

export type VerificationLevel = 'unverified' | 'basic' | 'enhanced' | 'premium';

type VerificationBadgeProps = {
    level: VerificationLevel;
    showText?: boolean;
    size?: 'small' | 'medium' | 'large';
};

export function VerificationBadge({
    level,
    showText = true,
    size = 'medium'
}: VerificationBadgeProps) {
    const badgeInfo = {
        unverified: {
            icon: 'alert-circle',
            color: colors.COLOR_BLACK_LIGHT_3,
            text: 'Unverified',
        },
        basic: {
            icon: 'checkmark-circle',
            color: '#4CAF50',
            text: 'Basic Verification',
        },
        enhanced: {
            icon: 'shield-checkmark',
            color: '#2196F3',
            text: 'Enhanced Verification',
        },
        premium: {
            icon: 'shield-half',
            color: '#673AB7',
            text: 'Premium Verification',
        },
    };

    const sizeStyles = {
        small: {
            container: { padding: 5 },
            icon: 16,
            text: { fontSize: 10 },
        },
        medium: {
            container: { padding: 8 },
            icon: 20,
            text: { fontSize: 12 },
        },
        large: {
            container: { padding: 10 },
            icon: 24,
            text: { fontSize: 14 },
        },
    };

    const { icon, color, text } = badgeInfo[level];
    const sizeStyle = sizeStyles[size];

    return (
        <View style={[styles.container, sizeStyle.container]}>
            <Ionicons name={icon as any} size={sizeStyle.icon} color={color} />
            {showText && <Text style={[styles.text, sizeStyle.text, { color }]}>{text}</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        borderRadius: 20,
        paddingHorizontal: 8,
        paddingVertical: 4,
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
    },
    text: {
        marginLeft: 4,
        fontWeight: '500',
    },
}); 