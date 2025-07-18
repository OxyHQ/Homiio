import React, { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/styles/colors';

type BaseWidgetProps = {
    title?: string;
    icon?: ReactNode;
    children: ReactNode;
};

export function BaseWidget({ title, icon, children }: BaseWidgetProps) {
    return (
        <View style={styles.widgetContainer}>
            {title && (
                <View style={styles.widgetHeader}>
                    <Text style={styles.widgetTitle}>{title}</Text>
                    {icon && <View>{icon}</View>}
                </View>
            )}
            <View>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    widgetContainer: {
        backgroundColor: colors.primaryLight,
        borderRadius: 15,
        overflow: 'hidden',
        padding: 15,
    },
    widgetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
        marginBottom: 12,
    },
    widgetTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
}); 