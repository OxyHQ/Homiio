import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

export type ActionButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

type ActionButtonProps = {
    icon: string;
    text: string;
    onPress: () => void;
    variant?: ActionButtonVariant;
    size?: 'small' | 'medium' | 'large';
    disabled?: boolean;
    loading?: boolean;
    style?: ViewStyle;
    iconSize?: number;
    textStyle?: any;
};

export function ActionButton({
    icon,
    text,
    onPress,
    variant = 'primary',
    size = 'medium',
    disabled = false,
    loading = false,
    style,
    iconSize,
    textStyle,
}: ActionButtonProps) {
    const getVariantStyles = (variant: ActionButtonVariant) => {
        switch (variant) {
            case 'primary':
                return {
                    container: {
                        backgroundColor: colors.primaryColor,
                        borderColor: colors.primaryColor,
                    },
                    text: { color: 'white' },
                    icon: { color: 'white' },
                };
            case 'secondary':
                return {
                    container: {
                        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
                        borderColor: colors.COLOR_BLACK_LIGHT_6,
                    },
                    text: { color: colors.primaryDark },
                    icon: { color: colors.primaryDark },
                };
            case 'outline':
                return {
                    container: {
                        backgroundColor: 'transparent',
                        borderColor: colors.primaryColor,
                        borderWidth: 1,
                    },
                    text: { color: colors.primaryColor },
                    icon: { color: colors.primaryColor },
                };
            case 'ghost':
                return {
                    container: {
                        backgroundColor: 'transparent',
                        borderColor: 'transparent',
                    },
                    text: { color: colors.primaryColor },
                    icon: { color: colors.primaryColor },
                };
            case 'danger':
                return {
                    container: {
                        backgroundColor: '#F44336',
                        borderColor: '#F44336',
                    },
                    text: { color: 'white' },
                    icon: { color: 'white' },
                };
            default:
                return {
                    container: {
                        backgroundColor: colors.primaryColor,
                        borderColor: colors.primaryColor,
                    },
                    text: { color: 'white' },
                    icon: { color: 'white' },
                };
        }
    };

    const getSizeStyles = (size: 'small' | 'medium' | 'large') => {
        switch (size) {
            case 'small':
                return {
                    container: { paddingHorizontal: 8, paddingVertical: 6 },
                    icon: 14,
                    text: { fontSize: 12 },
                };
            case 'medium':
                return {
                    container: { paddingHorizontal: 12, paddingVertical: 8 },
                    icon: 16,
                    text: { fontSize: 14 },
                };
            case 'large':
                return {
                    container: { paddingHorizontal: 16, paddingVertical: 12 },
                    icon: 18,
                    text: { fontSize: 16 },
                };
            default:
                return {
                    container: { paddingHorizontal: 12, paddingVertical: 8 },
                    icon: 16,
                    text: { fontSize: 14 },
                };
        }
    };

    const variantStyles = getVariantStyles(variant);
    const sizeStyles = getSizeStyles(size);
    const finalIconSize = iconSize || sizeStyles.icon;

    return (
        <TouchableOpacity
            style={[
                styles.container,
                variantStyles.container,
                sizeStyles.container,
                disabled && styles.disabled,
                style,
            ]}
            onPress={onPress}
            disabled={disabled || loading}
            activeOpacity={0.7}
        >
            {loading ? (
                <IconComponent
                    name="reload"
                    size={finalIconSize}
                    color={variantStyles.icon.color}
                    style={[styles.loadingIcon, { color: variantStyles.icon.color }]}
                />
            ) : (
                <IconComponent
                    name={icon}
                    size={finalIconSize}
                    color={variantStyles.icon.color}
                    style={styles.icon}
                />
            )}
            <Text style={[
                styles.text,
                variantStyles.text,
                sizeStyles.text,
                textStyle,
            ]}>
                {text}
            </Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 25,
        minHeight: 36,
    },
    icon: {
        marginRight: 6,
    },
    loadingIcon: {
        marginRight: 6,
    },
    text: {
        fontWeight: '500',
        fontFamily: 'Phudu',
    },
    disabled: {
        opacity: 0.5,
    },
}); 