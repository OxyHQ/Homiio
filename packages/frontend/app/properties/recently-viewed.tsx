import React, { useState, useEffect } from 'react';
import { View, StyleSheet, RefreshControl, Text, TouchableOpacity, Platform, Animated, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { getPropertyTitle } from '@/utils/propertyUtils';
import { useOxy } from '@oxyhq/services';
import { EmptyState } from '@/components/ui/EmptyState';

const screenWidth = Dimensions.get('window').width;
const isMobile = screenWidth < 600;
const IconComponent = Ionicons as any;

export default function RecentlyViewedScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { oxyServices, activeSessionId } = useOxy();
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'list' | 'grid'>(isMobile ? 'grid' : 'list');
    const fadeAnim = React.useRef(new Animated.Value(0)).current;
    const [headerHeight, setHeaderHeight] = useState(0);

    const { properties: recentProperties, isLoading, error, refetch, clear } = useRecentlyViewed();

    // Filter properties based on search query
    const filteredProperties = React.useMemo(() => {
        if (!searchQuery.trim()) return recentProperties;

        const query = searchQuery.toLowerCase();
        return recentProperties.filter(property => {
            const title = (getPropertyTitle(property) || '').toLowerCase();
            const location = `${property.address?.city || ''}, ${property.address?.state || ''}`.toLowerCase();
            const description = property.description?.toLowerCase() || '';

            return title.includes(query) || location.includes(query) || description.includes(query);
        });
    }, [recentProperties, searchQuery]);

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
        <EmptyState
            icon="time-outline"
            title={t('No Recently Viewed Properties')}
            description={t('Start browsing properties to see your recent activity here.')}
            actionText={t('Browse Properties')}
            actionIcon="home"
            onAction={() => router.push('/properties')}
        />
    );

    const renderErrorState = () => (
        <EmptyState
            icon="alert-circle-outline"
            title={t('Error Loading Recently Viewed')}
            description={error || t('Please try again.')}
            actionText={t('Retry')}
            actionIcon="refresh"
            onAction={handleRefresh}
        />
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
        <View style={styles.container}>
            <View
                style={styles.stickyHeaderWrapper}
                onLayout={e => setHeaderHeight(e.nativeEvent.layout.height)}
            >
                <Header options={{ title: t('Recently Viewed'), titlePosition: 'left' }} />
            </View>
            <View style={{ paddingTop: headerHeight, flex: 1 }}>
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
                            properties={filteredProperties}
                            onPropertyPress={handlePropertyPress}
                            style={styles.list}
                            contentContainerStyle={styles.listContent}
                            numColumns={viewMode === 'grid' ? 2 : 1}
                            variant={viewMode === 'grid' ? 'compact' : 'default'}
                        />
                    </Animated.View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    stickyHeaderWrapper: {
        zIndex: 100,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
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

}); 