import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '@/components/Header';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { PaymentCard, PaymentStatus, PaymentType } from '@/components/PaymentCard';

type Payment = {
    id: string;
    amount: number;
    currency: string;
    status: PaymentStatus;
    type: PaymentType;
    date: string;
    recipient: string;
    sender: string;
    propertyName?: string;
    description?: string;
    transactionId?: string;
};

// Sample data for demonstration
const samplePayments: Payment[] = [
    {
        id: '1',
        amount: 850,
        currency: '⊜',
        status: 'completed',
        type: 'rent',
        date: '2023-05-01',
        recipient: 'Maria Garcia',
        sender: 'John Smith',
        propertyName: 'Modern Studio in Barcelona',
        description: 'May 2023 Rent Payment',
        transactionId: 'tx_123456789',
    },
    {
        id: '2',
        amount: 1900,
        currency: '⊜',
        status: 'completed',
        type: 'deposit',
        date: '2023-04-15',
        recipient: 'Maria Garcia',
        sender: 'John Smith',
        propertyName: 'Modern Studio in Barcelona',
        description: 'Security Deposit',
        transactionId: 'tx_987654321',
    },
    {
        id: '3',
        amount: 850,
        currency: '⊜',
        status: 'pending',
        type: 'rent',
        date: '2023-06-01',
        recipient: 'Maria Garcia',
        sender: 'John Smith',
        propertyName: 'Modern Studio in Barcelona',
        description: 'June 2023 Rent Payment',
    },
    {
        id: '4',
        amount: 250,
        currency: 'FairCoin',
        status: 'processing',
        type: 'fairCoin',
        date: '2023-05-15',
        recipient: 'Eco Housing Collective',
        sender: 'John Smith',
        description: 'Contribution to Community Fund',
        transactionId: 'fc_567891234',
    },
    {
        id: '5',
        amount: 120,
        currency: '⊜',
        status: 'completed',
        type: 'service',
        date: '2023-04-22',
        recipient: 'Homio Cleaning Services',
        sender: 'John Smith',
        propertyName: 'Modern Studio in Barcelona',
        description: 'Monthly Cleaning Service',
        transactionId: 'tx_456789123',
    },
];

type FilterOptions = 'all' | 'completed' | 'pending' | 'processing';

