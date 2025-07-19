import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

type FraudAlertProps = {
    title: string;
    description: string;
    severity: AlertSeverity;
    date: string;
    propertyId?: string;
    propertyName?: string;
    reportedBy?: string;
    onViewPress?: () => void;
    onDismissPress?: () => void;
    onReportPress?: () => void;
};

export function FraudAlert({
    title,
    description,
    severity,
    date,
    propertyName,
    reportedBy,
    onViewPress,
    onDismissPress,
    onReportPress,
}: FraudAlertProps) {
    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const getSeverityInfo = (severity: AlertSeverity) => {
        switch (severity) {
            case 'low':
                return {
                    icon: 'alert-circle-outline',
                    color: '#4CAF50',
                    label: 'Low Risk',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                };
            case 'medium':
                return {
                    icon: 'warning-outline',
                    color: '#FFC107',
                    label: 'Medium Risk',
                    backgroundColor: 'rgba(255, 193, 7, 0.1)',
                };
            case 'high':
                return {
                    icon: 'warning',
                    color: '#FF9800',
                    label: 'High Risk',
                    backgroundColor: 'rgba(255, 152, 0, 0.1)',
                };
            case 'critical':
                return {
                    icon: 'alert',
                    color: '#F44336',
                    label: 'Critical Risk',
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                };
        }
    };

    const severityInfo = getSeverityInfo(severity);

    return (
        <View style={[styles.container, { backgroundColor: severityInfo.backgroundColor }]}>
            <View style={styles.header}>
                <View style={styles.titleContainer}>
                    <Ionicons name={severityInfo.icon as any} size={24} color={severityInfo.color} />
                    <Text style={[styles.title, { color: severityInfo.color }]}>{title}</Text>
                </View>
                <View style={[styles.severityBadge, { backgroundColor: severityInfo.color }]}>
                    <Text style={styles.severityText}>{severityInfo.label}</Text>
                </View>
            </View>

            <Text style={styles.date}>Reported on {formatDate(date)}</Text>

            <Text style={styles.description}>{description}</Text>

            {propertyName && (
                <View style={styles.propertyRow}>
                    <Ionicons name="home-outline" size={16} color={colors.primaryDark_1} />
                    <Text style={styles.propertyName} numberOfLines={1}>Property: {propertyName}</Text>
                </View>
            )}

            {reportedBy && (
                <View style={styles.reportedRow}>
                    <Ionicons name="person-outline" size={16} color={colors.primaryDark_1} />
                    <Text style={styles.reportedBy} numberOfLines={1}>Reported by: {reportedBy}</Text>
                </View>
            )}

            <View style={styles.actionsContainer}>
                <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: severityInfo.color }]}
                    onPress={onViewPress}
                >
                    <Ionicons name="eye-outline" size={18} color="white" />
                    <Text style={styles.actionTextWhite}>View Details</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: 'transparent', borderColor: colors.primaryDark_1 }]}
                    onPress={onDismissPress}
                >
                    <Ionicons name="close-outline" size={18} color={colors.primaryDark_1} />
                    <Text style={[styles.actionText, { color: colors.primaryDark_1 }]}>Dismiss</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: 'transparent', borderColor: '#F44336' }]}
                    onPress={onReportPress}
                >
                    <Ionicons name="flag-outline" size={18} color="#F44336" />
                    <Text style={[styles.actionText, { color: '#F44336' }]}>Report</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: 12,
        padding: 16,
        marginHorizontal: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.1)',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        marginLeft: 8,
    },
    severityBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    severityText: {
        color: 'white',
        fontSize: 12,
        fontWeight: '500',
    },
    date: {
        fontSize: 12,
        color: colors.primaryDark_1,
        marginBottom: 12,
    },
    description: {
        fontSize: 14,
        color: colors.primaryDark,
        marginBottom: 16,
        lineHeight: 20,
    },
    propertyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    propertyName: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginLeft: 8,
    },
    reportedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    reportedBy: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginLeft: 8,
    },
    actionsContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        flexWrap: 'wrap',
        gap: 8,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'transparent',
        borderRadius: 25,
        paddingVertical: 6,
        paddingHorizontal: 12,
        marginRight: 8,
    },
    actionText: {
        fontSize: 12,
        fontWeight: '500',
        marginLeft: 6,
    },
    actionTextWhite: {
        color: 'white',
        fontSize: 12,
        fontWeight: '500',
        marginLeft: 6,
    },
}); 