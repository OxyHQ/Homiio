import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '@/styles/colors';

type FilterChipProps = {
    label: string;
    selected?: boolean;
    onPress: () => void;
    disabled?: boolean;
    style?: ViewStyle;
    textStyle?: any;
    size?: 'small' | 'medium' | 'large';
};

export function FilterChip({
    label,
    selected = false,
    onPress,
    disabled = false,
    style,
    textStyle,
    size = 'medium',
}: FilterChipProps) {
    const getSizeStyles = (size: 'small' | 'medium' | 'large') => {
        switch (size) {
            case 'small':
                return {
                    container: { paddingHorizontal: 8, paddingVertical: 4 },
                    text: { fontSize: 12 },
                };
            case 'medium':
                return {
                    container: { paddingHorizontal: 12, paddingVertical: 6 },
                    text: { fontSize: 14 },
                };
            case 'large':
                return {
                    container: { paddingHorizontal: 16, paddingVertical: 8 },
                    text: { fontSize: 16 },
                };
            default:
                return {
                    container: { paddingHorizontal: 12, paddingVertical: 6 },
                    text: { fontSize: 14 },
                };
        }
    };

    const sizeStyles = getSizeStyles(size);

    return (
        <TouchableOpacity
            style={[
                styles.container,
                sizeStyles.container,
                selected ? styles.selected : styles.unselected,
                disabled && styles.disabled,
                style,
            ]}
            onPress={onPress}
            disabled={disabled}
            activeOpacity={0.7}
        >
            <Text style={[
                styles.text,
                sizeStyles.text,
                selected ? styles.selectedText : styles.unselectedText,
                textStyle,
            ]}>
                {label}
            </Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: 20,
        marginHorizontal: 4,
        marginVertical: 2,
        minHeight: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    selected: {
        backgroundColor: colors.primaryColor,
    },
    unselected: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    },
    disabled: {
        opacity: 0.5,
    },
    text: {
        fontWeight: '500',
    },
    selectedText: {
        color: 'white',
    },
    unselectedText: {
        color: colors.primaryDark,
    },
}); 