import React, { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';

type BaseWidgetProps = {
    title?: string;
    icon?: ReactNode;
    children: ReactNode;
    noPadding?: boolean;
};

export function BaseWidget({ title, icon, children, noPadding = false }: BaseWidgetProps) {
    return (
        <View style={styles.widgetContainer}>
            {title && (
                <View style={styles.widgetHeader}>
                    <ThemedText style={styles.widgetTitle}>{title}</ThemedText>
                    {icon && <View>{icon}</View>}
                </View>
            )}
            <View style={[styles.widgetContent, noPadding && styles.noPadding]}>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    widgetContainer: {
        backgroundColor: colors.primaryLight,
        borderRadius: 15,
        overflow: 'hidden',
    },
    widgetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
        margin: 15,
        marginBottom: 12,
    },
    widgetTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    widgetContent: {
        padding: 15,
        paddingTop: 0,
    },
    noPadding: {
        padding: 0,
        paddingBottom: 10,
    },
}); 