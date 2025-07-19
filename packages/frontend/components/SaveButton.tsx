import React from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import LoadingSpinner from './LoadingSpinner';

const IconComponent = Ionicons as any;

interface SaveButtonProps {
    isSaved: boolean;
    onPress: () => void;
    size?: number;
    style?: ViewStyle;
    disabled?: boolean;
    variant?: 'heart' | 'bookmark';
    color?: string;
    activeColor?: string;
    showLoading?: boolean;
    isLoading?: boolean;
}

export function SaveButton({
    isSaved,
    onPress,
    size = 24,
    style,
    disabled = false,
    variant = 'heart',
    color = '#ccc',
    activeColor = '#EF4444',
    showLoading = true,
    isLoading = false
}: SaveButtonProps) {
    const getIconName = () => {
        if (variant === 'heart') {
            return isSaved ? 'heart' : 'heart-outline';
        } else {
            return isSaved ? 'bookmark' : 'bookmark-outline';
        }
    };

    const getIconColor = () => {
        return isSaved ? activeColor : color;
    };

    const isButtonDisabled = disabled || isLoading;

    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.7}
            disabled={isButtonDisabled}
            style={[
                styles.saveButton,
                isButtonDisabled && styles.disabledButton,
                style
            ]}
        >
            <View style={{
                width: size,
                height: size,
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                {showLoading && isLoading ? (
                    <LoadingSpinner
                        size={size * 0.8}
                        color={getIconColor()}
                        showText={false}
                    />
                ) : (
                    <IconComponent
                        name={getIconName()}
                        size={size}
                        color={getIconColor()}
                    />
                )}
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    saveButton: {
        backgroundColor: colors.primaryLight,
        borderRadius: 25,
        padding: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
        alignItems: 'center',
        justifyContent: 'center',
    },
    disabledButton: {
        opacity: 0.6,
    },
}); 