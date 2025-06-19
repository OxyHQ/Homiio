import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '@/styles/colors';
import { IconButton } from './IconButton';

type NotificationItemProps = {
    type: 'message' | 'contract' | 'payment' | string;
    title: string;
    description: string;
    time: string;
    read: boolean;
    onPress?: () => void;
    style?: ViewStyle;
};

const getIcon = (type: string) => {
    switch (type) {
        case 'message':
            return 'chatbox-outline';
        case 'contract':
            return 'document-text-outline';
        case 'payment':
            return 'card-outline';
        default:
            return 'notifications-outline';
    }
};

export function NotificationItem({
    type,
    title,
    description,
    time,
    read,
    onPress,
    style,
}: NotificationItemProps) {
    return (
        <TouchableOpacity
            style={[
                styles.container,
                !read && styles.unreadContainer,
                style,
            ]}
            onPress={onPress}
        >
            <IconButton
                name={getIcon(type)}
                style={styles.icon}
                backgroundColor={colors.primaryLight_2}
            />
            <View style={styles.content}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.description}>{description}</Text>
                <Text style={styles.time}>{time}</Text>
            </View>
            {!read && <View style={styles.unreadDot} />}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    unreadContainer: {
        backgroundColor: colors.primaryLight_1,
    },
    icon: {
        marginRight: 12,
    },
    content: {
        flex: 1,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    description: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginBottom: 4,
    },
    time: {
        fontSize: 12,
        color: colors.messageTimestamp,
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.chatUnreadBadge,
        marginLeft: 8,
    },
}); 