import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';

export function PropertyAlertWidget() {
    const { t } = useTranslation();
    const [minPrice, setMinPrice] = useState('');
    const [maxPrice, setMaxPrice] = useState('1000');
    const [location, setLocation] = useState('');
    const [emailNotifications, setEmailNotifications] = useState(true);
    const [pushNotifications, setPushNotifications] = useState(true);

    const handleCreateAlert = async () => {
        try {
            // TODO: Implement API call to create property alert
            // const alertData = {
            //     minPrice: parseFloat(minPrice) || undefined,
            //     maxPrice: parseFloat(maxPrice) || undefined,
            //     location,
            //     emailNotifications,
            //     pushNotifications
            // };
            // await propertyService.createAlert(alertData);
            
            console.log('Creating alert:', { minPrice, maxPrice, location, emailNotifications, pushNotifications });
            // Show success message
            alert('Alert created successfully!');
        } catch (error) {
            console.error('Failed to create alert:', error);
            alert('Failed to create alert. Please try again.');
        }
    };

    return (
        <BaseWidget
            title={t("Property Alerts")}
            icon={<Ionicons name="notifications" size={22} color={colors.primaryColor} />}
        >
            <View style={styles.container}>
                <Text style={styles.subtitle}>Get notified when new properties match your criteria</Text>

                <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Location</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Barcelona, Berlin"
                        value={location}
                        onChangeText={setLocation}
                    />
                </View>

                <View style={styles.priceRange}>
                    <View style={styles.priceInput}>
                        <Text style={styles.inputLabel}>Min Price</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Min ⊜"
                            value={minPrice}
                            onChangeText={setMinPrice}
                            keyboardType="numeric"
                        />
                    </View>

                    <View style={styles.priceInput}>
                        <Text style={styles.inputLabel}>Max Price</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Max ⊜"
                            value={maxPrice}
                            onChangeText={setMaxPrice}
                            keyboardType="numeric"
                        />
                    </View>
                </View>

                <View style={styles.notificationPreferences}>
                    <Text style={styles.sectionTitle}>Notification Preferences</Text>

                    <View style={styles.toggleRow}>
                        <Text style={styles.toggleLabel}>Email notifications</Text>
                        <Switch
                            value={emailNotifications}
                            onValueChange={setEmailNotifications}
                            trackColor={{ false: colors.COLOR_BLACK_LIGHT_6, true: colors.primaryColor }}
                            thumbColor={emailNotifications ? '#fff' : '#f4f3f4'}
                        />
                    </View>

                    <View style={styles.toggleRow}>
                        <Text style={styles.toggleLabel}>Push notifications</Text>
                        <Switch
                            value={pushNotifications}
                            onValueChange={setPushNotifications}
                            trackColor={{ false: colors.COLOR_BLACK_LIGHT_6, true: colors.primaryColor }}
                            thumbColor={pushNotifications ? '#fff' : '#f4f3f4'}
                        />
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.createButton}
                    onPress={handleCreateAlert}
                >
                    <Text style={styles.createButtonText}>Create Alert</Text>
                </TouchableOpacity>
            </View>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingVertical: 10,
    },
    subtitle: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 15,
    },
    inputGroup: {
        marginBottom: 15,
    },
    inputLabel: {
        fontSize: 14,
        marginBottom: 5,
        color: colors.primaryDark,
    },
    input: {
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 8,
        padding: 8,
        fontSize: 14,
    },
    priceRange: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 15,
    },
    priceInput: {
        width: '48%',
    },
    notificationPreferences: {
        marginBottom: 15,
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 10,
    },
    toggleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    toggleLabel: {
        fontSize: 14,
        color: colors.primaryDark,
    },
    createButton: {
        backgroundColor: colors.primaryColor,
        borderRadius: 20,
        paddingVertical: 10,
        alignItems: 'center',
        marginTop: 5,
    },
    createButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },
}); 