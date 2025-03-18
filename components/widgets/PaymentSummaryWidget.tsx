import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';

export function PaymentSummaryWidget() {
    const { t } = useTranslation();
    const router = useRouter();

    // Mock data for payments
    const pendingPayments = 1;
    const nextPaymentAmount = 850;
    const nextPaymentDate = 'Jun 15, 2023';
    const currency = '€';

    return (
        <BaseWidget
            title={t("Payment Summary")}
            icon={<Ionicons name="card" size={22} color={colors.primaryColor} />}
        >
            <View style={styles.container}>
                <View style={styles.balanceSection}>
                    <View style={styles.balanceInfo}>
                        <Text style={styles.balanceLabel}>Next Payment</Text>
                        <View style={styles.amountRow}>
                            <Text style={styles.balanceAmount}>{currency}{nextPaymentAmount}</Text>
                            <View style={pendingPayments > 0 ? styles.pendingBadge : undefined}>
                                {pendingPayments > 0 && (
                                    <Text style={styles.pendingText}>{pendingPayments}</Text>
                                )}
                            </View>
                        </View>
                        <Text style={styles.balanceDate}>Due on {nextPaymentDate}</Text>
                    </View>

                    <TouchableOpacity
                        style={styles.payNowButton}
                        onPress={() => router.push('/payments/checkout')}
                    >
                        <Text style={styles.payNowText}>Pay Now</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.divider} />

                <View style={styles.paymentActions}>
                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => router.push('/payments/history')}
                    >
                        <Ionicons name="time-outline" size={18} color={colors.primaryColor} />
                        <Text style={styles.actionText}>History</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => router.push('/payments/methods')}
                    >
                        <Ionicons name="wallet-outline" size={18} color={colors.primaryColor} />
                        <Text style={styles.actionText}>Methods</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => router.push('/payments/settings')}
                    >
                        <Ionicons name="settings-outline" size={18} color={colors.primaryColor} />
                        <Text style={styles.actionText}>Settings</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingVertical: 5,
    },
    balanceSection: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 15,
    },
    balanceInfo: {
        flex: 1,
    },
    balanceLabel: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 4,
    },
    amountRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    balanceAmount: {
        fontSize: 24,
        fontWeight: 'bold',
        marginRight: 8,
    },
    pendingBadge: {
        backgroundColor: 'red',
        width: 20,
        height: 20,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    pendingText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
    },
    balanceDate: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginTop: 2,
    },
    payNowButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 8,
        paddingHorizontal: 15,
        borderRadius: 20,
    },
    payNowText: {
        color: 'white',
        fontWeight: '600',
    },
    divider: {
        height: 1,
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        marginBottom: 15,
    },
    paymentActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    actionButton: {
        flexDirection: 'column',
        alignItems: 'center',
        padding: 10,
    },
    actionText: {
        fontSize: 12,
        color: colors.primaryDark,
        marginTop: 5,
    },
}); 