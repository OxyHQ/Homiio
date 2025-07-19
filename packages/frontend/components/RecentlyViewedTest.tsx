import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useOxy } from '@oxyhq/services';
import { colors } from '@/styles/colors';
import { userApi } from '@/utils/api';

export function RecentlyViewedTest() {
    const { properties, isLoading, error, refetch, addProperty, clear } = useRecentlyViewed();
    const { oxyServices, activeSessionId } = useOxy();
    const [debugInfo, setDebugInfo] = useState<string>('');
    const [apiDebugInfo, setApiDebugInfo] = useState<string>('');

    useEffect(() => {
        const info = {
            propertiesCount: properties?.length || 0,
            isLoading,
            error: error || 'none',
            hasOxyServices: !!oxyServices,
            hasActiveSession: !!activeSessionId,
            timestamp: new Date().toISOString()
        };
        setDebugInfo(JSON.stringify(info, null, 2));
    }, [properties, isLoading, error, oxyServices, activeSessionId]);

    const testProperty = {
        _id: 'test-property-' + Date.now(),
        id: 'test-property-' + Date.now(),
        type: 'apartment' as const,
        address: {
            street: 'Test Street 123',
            city: 'Test City',
            state: 'Test State',
            zipCode: '12345',
            country: 'Test Country'
        },
        rent: {
            amount: 1000,
            currency: 'USD',
            paymentFrequency: 'monthly' as const,
            deposit: 500,
            utilities: 'excluded' as const
        },
        status: 'available' as const,
        ownerId: 'test-owner',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    const addTestProperty = () => {
        console.log('Adding test property to recently viewed');
        addProperty(testProperty);
    };

    const testDirectAPI = async () => {
        if (!oxyServices || !activeSessionId) {
            Alert.alert('Error', 'Not authenticated');
            return;
        }

        try {
            console.log('Testing direct API call to getRecentProperties...');
            const response = await userApi.getRecentProperties(oxyServices, activeSessionId);
            console.log('Direct API response:', response);

            setApiDebugInfo(JSON.stringify({
                success: true,
                dataType: typeof response.data,
                dataLength: Array.isArray(response.data) ? response.data.length : 'not array',
                data: response.data,
                timestamp: new Date().toISOString()
            }, null, 2));
        } catch (error) {
            console.error('Direct API call failed:', error);
            setApiDebugInfo(JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            }, null, 2));
        }
    };

    const clearAll = () => {
        console.log('Clearing all recently viewed properties');
        clear();
    };

    const forceRefetch = () => {
        console.log('Force refetching recently viewed properties');
        refetch();
    };

    return (
        <ScrollView style={styles.container}>
            <Text style={styles.title}>Recently Viewed Test Component</Text>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Actions</Text>
                <TouchableOpacity style={styles.button} onPress={addTestProperty}>
                    <Text style={styles.buttonText}>Add Test Property</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={forceRefetch}>
                    <Text style={styles.buttonText}>Force Refetch</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={testDirectAPI}>
                    <Text style={styles.buttonText}>Test Direct API</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={clearAll}>
                    <Text style={styles.buttonText}>Clear All</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Hook Debug Info</Text>
                <Text style={styles.debugText}>{debugInfo}</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Direct API Debug Info</Text>
                <Text style={styles.debugText}>{apiDebugInfo || 'No API test run yet'}</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Properties ({properties?.length || 0})</Text>
                {properties?.map((property, index) => (
                    <View key={property._id || property.id || index} style={styles.propertyItem}>
                        <Text style={styles.propertyText}>
                            {index + 1}. {property.address?.street || 'No address'} - {property.address?.city || 'No city'}
                        </Text>
                        <Text style={styles.propertyId}>
                            ID: {property._id || property.id || 'No ID'}
                        </Text>
                    </View>
                ))}
                {(!properties || properties.length === 0) && (
                    <Text style={styles.emptyText}>No properties found</Text>
                )}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        backgroundColor: '#f5f5f5',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
        color: colors.primaryColor,
    },
    section: {
        marginBottom: 20,
        padding: 15,
        backgroundColor: 'white',
        borderRadius: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 10,
        color: colors.primaryColor,
    },
    button: {
        backgroundColor: colors.primaryColor,
        padding: 12,
        borderRadius: 25,
        marginBottom: 8,
        alignItems: 'center',
    },
    dangerButton: {
        backgroundColor: '#ff4757',
    },
    buttonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
        fontFamily: 'Phudu',
    },
    debugText: {
        fontSize: 12,
        fontFamily: 'monospace',
        backgroundColor: '#f8f8f8',
        padding: 10,
        borderRadius: 4,
        color: '#333',
    },
    propertyItem: {
        padding: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    propertyText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#333',
    },
    propertyId: {
        fontSize: 12,
        color: '#666',
        marginTop: 4,
    },
    emptyText: {
        fontSize: 14,
        color: '#666',
        fontStyle: 'italic',
        textAlign: 'center',
        padding: 20,
    },
});

export default RecentlyViewedTest; 