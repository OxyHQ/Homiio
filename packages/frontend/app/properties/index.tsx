import React, { useState, useEffect } from 'react';
import { View, StyleSheet, SafeAreaView, RefreshControl, Text, TouchableOpacity, Platform, Animated, Dimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { Header } from '@/components/Header';
import { PropertyList } from '@/components/PropertyList';
import LoadingTopSpinner from '@/components/LoadingTopSpinner';
import { useProperties } from '@/hooks/usePropertyQueries';
import { SearchBar } from '@/components/SearchBar';
import Button from '@/components/Button';
import { Property } from '@/services/propertyService';
import { Ionicons } from '@expo/vector-icons';
import { useSavedProperties, useSaveProperty, useUnsaveProperty } from '@/hooks/useUserQueries';
import { useOxy } from '@oxyhq/services';
import { useDispatch } from 'react-redux';
import { fetchRecentlyViewedProperties } from '@/store/reducers/recentlyViewedReducer';
import type { AppDispatch } from '@/store/store';

const screenWidth = Dimensions.get('window').width;
const isMobile = screenWidth < 600;
const IconComponent = Ionicons as any;

export default function PropertiesScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { oxyServices, activeSessionId } = useOxy();
    const dispatch = useDispatch<AppDispatch>();
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filters, setFilters] = useState({ page: 1, limit: 20 });
    const [viewMode, setViewMode] = useState<'list' | 'grid'>(isMobile ? 'grid' : 'list');
    const [showFilters, setShowFilters] = useState(false);
    const fadeAnim = React.useRef(new Animated.Value(0)).current;

    const { data, isLoading, error, refetch } = useProperties({ ...filters, search: searchQuery || undefined });
    const properties = data?.properties || [];
    const total = data?.total || 0;

    const saveProperty = useSaveProperty();
    const unsaveProperty = useUnsaveProperty();
    const { data: savedProperties = [] } = useSavedProperties();
    const [optimisticSaved, setOptimisticSaved] = useState<{ [id: string]: boolean }>({});

    // Refresh recently viewed list when screen loads
    useEffect(() => {
        if (oxyServices && activeSessionId) {
            dispatch(fetchRecentlyViewedProperties({ oxyServices, activeSessionId }));
        }
    }, [oxyServices, activeSessionId, dispatch]);

    const getPropertyId = (property: Property) => property._id || property.id || '';
    const isPropertySaved = (property: Property) => {
        const id = getPropertyId(property);
        if (!id) return false;
        if (optimisticSaved[id]) return true;
        return savedProperties.some(p => getPropertyId(p) === id);
    };

    const handleFavoritePress = (property: Property) => {
        const id = getPropertyId(property);
        if (!id) return;
        const currentlySaved = isPropertySaved(property);
        setOptimisticSaved(prev => ({ ...prev, [id]: !currentlySaved }));
        if (currentlySaved) {
            unsaveProperty.mutate(id, {
                onError: () => setOptimisticSaved(prev => ({ ...prev, [id]: true })),
                onSettled: () => setOptimisticSaved(prev => {
                    const copy = { ...prev };
                    delete copy[id];
                    return copy;
                })
            });
        } else {
            saveProperty.mutate({ propertyId: id }, {
                onError: () => setOptimisticSaved(prev => ({ ...prev, [id]: false })),
                onSettled: () => setOptimisticSaved(prev => {
                    const copy = { ...prev };
                    delete copy[id];
                    return copy;
                })
            });
        }
    };

    // Memoize properties with isFavorite injected
    const propertiesWithFavorite = React.useMemo(() =>
        properties.map((property) => ({
            ...property,
            isFavorite: isPropertySaved(property),
        })), [properties, optimisticSaved, savedProperties]);

    React.useEffect(() => {
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
        }).start();
    }, [properties]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const handlePropertyPress = (property: Property) => {
        router.push(`/properties/${property._id || property.id}`);
    };

    const handleSearch = (query: string) => {
        setSearchQuery(query);
        setFilters((prev) => ({ ...prev, page: 1 }));
    };

    const handleAddProperty = () => {
        router.push('/properties/create');
    };

    const renderEmptyState = () => (
        <View style={styles.emptyState}>
            <IconComponent name="home-outline" size={64} color={colors.COLOR_BLACK_LIGHT_4} />
            <Text style={styles.emptyTitle}>{t('No Properties Found')}</Text>
            <Text style={styles.emptyDescription}>{t('Try adjusting your search criteria or filters.')}</Text>
            <Button onPress={handleAddProperty} style={styles.createButton}>
                {t('Create Property')}
            </Button>
        </View>
    );

    const renderErrorState = () => (
        <View style={styles.errorState}>
            <IconComponent name="alert-circle-outline" size={64} color="#ff4757" />
            <Text style={styles.errorTitle}>{t('Error Loading Properties')}</Text>
            <Text style={styles.errorDescription}>{error?.message || t('Please try again.')}</Text>
            <Button onPress={handleRefresh} style={styles.retryButton}>
                {t('Retry')}
            </Button>
        </View>
    );

    // View mode toggle button
    const renderViewModeToggle = () => (
        <View style={styles.viewModeToggle}>
            <TouchableOpacity
                style={[styles.toggleButton, viewMode === 'grid' && styles.toggleButtonActive]}
                onPress={() => setViewMode('grid')}
            >
                <IconComponent name="grid-outline" size={20} color={viewMode === 'grid' ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4} />
            </TouchableOpacity>
            <TouchableOpacity
                style={[styles.toggleButton, viewMode === 'list' && styles.toggleButtonActive]}
                onPress={() => setViewMode('list')}
            >
                <IconComponent name="list-outline" size={22} color={viewMode === 'list' ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4} />
            </TouchableOpacity>
        </View>
    );

    // Filter button
    const renderFilterButton = () => (
        <TouchableOpacity style={styles.filterButton} onPress={() => setShowFilters(!showFilters)}>
            <IconComponent name="options-outline" size={22} color={colors.primaryColor} />
        </TouchableOpacity>
    );

    // Recently viewed button
    const renderRecentlyViewedButton = () => (
        <TouchableOpacity style={styles.recentlyViewedButton} onPress={() => router.push('/properties/recently-viewed')}>
            <IconComponent name="time-outline" size={22} color={colors.primaryColor} />
        </TouchableOpacity>
    );

    // Floating action button
    const renderFAB = () => (
        <TouchableOpacity style={styles.fab} onPress={handleAddProperty}>
            <IconComponent name="add" size={32} color={colors.primaryLight} />
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.container}>
            <Header options={{ title: t('Properties'), titlePosition: 'left' }} />
            <View style={styles.topBar}>
                <View style={styles.searchBarContainer}>
                    <SearchBar hideFilterIcon={true} />
                </View>
                {renderFilterButton()}
                {renderRecentlyViewedButton()}
                {renderViewModeToggle()}
            </View>
            <View style={styles.resultCountBar}>
                <Text style={styles.resultCountText}>{t('Results')}: {total}</Text>
            </View>
            {isLoading && !properties.length ? (
                <LoadingTopSpinner showLoading={true} />
            ) : error ? (
                renderErrorState()
            ) : properties.length === 0 ? (
                renderEmptyState()
            ) : (
                <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
                    <PropertyList
                        key={viewMode}
                        properties={propertiesWithFavorite}
                        onPropertyPress={handlePropertyPress}
                        onFavoritePress={handleFavoritePress}
                        style={styles.list}
                        contentContainerStyle={styles.listContent}
                        numColumns={viewMode === 'grid' ? 2 : 1}
                        variant={viewMode === 'grid' ? 'compact' : 'default'}
                    />
                </Animated.View>
            )}
            {renderFAB()}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingTop: 8,
        gap: 8,
        backgroundColor: colors.primaryLight,
    },
    searchBarContainer: {
        flex: 1,
    },
    filterButton: {
        marginLeft: 8,
        backgroundColor: colors.primaryLight_1,
        borderRadius: 100,
        padding: 8,
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    recentlyViewedButton: {
        marginLeft: 8,
        backgroundColor: colors.primaryLight_1,
        borderRadius: 100,
        padding: 8,
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    viewModeToggle: {
        flexDirection: 'row',
        marginLeft: 8,
        backgroundColor: colors.primaryLight_1,
        borderRadius: 100,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        overflow: 'hidden',
    },
    toggleButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    toggleButtonActive: {
        backgroundColor: colors.primaryColor,
    },
    resultCountBar: {
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 2,
        backgroundColor: colors.primaryLight,
    },
    resultCountText: {
        fontSize: 15,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    list: {
        flex: 1,
    },
    listContent: {
        paddingBottom: 32,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    emptyTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: colors.primaryDark,
        marginTop: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyDescription: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 16,
        textAlign: 'center',
    },
    createButton: {
        marginTop: 12,
        alignSelf: 'center',
    },
    errorState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    errorTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#ff4757',
        marginBottom: 8,
        textAlign: 'center',
    },
    errorDescription: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 16,
        textAlign: 'center',
    },
    retryButton: {
        marginTop: 12,
        alignSelf: 'center',
    },
    fab: {
        position: 'absolute',
        right: 24,
        bottom: 32,
        backgroundColor: colors.primaryColor,
        borderRadius: 32,
        width: 56,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 6,
        zIndex: 100,
    },
});