export default function PaymentsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<FilterOptions>('all');
    const [searchQuery, setSearchQuery] = useState('');

    // Filter payments based on the selected filter and search query
    const filteredPayments = samplePayments
        .filter((payment) => {
            if (filter === 'all') return true;
            return payment.status === filter;
        })
        .filter((payment) => {
            if (!searchQuery) return true;
            const query = searchQuery.toLowerCase();
            return (
                payment.recipient.toLowerCase().includes(query) ||
                payment.propertyName?.toLowerCase().includes(query) ||
                payment.description?.toLowerCase().includes(query) ||
                payment.type.toLowerCase().includes(query)
            );
        });

    const handlePaymentDetails = (paymentId: string) => {
        router.push(`/payments/${paymentId}`);
    };

    const handleReceiptPress = (paymentId: string) => {
        // In a real app, this would download or show the receipt
        console.log(`Viewing receipt for payment ${paymentId}`);
    };

    const handleAddPayment = () => {
        router.push('/payments/new');
    };

    const handleFairCoinPayment = () => {
        router.push('/payments/fairCoin');
    };

    const renderFilterButton = (label: string, value: FilterOptions) => (
        <TouchableOpacity
            style={[
                styles.filterButton,
                filter === value && styles.filterButtonActive
            ]}
            onPress={() => setFilter(value)}
        >
            <Text
                style={[
                    styles.filterButtonText,
                    filter === value && styles.filterButtonTextActive
                ]}
            >
                {label}
            </Text>
        </TouchableOpacity>
    );

    if (loading) {
        return (
            <SafeAreaView style={styles.container} edges={['top']}>
                <Header
                    options={{
                        title: t("Payments"),
                        titlePosition: 'center',
                    }}
                />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primaryColor} />
                    <Text style={styles.loadingText}>{t("Loading payments...")}</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <Header
                options={{
                    title: t("Payments"),
                    titlePosition: 'center',
                    rightComponents: [
                        <TouchableOpacity key="add" style={styles.headerButton} onPress={handleAddPayment}>
                            <Ionicons name="add-circle-outline" size={24} color={colors.COLOR_BLACK} />
                        </TouchableOpacity>,
                    ],
                }}
            />

            <View style={styles.balanceSection}>
                <View style={styles.balanceCard}>
                    <Text style={styles.balanceLabel}>{t("Your Balance")}</Text>
                    <Text style={styles.balanceAmount}>⊜2,450.00</Text>
                    <View style={styles.balanceActions}>
                        <TouchableOpacity style={styles.balanceActionButton}>
                            <Ionicons name="add-circle-outline" size={20} color="white" />
                            <Text style={styles.balanceActionText}>{t("Add Funds")}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.balanceActionButton}>
                            <Ionicons name="arrow-down-outline" size={20} color="white" />
                            <Text style={styles.balanceActionText}>{t("Withdraw")}</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.fairCoinCard}
                    onPress={handleFairCoinPayment}
                >
                    <View style={styles.fairCoinIcon}>
                        <Ionicons name="logo-bitcoin" size={24} color="#FFD700" />
                    </View>
                    <View style={styles.fairCoinContent}>
                        <Text style={styles.fairCoinTitle}>{t("FairCoin")}</Text>
                        <Text style={styles.fairCoinBalance}>250 FC</Text>
                        <Text style={styles.fairCoinDescription}>
                            {t("Ethical cryptocurrency for community transactions")}
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.primaryDark_1} />
                </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
                <View style={styles.searchInputContainer}>
                    <Ionicons name="search" size={20} color={colors.primaryDark_1} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t("Search payments...")}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={20} color={colors.primaryDark_1} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            <View style={styles.filterContainer}>
                {renderFilterButton(t('All'), 'all')}
                {renderFilterButton(t('Completed'), 'completed')}
                {renderFilterButton(t('Pending'), 'pending')}
                {renderFilterButton(t('Processing'), 'processing')}
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
            >
                {filteredPayments.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="cash-outline" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
                        <Text style={styles.emptyText}>{t("No payments found")}</Text>
                        <Text style={styles.emptySubtext}>
                            {searchQuery
                                ? t("Try adjusting your search criteria")
                                : filter === 'all'
                                    ? t("You haven't made any payments yet")
                                    : t(`You don't have any ${filter} payments`)}
                        </Text>
                        <TouchableOpacity
                            style={styles.emptyButton}
                            onPress={handleAddPayment}
                        >
                            <Text style={styles.emptyButtonText}>{t("Make a Payment")}</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    filteredPayments.map((payment) => (
                        <PaymentCard
                            key={payment.id}
                            {...payment}
                            onViewPress={() => handlePaymentDetails(payment.id)}
                            onReceiptPress={() => handleReceiptPress(payment.id)}
                        />
                    ))
                )}
            </ScrollView>

            <View style={styles.quickAccessContainer}>
                <TouchableOpacity
                    style={styles.quickAccessButton}
                    onPress={handleAddPayment}
                >
                    <View style={styles.quickAccessIconWrap}>
                        <Ionicons name="home-outline" size={24} color={colors.primaryColor} />
                    </View>
                    <Text style={styles.quickAccessText}>{t("Pay Rent")}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.quickAccessButton}
                    onPress={() => router.push('/payments/deposit')}
                >
                    <View style={styles.quickAccessIconWrap}>
                        <Ionicons name="lock-closed-outline" size={24} color={colors.primaryColor} />
                    </View>
                    <Text style={styles.quickAccessText}>{t("Deposit")}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.quickAccessButton}
                    onPress={() => router.push('/payments/history')}
                >
                    <View style={styles.quickAccessIconWrap}>
                        <Ionicons name="time-outline" size={24} color={colors.primaryColor} />
                    </View>
                    <Text style={styles.quickAccessText}>{t("History")}</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    headerButton: {
        padding: 8,
    },
    balanceSection: {
        padding: 16,
    },
    balanceCard: {
        backgroundColor: colors.primaryColor,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    balanceLabel: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.8)',
        marginBottom: 4,
    },
    balanceAmount: {
        fontSize: 28,
        fontWeight: '700',
        color: 'white',
        marginBottom: 16,
    },
    balanceActions: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
    },
    balanceActionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 20,
        marginRight: 10,
    },
    balanceActionText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '500',
        marginLeft: 4,
    },
    fairCoinCard: {
        backgroundColor: 'rgba(255, 215, 0, 0.1)',
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 215, 0, 0.3)',
    },
    fairCoinIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 215, 0, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    fairCoinContent: {
        flex: 1,
    },
    fairCoinTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 2,
    },
    fairCoinBalance: {
        fontSize: 18,
        fontWeight: '700',
        color: '#DAA520',
        marginBottom: 4,
    },
    fairCoinDescription: {
        fontSize: 12,
        color: colors.primaryDark_1,
    },
    searchContainer: {
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        paddingHorizontal: 12,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 10,
        marginLeft: 8,
        fontSize: 14,
    },
    filterContainer: {
        flexDirection: 'row',
        paddingHorizontal: 12,
        paddingVertical: 12,
        backgroundColor: colors.primaryLight,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_5,
    },
    filterButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 20,
        marginHorizontal: 4,
    },
    filterButtonActive: {
        backgroundColor: colors.primaryColor,
    },
    filterButtonText: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    filterButtonTextActive: {
        color: 'white',
        fontWeight: '500',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingVertical: 12,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: colors.primaryDark_1,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
        marginTop: 20,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginTop: 16,
        marginBottom: 8,
    },
    emptySubtext: {
        fontSize: 14,
        color: colors.primaryDark_1,
        textAlign: 'center',
        marginBottom: 24,
    },
    emptyButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 24,
    },
    emptyButtonText: {
        color: 'white',
        fontWeight: '600',
    },
    quickAccessContainer: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_5,
        justifyContent: 'space-around',
    },
    quickAccessButton: {
        alignItems: 'center',
    },
    quickAccessIconWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    quickAccessText: {
        fontSize: 12,
        color: colors.primaryDark,
    },
}); 