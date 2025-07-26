import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '@/components/Header';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { FraudAlert, AlertSeverity } from '@/components/FraudAlert';
import { FilterChip } from '@/components/ui/FilterChip';
import { EmptyState } from '@/components/ui/EmptyState';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

// Define custom colors that might not be in the colors object
const customColors = {
    COLOR_GREEN: '#4CAF50',
    COLOR_GREEN_LIGHT: '#E8F5E9',
    COLOR_YELLOW_DARK: '#F57F17',
    COLOR_YELLOW_LIGHT: '#FFFDE7',
    COLOR_RED: '#F44336',
    COLOR_RED_LIGHT: '#FFEBEE',
};

type FraudReport = {
    id: string;
    title: string;
    description: string;
    severity: AlertSeverity;
    date: string;
    reportedBy?: string;
    status: 'active' | 'resolved' | 'investigating';
    propertyInfo?: {
        id: string;
        name: string;
        address: string;
    };
};

// Sample data for demonstration
const sampleReports: FraudReport[] = [
    {
        id: '1',
        title: 'Suspicious Payment Request',
        description: 'Landlord requested payment outside the platform. They asked for a direct bank transfer to an unverified account.',
        severity: 'high',
        date: '2023-05-10',
        status: 'investigating',
        reportedBy: 'John Smith',
        propertyInfo: {
            id: 'prop_123',
            name: 'Modern Studio in Barcelona',
            address: 'Carrer de Balmes 123, Barcelona',
        },
    },
    {
        id: '2',
        title: 'False Property Listing',
        description: 'Property does not exist at the specified address. Appears to be a scam listing with stolen photos.',
        severity: 'critical',
        date: '2023-05-05',
        status: 'active',
        reportedBy: 'Emma Johnson',
        propertyInfo: {
            id: 'prop_456',
            name: 'Luxury Apartment with Sea View',
            address: 'Passeig Maritim 45, Barcelona',
        },
    },
    {
        id: '3',
        title: 'Identity Verification Alert',
        description: 'Unusual activity detected during the verification process. Multiple failed attempts with different documents.',
        severity: 'medium',
        date: '2023-05-08',
        status: 'investigating',
        reportedBy: 'System',
    },
    {
        id: '4',
        title: 'Unauthorized Access Attempt',
        description: 'Multiple login attempts from an unrecognized device and location.',
        severity: 'medium',
        date: '2023-05-12',
        status: 'resolved',
        reportedBy: 'System',
    },
    {
        id: '5',
        title: 'Misleading Property Information',
        description: 'Property amenities and conditions significantly different from listing description.',
        severity: 'low',
        date: '2023-04-28',
        status: 'resolved',
        reportedBy: 'Sarah Williams',
        propertyInfo: {
            id: 'prop_789',
            name: 'Cozy Apartment in City Center',
            address: 'Carrer d\'Aragó 352, Barcelona',
        },
    },
];

type FilterOptions = 'all' | 'active' | 'investigating' | 'resolved';

