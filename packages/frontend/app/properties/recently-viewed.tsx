import React, { useState } from 'react';
import { View, StyleSheet, SafeAreaView, RefreshControl, Text, TouchableOpacity, Platform, Animated, Dimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { colors } from '@/styles/colors';
import { Header } from '@/components/Header';
import { PropertyList } from '@/components/PropertyList';
import LoadingTopSpinner from '@/components/LoadingTopSpinner';
import { SearchBar } from '@/components/SearchBar';
import Button from '@/components/Button';
import { Property } from '@/services/propertyService';
import { Ionicons } from '@expo/vector-icons';
import { useSavedProperties, useSaveProperty, useUnsaveProperty } from '@/hooks/useUserQueries';
import { getPropertyTitle } from '@/utils/propertyUtils';

const screenWidth = Dimensions.get('window').width;
const isMobile = screenWidth < 600;
const IconComponent = Ionicons as any;

export default function RecentlyViewedScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'list' | 'grid'>(isMobile ? 'grid' : 'list');
    const fadeAnim = React.useRef(new Animated.Value(0)).current;

    const { properties: recentProperties, isLoading, error, refetch, clear } = useRecentlyViewed();

    // Filter properties based on search query
    const filteredProperties = React.useMemo(() => {
        if (!searchQuery.trim()) return recentProperties;

        const query = searchQuery.toLowerCase();
        return recentProperties.filter(property => {
            const title = getPropertyTitle(property).toLowerCase();
            const location = `${property.address.city}, ${property.address.state}`.toLowerCase();
            const description = property.description?.toLowerCase() || '';

            return title.includes(query) || location.includes(query) || description.includes(query);
        });
    }, [recentProperties, searchQuery]);

    const saveProperty = useSaveProperty();
    const unsaveProperty = useUnsaveProperty();
    const { data: savedProperties = [] } = useSavedProperties();
    const [optimisticSaved, setOptimisticSaved] = useState<{ [id: string]: boolean }>({});

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
        filteredProperties.map((property) => ({
            ...property,
            isFavorite: isPropertySaved(property),
        })), [filteredProperties, optimisticSaved, savedProperties]);

    React.useEffect(() => {
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
        }).start();
    }, [filteredProperties]);

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
    };

    const handleClearHistory = () => {
        clear();
    };

    const renderEmptyState = () => (
        <View style={styles.emptyState}>
            <IconComponent name="time-outline" size={64} color={colors.COLOR_BLACK_LIGHT_4} />
            <Text style={styles.emptyTitle}>{t('No Recently Viewed Properties')}</Text>
            <Text style={styles.emptyDescription}>{t('Start browsing properties to see your recent activity here.')}</Text>
            <Button onPress={() => router.push('/properties')} style={styles.browseButton}>
                {t('Browse Properties')}
            </Button>
        </View>
    );

    const renderErrorState = () => (
        <View style={styles.errorState}>
            <IconComponent name="alert-circle-outline" size={64} color="#ff4757" />
            <Text style={styles.errorTitle}>{t('Error Loading Recently Viewed')}</Text>
            <Text style={styles.errorDescription}>{error || t('Please try again.')}</Text>
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

    return (
        <SafeAreaView style={styles.container}>
            <Header options={{ title: t('Recently Viewed'), titlePosition: 'left' }} />
            <View style={styles.topBar}>
                <View style={styles.searchBarContainer}>
                    <SearchBar hideFilterIcon={true} />
                </View>
                {recentProperties.length > 0 && (
                    <TouchableOpacity style={styles.clearButton} onPress={handleClearHistory}>
                        <IconComponent name="trash-outline" size={20} color="#ff4757" />
                    </TouchableOpacity>
                )}
                {renderViewModeToggle()}
            </View>
            <View style={styles.resultCountBar}>
                <Text style={styles.resultCountText}>
                    {t('Results')}: {filteredProperties.length} {searchQuery && `(${t('filtered')})`}
                </Text>
            </View>
            {isLoading && !recentProperties.length ? (
                <LoadingTopSpinner showLoading={true} />
            ) : error ? (
                renderErrorState()
            ) : filteredProperties.length === 0 ? (
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
    clearButton: {
        marginLeft: 8,
        backgroundColor: colors.primaryLight_1,
        borderRadius: 100,
        padding: 8,
        borderWidth: 1,
        borderColor: '#ff4757',
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
    browseButton: {
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
}); 