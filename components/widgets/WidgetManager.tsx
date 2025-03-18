import React, { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import {
    TrustScoreWidget,
    FeaturedPropertiesWidget,
    EcoCertificationWidget,
    HorizonInitiativeWidget,
    SavedSearchesWidget,
    PaymentSummaryWidget,
    PropertyAlertWidget,
    NeighborhoodRatingWidget,
    RecentlyViewedWidget
} from './';

// Define screen IDs
export type ScreenId =
    | 'home'
    | 'properties'
    | 'property-details'
    | 'saved-properties'
    | 'profile'
    | 'contracts'
    | 'payments'
    | 'messages';

interface WidgetManagerProps {
    screenId: ScreenId;
    customWidgets?: ReactNode[];
}

/**
 * Widget Manager Component
 * 
 * This component controls which widgets should appear on which screens.
 * It provides a centralized way to manage widget visibility based on screen context.
 */
export function WidgetManager({ screenId, customWidgets = [] }: WidgetManagerProps) {
    // Define which widgets should appear on which screens
    const getWidgetsForScreen = (screen: ScreenId): ReactNode[] => {
        switch (screen) {
            case 'home':
                return [
                    <TrustScoreWidget key="trust-score" />,
                    <FeaturedPropertiesWidget key="featured-properties" />,
                    <HorizonInitiativeWidget key="horizon" />,
                    <EcoCertificationWidget key="eco-cert" />
                ];

            case 'properties':
                return [
                    <PropertyAlertWidget key="property-alert" />,
                    <SavedSearchesWidget key="saved-searches" />,
                    <NeighborhoodRatingWidget key="neighborhood" />,
                    <EcoCertificationWidget key="eco-cert" />
                ];

            case 'property-details':
                return [
                    <NeighborhoodRatingWidget key="neighborhood" />,
                    <RecentlyViewedWidget key="recently-viewed" />,
                    <EcoCertificationWidget key="eco-cert" />
                ];

            case 'saved-properties':
                return [
                    <PropertyAlertWidget key="property-alert" />,
                    <NeighborhoodRatingWidget key="neighborhood" />
                ];

            case 'profile':
                return [
                    <TrustScoreWidget key="trust-score" />,
                    <PaymentSummaryWidget key="payment-summary" />
                ];

            case 'contracts':
                return [
                    <PaymentSummaryWidget key="payment-summary" />
                ];

            case 'payments':
                return [
                    <PaymentSummaryWidget key="payment-summary" />
                ];

            case 'messages':
                return [];

            default:
                return [];
        }
    };

    const screenWidgets = getWidgetsForScreen(screenId);

    // Combine screen-specific widgets with any custom widgets passed as props
    const allWidgets = [...screenWidgets, ...customWidgets];

    if (allWidgets.length === 0) {
        return null;
    }

    return (
        <View style={styles.container}>
            {allWidgets.map((widget, index) => (
                <View key={`widget-${index}`} style={styles.widgetWrapper}>
                    {widget}
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: 350,
        paddingStart: 20,
        flexDirection: 'column',
        gap: 20,
    },
    widgetWrapper: {
        marginBottom: 20,
    }
}); 