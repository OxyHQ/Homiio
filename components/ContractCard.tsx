import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

export type ContractStatus = 'draft' | 'pending' | 'active' | 'expired' | 'terminated';

type ContractCardProps = {
    id: string;
    title: string;
    propertyId: string;
    propertyName: string;
    startDate: string;
    endDate: string;
    status: ContractStatus;
    landlordName: string;
    tenantName: string;
    monthlyRent: number;
    currency?: string;
    onPress?: () => void;
    onSharePress?: () => void;
    onDownloadPress?: () => void;
};

export function ContractCard({
    title,
    propertyName,
    startDate,
    endDate,
    status,
    landlordName,
    tenantName,
    monthlyRent,
    currency = '⊜',
    onPress,
    onSharePress,
    onDownloadPress,
}: ContractCardProps) {
    // Formatting the dates in a readable format
    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const getStatusInfo = (status: ContractStatus) => {
        switch (status) {
            case 'draft':
                return {
                    icon: 'document-outline',
                    color: colors.COLOR_BLACK_LIGHT_3,
                    label: 'Draft',
                };
            case 'pending':
                return {
                    icon: 'hourglass-outline',
                    color: '#FFC107',
                    label: 'Pending Approval',
                };
            case 'active':
                return {
                    icon: 'checkmark-circle',
                    color: '#4CAF50',
                    label: 'Active',
                };
            case 'expired':
                return {
                    icon: 'calendar-outline',
                    color: '#9E9E9E',
                    label: 'Expired',
                };
            case 'terminated':
                return {
                    icon: 'close-circle-outline',
                    color: '#F44336',
                    label: 'Terminated',
                };
        }
    };

    const statusInfo = getStatusInfo(status);

    return (
        <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
            <View style={styles.header}>
                <View style={styles.titleContainer}>
                    <Text style={styles.title} numberOfLines={1}>{title}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: statusInfo.color }]}>
                        <Ionicons name={statusInfo.icon as any} size={12} color="white" />
                        <Text style={styles.statusText}>{statusInfo.label}</Text>
                    </View>
                </View>
                <Text style={styles.rent}>
                    {currency}{monthlyRent.toLocaleString()}<Text style={styles.rentPeriod}>/month</Text>
                </Text>
            </View>

            <View style={styles.propertyRow}>
                <Ionicons name="home-outline" size={16} color={colors.primaryDark_1} />
                <Text style={styles.propertyName} numberOfLines={1}>{propertyName}</Text>
            </View>

            <View style={styles.datesContainer}>
                <View style={styles.dateRow}>
                    <Text style={styles.dateLabel}>Start Date:</Text>
                    <Text style={styles.dateValue}>{formatDate(startDate)}</Text>
                </View>
                <View style={styles.dateRow}>
                    <Text style={styles.dateLabel}>End Date:</Text>
                    <Text style={styles.dateValue}>{formatDate(endDate)}</Text>
                </View>
            </View>

            <View style={styles.partiesContainer}>
                <View style={styles.partyRow}>
                    <Ionicons name="business-outline" size={16} color={colors.primaryDark_1} />
                    <Text style={styles.partyLabel}>Landlord:</Text>
                    <Text style={styles.partyName} numberOfLines={1}>{landlordName}</Text>
                </View>
                <View style={styles.partyRow}>
                    <Ionicons name="person-outline" size={16} color={colors.primaryDark_1} />
                    <Text style={styles.partyLabel}>Tenant:</Text>
                    <Text style={styles.partyName} numberOfLines={1}>{tenantName}</Text>
                </View>
            </View>

            <View style={styles.actionsContainer}>
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={onSharePress}
                >
                    <Ionicons name="share-outline" size={18} color={colors.primaryColor} />
                    <Text style={styles.actionText}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={onDownloadPress}
                >
                    <Ionicons name="download-outline" size={18} color={colors.primaryColor} />
                    <Text style={styles.actionText}>Download</Text>
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        padding: 16,
        marginHorizontal: 12,
        marginBottom: 16,
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    titleContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginRight: 8,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        color: 'white',
        fontSize: 10,
        fontWeight: '500',
        marginLeft: 4,
    },
    rent: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryColor,
    },
    rentPeriod: {
        fontSize: 14,
        fontWeight: '400',
        color: colors.primaryDark_1,
    },
    propertyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    propertyName: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginLeft: 8,
    },
    datesContainer: {
        marginBottom: 12,
        backgroundColor: colors.primaryLight,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
    },
    dateRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    dateLabel: {
        fontSize: 12,
        color: colors.primaryDark_1,
    },
    dateValue: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.primaryDark,
    },
    partiesContainer: {
        marginBottom: 12,
    },
    partyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    partyLabel: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginLeft: 8,
        marginRight: 4,
    },
    partyName: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.primaryDark,
        flex: 1,
    },
    actionsContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        marginTop: 4,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        borderRadius: 20,
        paddingVertical: 6,
        paddingHorizontal: 12,
        marginRight: 12,
    },
    actionText: {
        color: colors.primaryColor,
        fontSize: 12,
        fontWeight: '500',
        marginLeft: 6,
    },
}); 