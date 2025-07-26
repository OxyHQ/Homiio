import React, { useState } from 'react';
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    TouchableOpacity,
    Alert,
    RefreshControl,
    ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import Button from '@/components/Button';
import LoadingTopSpinner from '@/components/LoadingTopSpinner';
import { useUserProperties } from '@/hooks/usePropertyQueries';
import { useOxy } from '@oxyhq/services';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { EmptyState } from '@/components/ui/EmptyState';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

export default function MyPropertiesScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { user } = useOxy();
    const { data, isLoading, error, refetch } = useUserProperties();
    const [refreshing, setRefreshing] = useState(false);

    // Set document title for web
    useDocumentTitle('My Properties');

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const handleCreateProperty = () => {
        router.push('/properties/create');
    };

    const handlePropertyPress = (propertyId: string) => {
        router.push(`/properties/${propertyId}`);
    };

    const handleEditProperty = (propertyId: string) => {
        router.push(`/properties/${propertyId}/edit`);
    };

    const handleDeleteProperty = (propertyId: string, propertyTitle: string) => {
        Alert.alert(
            t('properties.my.deleteTitle'),
            t('properties.my.deleteMessage', { title: propertyTitle }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () => {
                        // TODO: Implement delete functionality
                        Alert.alert(t('common.success'), t('properties.my.deleteSuccess'));
                    },
                },
            ]
        );
    };

    const renderProperty = ({ item }: { item: any }) => {
        const currency = item.rent?.currency || '⊜';
        const price = item.rent?.amount || 0;
        const location = `${item.address?.city || ''}, ${item.address?.country || ''}`;

        // Generate title dynamically from property data
        const title = generatePropertyTitle({
            type: item.type,
            address: item.address,
            bedrooms: item.bedrooms,
            bathrooms: item.bathrooms
        });

        return (
            <View style={styles.propertyContainer}>
                <PropertyCard
                    id={item._id || item.id}
                    title={title}
                    location={location}
                    price={price}
                    currency={currency}
                    type={item.type || 'apartment'}
                    imageSource={getPropertyImageSource(item.images)}
                    bedrooms={item.bedrooms || 0}
                    bathrooms={item.bathrooms || 0}
                    size={item.squareFootage || 0}
                    isVerified={item.status === 'available'}
                    onPress={() => handlePropertyPress(item._id || item.id)}
                    style={styles.propertyCard}
                />

                <View style={styles.propertyActions}>
                    <TouchableOpacity
                        style={[styles.actionButton, styles.editButton]}
                        onPress={() => handleEditProperty(item._id || item.id)}
                    >
                        <IconComponent name="create-outline" size={16} color={colors.primaryColor} />
                        <Text style={[styles.actionText, styles.editText]}>{t('properties.my.edit')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, styles.deleteButton]}
                        onPress={() => handleDeleteProperty(item._id || item.id, title)}
                    >
                        <IconComponent name="trash-outline" size={16} color="#ff4757" />
                        <Text style={[styles.actionText, styles.deleteText]}>{t('properties.my.delete')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderEmptyState = () => (
        <EmptyState
            icon="home-outline"
            title={t('properties.my.emptyTitle')}
            description={t('properties.my.emptyDescription')}
            actionText={t('properties.my.createFirst')}
            actionIcon="add"
            onAction={handleCreateProperty}
        />
    );

    const renderErrorState = () => (
        <EmptyState
            icon="alert-circle-outline"
            title={t('properties.my.errorTitle')}
            description={t('properties.my.errorDescription')}
            actionText={t('common.retry')}
            actionIcon="refresh"
            onAction={handleRefresh}
        />
    );

    if (isLoading && !data) {
        return (
            <SafeAreaView style={styles.container}>
                <Header options={{ title: t('properties.my.title') }} />
                <LoadingTopSpinner showLoading={true} />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <Header
                options={{
                    title: t('properties.my.title'),
                    rightComponents: [
                        <TouchableOpacity key="add" onPress={handleCreateProperty} style={styles.addButton}>
                            <IconComponent name="add" size={24} color={colors.primaryColor} />
                        </TouchableOpacity>
                    ]
                }}
            />

            {error ? (
                renderErrorState()
            ) : data?.properties.length === 0 ? (
                renderEmptyState()
            ) : (
                <FlatList
                    data={data?.properties || []}
                    renderItem={renderProperty}
                    keyExtractor={(item) => (item._id || item.id) || ''}
                    contentContainerStyle={styles.listContainer}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            colors={[colors.primaryColor]}
                            tintColor={colors.primaryColor}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f2f2f2',
    },
    listContainer: {
        padding: 16,
        paddingBottom: 32,
    },
    propertyContainer: {
        marginBottom: 20,
    },
    propertyCard: {
        marginBottom: 8,
    },
    propertyActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        flex: 1,
        marginHorizontal: 4,
    },
    editButton: {
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    deleteButton: {
        backgroundColor: '#fff5f5',
        borderWidth: 1,
        borderColor: '#ff4757',
    },
    actionText: {
        fontSize: 14,
        fontWeight: '500',
        marginLeft: 6,
    },
    editText: {
        color: colors.primaryColor,
    },
    deleteText: {
        color: '#ff4757',
    },
    addButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.primaryLight,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },

}); 