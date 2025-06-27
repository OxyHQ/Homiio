import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { ActionButton } from './ActionButton';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

type EmptyStateProps = {
    icon?: string;
    title: string;
    description?: string;
    actionText?: string;
    actionIcon?: string;
    onAction?: () => void;
    style?: ViewStyle;
    iconSize?: number;
    iconColor?: string;
};

export function EmptyState({
    icon = 'alert-circle-outline',
    title,
    description,
    actionText,
    actionIcon = 'add',
    onAction,
    style,
    iconSize = 64,
    iconColor = colors.COLOR_BLACK_LIGHT_3,
}: EmptyStateProps) {
    return (
        <View style={[styles.container, style]}>
            <IconComponent
                name={icon}
                size={iconSize}
                color={iconColor}
                style={styles.icon}
            />

            <Text style={styles.title}>{title}</Text>

            {description && (
                <Text style={styles.description}>{description}</Text>
            )}

            {actionText && onAction && (
                <ActionButton
                    icon={actionIcon}
                    text={actionText}
                    onPress={onAction}
                    variant="primary"
                    size="medium"
                    style={styles.actionButton}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
        minHeight: 200,
    },
    icon: {
        marginBottom: 16,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        textAlign: 'center',
        marginBottom: 8,
    },
    description: {
        fontSize: 14,
        color: colors.primaryDark_1,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 24,
        maxWidth: 280,
    },
    actionButton: {
        marginTop: 8,
    },
}); 