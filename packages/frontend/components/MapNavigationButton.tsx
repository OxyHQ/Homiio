import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';

interface MapNavigationButtonProps {
    style?: any;
    textStyle?: any;
    showIcon?: boolean;
}

export function MapNavigationButton({
    style,
    textStyle,
    showIcon = true
}: MapNavigationButtonProps) {
    const router = useRouter();
    const { t } = useTranslation();

    const handlePress = () => {
        router.push('/properties/map');
    };

    return (
        <TouchableOpacity
            style={[styles.button, style]}
            onPress={handlePress}
            activeOpacity={0.8}
        >
            {showIcon && <Text style={styles.icon}>🗺️</Text>}
            <Text style={[styles.text, textStyle]}>
                {t('View on Map')}
            </Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 25,
        gap: 8,
    },
    icon: {
        fontSize: 16,
    },
    text: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
        fontFamily: 'Phudu',
    },
}); 