export default function FraudReportsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<FilterOptions>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedInfo, setExpandedInfo] = useState<string | null>(null);

    // Filter reports based on the selected filter and search query
    const filteredReports = sampleReports
        .filter((report) => {
            if (filter === 'all') return true;
            return report.status === filter;
        })
        .filter((report) => {
            if (!searchQuery) return true;
            const query = searchQuery.toLowerCase();
            return (
                report.title.toLowerCase().includes(query) ||
                report.description.toLowerCase().includes(query) ||
                report.propertyInfo?.name.toLowerCase().includes(query) ||
                report.propertyInfo?.address.toLowerCase().includes(query)
            );
        });

    // Sort reports by date (newest first) and severity
    const sortedReports = [...filteredReports].sort((a, b) => {
        // First sort by status priority (active first, then investigating, then resolved)
        const statusPriority = { active: 0, investigating: 1, resolved: 2 };
        const statusDiff = statusPriority[a.status] - statusPriority[b.status];
        if (statusDiff !== 0) return statusDiff;

        // Then by severity
        const severityPriority = { critical: 0, high: 1, medium: 2, low: 3 };
        const severityDiff = severityPriority[a.severity] - severityPriority[b.severity];
        if (severityDiff !== 0) return severityDiff;

        // Finally by date
        return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    const handleReportDetails = (reportId: string) => {
        router.push(`/safety/fraud-reports/${reportId}`);
    };

    const handleDismissAlert = (reportId: string) => {
        // In a real app, this would update the report status
        console.log(`Dismissing alert ${reportId}`);
    };

    const handleReportFraud = () => {
        router.push('/safety/report-fraud');
    };

    const toggleExpandInfo = (reportId: string) => {
        if (expandedInfo === reportId) {
            setExpandedInfo(null);
        } else {
            setExpandedInfo(reportId);
        }
    };

    const renderFilterButton = (label: string, value: FilterOptions) => (
        <FilterChip
            label={label}
            selected={filter === value}
            onPress={() => setFilter(value)}
            size="medium"
        />
    );

    if (loading) {
        return (
            <SafeAreaView style={styles.container} edges={['top']}>
                <Header
                    options={{
                        title: t("Fraud Reports"),
                        titlePosition: 'center',
                    }}
                />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primaryColor} />
                    <Text style={styles.loadingText}>{t("Loading reports...")}</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <Header
                options={{
                    title: t("Fraud Reports"),
                    titlePosition: 'center',
                    rightComponents: [
                        <TouchableOpacity key="add" style={styles.headerButton} onPress={handleReportFraud}>
                            <IconComponent name="add-circle-outline" size={24} color={colors.COLOR_BLACK} />
                        </TouchableOpacity>,
                    ],
                }}
            />

            <View style={styles.safetyInfoCard}>
                <View style={styles.safetyIconContainer}>
                    <IconComponent name="shield-checkmark" size={32} color={colors.primaryColor} />
                </View>
                <View style={styles.safetyInfoContent}>
                    <Text style={styles.safetyInfoTitle}>{t("Stay Safe on Homio")}</Text>
                    <Text style={styles.safetyInfoDescription}>
                        {t("We take fraud seriously. Always pay through our platform and verify property details before signing contracts.")}
                    </Text>
                    <TouchableOpacity
                        style={styles.safetyInfoButton}
                        onPress={() => router.push('/safety/tips')}
                    >
                        <Text style={styles.safetyInfoButtonText}>{t("Safety Tips")}</Text>
                        <IconComponent name="chevron-forward" size={16} color={colors.primaryColor} />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.searchContainer}>
                <View style={styles.searchInputContainer}>
                    <IconComponent name="search" size={20} color={colors.primaryDark_1} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t("Search reports...")}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <IconComponent name="close-circle" size={20} color={colors.primaryDark_1} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            <View style={styles.filterContainer}>
                {renderFilterButton(t('All'), 'all')}
                {renderFilterButton(t('Active'), 'active')}
                {renderFilterButton(t('Investigating'), 'investigating')}
                {renderFilterButton(t('Resolved'), 'resolved')}
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
            >
                {sortedReports.length === 0 ? (
                    <EmptyState
                        icon="shield-outline"
                        title={t("No fraud reports found")}
                        description={searchQuery
                            ? t("Try adjusting your search criteria")
                            : filter === 'all'
                                ? t("You don't have any reported fraud cases")
                                : t(`You don't have any ${filter} reports`)}
                        actionText={t("Report Fraud")}
                        actionIcon="alert-circle"
                        onAction={handleReportFraud}
                    />
                ) : (
                    <>
                        <View style={styles.statsContainer}>
                            <View style={styles.statItem}>
                                <Text style={styles.statNumber}>{sampleReports.filter(r => r.status === 'active').length}</Text>
                                <Text style={styles.statLabel}>{t("Active")}</Text>
                            </View>
                            <View style={styles.statItem}>
                                <Text style={styles.statNumber}>{sampleReports.filter(r => r.status === 'investigating').length}</Text>
                                <Text style={styles.statLabel}>{t("Investigating")}</Text>
                            </View>
                            <View style={styles.statItem}>
                                <Text style={styles.statNumber}>{sampleReports.filter(r => r.status === 'resolved').length}</Text>
                                <Text style={styles.statLabel}>{t("Resolved")}</Text>
                            </View>
                        </View>

                        {sortedReports.map((report) => (
                            <View key={report.id} style={styles.reportContainer}>
                                <FraudAlert
                                    title={report.title}
                                    description={report.description}
                                    severity={report.severity}
                                    date={report.date}
                                    propertyName={report.propertyInfo?.name}
                                    reportedBy={report.reportedBy}
                                    onViewPress={() => handleReportDetails(report.id)}
                                    onDismissPress={() => handleDismissAlert(report.id)}
                                    onReportPress={() => router.push('/safety/report-fraud')}
                                />

                                {report.status !== 'resolved' && (
                                    <View style={styles.statusBadge}>
                                        <Text style={styles.statusText}>
                                            {report.status === 'active' ? t('Active') : t('Investigating')}
                                        </Text>
                                    </View>
                                )}

                                <TouchableOpacity
                                    style={styles.infoButton}
                                    onPress={() => toggleExpandInfo(report.id)}
                                >
                                    <Text style={styles.infoButtonText}>
                                        {expandedInfo === report.id ? t("Hide Info") : t("Show More")}
                                    </Text>
                                    <IconComponent
                                        name={expandedInfo === report.id ? "chevron-up" : "chevron-down"}
                                        size={16}
                                        color={colors.primaryDark_1}
                                    />
                                </TouchableOpacity>

                                {expandedInfo === report.id && (
                                    <View style={styles.expandedInfo}>
                                        <View style={styles.infoRow}>
                                            <Text style={styles.infoLabel}>{t("Status")}</Text>
                                            <View style={[
                                                styles.infoStatusBadge,
                                                {
                                                    backgroundColor: report.status === 'resolved'
                                                        ? customColors.COLOR_GREEN_LIGHT
                                                        : report.status === 'investigating'
                                                            ? customColors.COLOR_YELLOW_LIGHT
                                                            : customColors.COLOR_RED_LIGHT
                                                }
                                            ]}>
                                                <Text style={[
                                                    styles.infoStatusText,
                                                    {
                                                        color: report.status === 'resolved'
                                                            ? customColors.COLOR_GREEN
                                                            : report.status === 'investigating'
                                                                ? customColors.COLOR_YELLOW_DARK
                                                                : customColors.COLOR_RED
                                                    }
                                                ]}>
                                                    {report.status === 'resolved'
                                                        ? t("Resolved")
                                                        : report.status === 'investigating'
                                                            ? t("Under Investigation")
                                                            : t("Active Case")}
                                                </Text>
                                            </View>
                                        </View>

                                        <View style={styles.infoRow}>
                                            <Text style={styles.infoLabel}>{t("Reported On")}</Text>
                                            <Text style={styles.infoValue}>{new Date(report.date).toLocaleDateString()}</Text>
                                        </View>

                                        <View style={styles.infoRow}>
                                            <Text style={styles.infoLabel}>{t("Reported By")}</Text>
                                            <Text style={styles.infoValue}>{report.reportedBy || t("Anonymous")}</Text>
                                        </View>

                                        {report.status === 'resolved' && (
                                            <View style={styles.infoRow}>
                                                <Text style={styles.infoLabel}>{t("Resolution Date")}</Text>
                                                <Text style={styles.infoValue}>{new Date().toLocaleDateString()}</Text>
                                            </View>
                                        )}

                                        <View style={styles.infoActionsRow}>
                                            <TouchableOpacity
                                                style={styles.infoActionButton}
                                                onPress={() => handleReportDetails(report.id)}
                                            >
                                                <IconComponent name="document-text-outline" size={20} color={colors.primaryColor} />
                                                <Text style={styles.infoActionText}>{t("Full Report")}</Text>
                                            </TouchableOpacity>

                                            {report.status !== 'resolved' && (
                                                <TouchableOpacity
                                                    style={styles.infoActionButton}
                                                    onPress={() => handleDismissAlert(report.id)}
                                                >
                                                    <IconComponent name="checkmark-circle-outline" size={20} color={customColors.COLOR_GREEN} />
                                                    <Text style={[styles.infoActionText, { color: customColors.COLOR_GREEN }]}>
                                                        {t("Mark as Resolved")}
                                                    </Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    </View>
                                )}
                            </View>
                        ))}
                    </>
                )}
            </ScrollView>

            <TouchableOpacity
                style={styles.reportFraudButton}
                onPress={handleReportFraud}
            >
                <IconComponent name="warning-outline" size={24} color="white" />
                <Text style={styles.reportFraudButtonText}>{t("Report Fraud")}</Text>
            </TouchableOpacity>
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
    safetyInfoCard: {
        backgroundColor: 'white',
        margin: 16,
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    safetyIconContainer: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    safetyInfoContent: {
        flex: 1,
    },
    safetyInfoTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    safetyInfoDescription: {
        fontSize: 12,
        color: colors.primaryDark_1,
        marginBottom: 8,
    },
    safetyInfoButton: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    safetyInfoButtonText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.primaryColor,
        marginRight: 4,
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
        paddingBottom: 12,
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
        paddingBottom: 100,
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
    statsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        paddingVertical: 16,
        backgroundColor: 'white',
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    statItem: {
        alignItems: 'center',
    },
    statNumber: {
        fontSize: 24,
        fontWeight: '700',
        color: colors.primaryDark,
    },
    statLabel: {
        fontSize: 12,
        color: colors.primaryDark_1,
        marginTop: 4,
    },
    reportContainer: {
        marginHorizontal: 16,
        marginBottom: 16,
        position: 'relative',
    },
    statusBadge: {
        position: 'absolute',
        top: 12,
        right: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        color: 'white',
        fontSize: 10,
        fontWeight: '600',
    },
    infoButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'white',
        paddingVertical: 8,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_5,
    },
    infoButtonText: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginRight: 4,
    },
    expandedInfo: {
        backgroundColor: 'white',
        padding: 16,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_5,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    infoLabel: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    infoValue: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.primaryDark,
    },
    infoStatusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    infoStatusText: {
        fontSize: 12,
        fontWeight: '600',
    },
    infoActionsRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginTop: 8,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_5,
    },
    infoActionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    infoActionText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.primaryColor,
        marginLeft: 8,
    },

    reportFraudButton: {
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: [{ translateX: -100 }],
        width: 200,
        backgroundColor: customColors.COLOR_RED,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
    },
    reportFraudButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
}); 