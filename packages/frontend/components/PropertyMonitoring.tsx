import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { LineChart } from 'react-native-chart-kit';

// Dummy data for the chart
const mockElectricityData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
        {
            data: [90, 75, 82, 70, 65, 60],
            color: () => '#2196F3',
            strokeWidth: 2,
        },
    ],
};

const mockWaterData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
        {
            data: [45, 38, 42, 36, 35, 30],
            color: () => '#00BCD4',
            strokeWidth: 2,
        },
    ],
};

const mockGasData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
        {
            data: [120, 100, 105, 90, 85, 80],
            color: () => '#FF9800',
            strokeWidth: 2,
        },
    ],
};

type UtilityType = 'electricity' | 'water' | 'gas';

type PropertyMonitoringProps = {
    propertyName: string;
    lastUpdated: string;
    onRefreshPress?: () => void;
    onSettingsPress?: () => void;
    onAlertPress?: () => void;
};

export function PropertyMonitoring({
    propertyName,
    lastUpdated,
    onRefreshPress,
    onSettingsPress,
    onAlertPress,
}: PropertyMonitoringProps) {
    const [selectedUtility, setSelectedUtility] = useState<UtilityType>('electricity');

    const getUtilityData = (type: UtilityType) => {
        switch (type) {
            case 'electricity':
                return {
                    data: mockElectricityData,
                    icon: 'flash-outline',
                    color: '#2196F3',
                    unit: 'kWh',
                    current: 60,
                    average: 85,
                    saving: '29%',
                };
            case 'water':
                return {
                    data: mockWaterData,
                    icon: 'water-outline',
                    color: '#00BCD4',
                    unit: 'm³',
                    current: 30,
                    average: 45,
                    saving: '33%',
                };
            case 'gas':
                return {
                    data: mockGasData,
                    icon: 'flame-outline',
                    color: '#FF9800',
                    unit: 'm³',
                    current: 80,
                    average: 110,
                    saving: '27%',
                };
        }
    };

    const utilityData = getUtilityData(selectedUtility);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>Property Monitoring</Text>
                    <Text style={styles.propertyName}>{propertyName}</Text>
                </View>
                <View style={styles.headerActions}>
                    <TouchableOpacity
                        style={styles.iconButton}
                        onPress={onRefreshPress}
                    >
                        <Ionicons name="refresh-outline" size={20} color={colors.primaryDark} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.iconButton}
                        onPress={onSettingsPress}
                    >
                        <Ionicons name="settings-outline" size={20} color={colors.primaryDark} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.iconButton}
                        onPress={onAlertPress}
                    >
                        <Ionicons name="notifications-outline" size={20} color={colors.primaryDark} />
                    </TouchableOpacity>
                </View>
            </View>

            <Text style={styles.lastUpdated}>Last updated: {lastUpdated}</Text>

            <View style={styles.utilitySelector}>
                <TouchableOpacity
                    style={[
                        styles.utilitySelectorButton,
                        selectedUtility === 'electricity' && { backgroundColor: 'rgba(33, 150, 243, 0.1)' },
                    ]}
                    onPress={() => setSelectedUtility('electricity')}
                >
                    <Ionicons
                        name="flash-outline"
                        size={20}
                        color={selectedUtility === 'electricity' ? '#2196F3' : colors.primaryDark_1}
                    />
                    <Text
                        style={[
                            styles.utilitySelectorText,
                            selectedUtility === 'electricity' && { color: '#2196F3' },
                        ]}
                    >
                        Electricity
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[
                        styles.utilitySelectorButton,
                        selectedUtility === 'water' && { backgroundColor: 'rgba(0, 188, 212, 0.1)' },
                    ]}
                    onPress={() => setSelectedUtility('water')}
                >
                    <Ionicons
                        name="water-outline"
                        size={20}
                        color={selectedUtility === 'water' ? '#00BCD4' : colors.primaryDark_1}
                    />
                    <Text
                        style={[
                            styles.utilitySelectorText,
                            selectedUtility === 'water' && { color: '#00BCD4' },
                        ]}
                    >
                        Water
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[
                        styles.utilitySelectorButton,
                        selectedUtility === 'gas' && { backgroundColor: 'rgba(255, 152, 0, 0.1)' },
                    ]}
                    onPress={() => setSelectedUtility('gas')}
                >
                    <Ionicons
                        name="flame-outline"
                        size={20}
                        color={selectedUtility === 'gas' ? '#FF9800' : colors.primaryDark_1}
                    />
                    <Text
                        style={[
                            styles.utilitySelectorText,
                            selectedUtility === 'gas' && { color: '#FF9800' },
                        ]}
                    >
                        Gas
                    </Text>
                </TouchableOpacity>
            </View>

            <View style={styles.statsContainer}>
                <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Current Usage</Text>
                    <View style={styles.statValueContainer}>
                        <Ionicons name={utilityData.icon as any} size={24} color={utilityData.color} />
                        <Text style={[styles.statValue, { color: utilityData.color }]}>
                            {utilityData.current} {utilityData.unit}
                        </Text>
                    </View>
                </View>

                <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Area Average</Text>
                    <View style={styles.statValueContainer}>
                        <Ionicons name="analytics-outline" size={24} color={colors.primaryDark_1} />
                        <Text style={styles.statValue}>
                            {utilityData.average} {utilityData.unit}
                        </Text>
                    </View>
                </View>

                <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Savings</Text>
                    <View style={styles.statValueContainer}>
                        <Ionicons name="trending-down-outline" size={24} color="#4CAF50" />
                        <Text style={[styles.statValue, { color: '#4CAF50' }]}>
                            {utilityData.saving}
                        </Text>
                    </View>
                </View>
            </View>

            <View style={styles.chartContainer}>
                <Text style={styles.chartTitle}>
                    {selectedUtility.charAt(0).toUpperCase() + selectedUtility.slice(1)} Usage (6 Months)
                </Text>
                <LineChart
                    data={utilityData.data}
                    width={Dimensions.get('window').width - 40}
                    height={180}
                    chartConfig={{
                        backgroundColor: '#ffffff',
                        backgroundGradientFrom: '#ffffff',
                        backgroundGradientTo: '#ffffff',
                        decimalPlaces: 0,
                        color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
                        labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
                        style: {
                            borderRadius: 16,
                        },
                        propsForDots: {
                            r: '4',
                            strokeWidth: '2',
                            stroke: utilityData.color,
                        },
                    }}
                    bezier
                    style={styles.chart}
                />
            </View>

            <View style={styles.featuredTip}>
                <View style={styles.tipIconContainer}>
                    <Ionicons name="bulb-outline" size={24} color="#FFD700" />
                </View>
                <View style={styles.tipContent}>
                    <Text style={styles.tipTitle}>Energy Saving Tip</Text>
                    <Text style={styles.tipText}>
                        {selectedUtility === 'electricity' ?
                            'Replace traditional bulbs with LED lights to save up to 75% on lighting costs.' :
                            selectedUtility === 'water' ?
                                'Install a low-flow showerhead to reduce water consumption by up to 40%.' :
                                'Lower your thermostat by 1°C to reduce gas consumption by up to 10%.'}
                    </Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        padding: 16,
        margin: 12,
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
        marginBottom: 4,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    propertyName: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    headerActions: {
        flexDirection: 'row',
    },
    iconButton: {
        padding: 6,
        marginLeft: 6,
    },
    lastUpdated: {
        fontSize: 12,
        color: colors.primaryDark_1,
        marginBottom: 16,
    },
    utilitySelector: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    utilitySelectorButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 25,
        flex: 1,
        justifyContent: 'center',
        marginHorizontal: 4,
    },
    utilitySelectorText: {
        marginLeft: 6,
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    statsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    statBox: {
        flex: 1,
        backgroundColor: colors.primaryLight,
        borderRadius: 8,
        padding: 10,
        marginHorizontal: 4,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
    },
    statLabel: {
        fontSize: 12,
        color: colors.primaryDark_1,
        marginBottom: 6,
    },
    statValueContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statValue: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginLeft: 6,
    },
    chartContainer: {
        marginBottom: 16,
    },
    chartTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 8,
    },
    chart: {
        borderRadius: 8,
    },
    featuredTip: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255, 215, 0, 0.1)',
        borderRadius: 8,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(255, 215, 0, 0.3)',
    },
    tipIconContainer: {
        marginRight: 12,
    },
    tipContent: {
        flex: 1,
    },
    tipTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    tipText: {
        fontSize: 12,
        color: colors.primaryDark_1,
        lineHeight: 18,
    },
}); 