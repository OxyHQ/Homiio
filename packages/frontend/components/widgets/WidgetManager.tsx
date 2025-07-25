import React, { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { TrustScoreWidget } from './TrustScoreWidget';
import { FeaturedPropertiesWidget } from './FeaturedPropertiesWidget';
import { EcoCertificationWidget } from './EcoCertificationWidget';
import { HorizonInitiativeWidget } from './HorizonInitiativeWidget';
import { SavedSearchesWidget } from './SavedSearchesWidget';
import { PropertyAlertWidget } from './PropertyAlertWidget';
import { NeighborhoodRatingWidget } from './NeighborhoodRatingWidget';
import { RecentlyViewedWidget } from './RecentlyViewedWidget';
import { QuickFiltersWidget } from './QuickFiltersWidget';
import { PropertyPreviewWidget } from './PropertyPreviewWidget';

// Define screen IDs
export type ScreenId =
    | 'home'
    | 'properties'
    | 'property-details'
    | 'saved-properties'
    | 'profile'
    | 'contracts'
    | 'payments'
    | 'messages'
    | 'search'
    | 'search-results'
    | 'create-property';

interface WidgetManagerProps {
    screenId: ScreenId;
    propertyId?: string;
    neighborhoodName?: string;
    city?: string;
    state?: string;
}

/**
 * Widget Manager Component
 * 
 * This component controls which widgets should appear on which screens.
 * It provides a centralized way to manage widget visibility based on screen context.
 */
export function WidgetManager({
    screenId,
    propertyId,
    neighborhoodName,
    city,
    state
}: WidgetManagerProps) {
    // Define which widgets should appear on which screens
    const getWidgetsForScreen = (screen: ScreenId): ReactNode[] => {
        switch (screen) {
            case 'home':
                return [
                    <TrustScoreWidget key="trust-score" />,
                    <RecentlyViewedWidget key="recently-viewed" />,
                    <FeaturedPropertiesWidget key="featured-properties" />,
                    <HorizonInitiativeWidget key="horizon" />,
                    <EcoCertificationWidget key="eco-cert" />
                ];

            case 'properties':
                return [
                    <PropertyAlertWidget key="property-alert" />,
                    <SavedSearchesWidget key="saved-searches" />,
                    <NeighborhoodRatingWidget
                        key="neighborhood"
                        neighborhoodName={neighborhoodName}
                        city={city}
                        state={state}
                    />,
                    <EcoCertificationWidget key="eco-cert" />
                ];

            case 'property-details':
                return [
                    <NeighborhoodRatingWidget
                        key="neighborhood"
                        propertyId={propertyId}
                        neighborhoodName={neighborhoodName}
                        city={city}
                        state={state}
                    />,
                    <RecentlyViewedWidget key="recently-viewed" />,
                    <EcoCertificationWidget key="eco-cert" />
                ];

            case 'saved-properties':
                return [
                    <PropertyAlertWidget key="property-alert" />,
                    <NeighborhoodRatingWidget
                        key="neighborhood"
                        neighborhoodName={neighborhoodName}
                        city={city}
                        state={state}
                    />
                ];

            case 'profile':
                return [
                    <TrustScoreWidget key="trust-score" />
                ];

            case 'contracts':
                return [];

            case 'payments':
                return [];

            case 'messages':
                return [];

            case 'search':
                return [
                    <QuickFiltersWidget key="quick-filters" />,
                    <SavedSearchesWidget key="saved-searches" />,
                    <PropertyAlertWidget key="property-alert" />
                ];

            case 'search-results':
                return [
                    <QuickFiltersWidget key="quick-filters" />,
                    <SavedSearchesWidget key="saved-searches" />,
                    <PropertyAlertWidget key="property-alert" />
                ];

            case 'create-property':
                return [
                    <PropertyPreviewWidget key="property-preview" />
                ];

            default:
                return [];
        }
    };

    const screenWidgets = getWidgetsForScreen(screenId);

    if (screenWidgets.length === 0) {
        return null;
    }

    return (
        <View style={styles.container}>
            {screenWidgets.map((widget, index) => (
                <View key={`widget-${index}`} style={styles.widgetWrapper}>
                    {widget}
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        gap: 15,
    },
    widgetWrapper: {
        marginBottom: 0, // No margin since we're using gap
    }
}); 