import React, { ReactNode, useMemo } from 'react';
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
import { DonationWidget } from './DonationWidget';

// Feature flag: controls whether the Neighborhood widget is rendered
const NEIGHBORHOOD_WIDGET_ENABLED =
  (process.env.NEXT_PUBLIC_NEIGHBORHOOD_WIDGET_ENABLED || '').toLowerCase() === 'true';

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
export const WidgetManager = React.memo(function WidgetManager({
  screenId,
  propertyId,
  neighborhoodName,
  city,
  state,
}: WidgetManagerProps) {
  // Memoize widget configuration to prevent recreation on every render
  const widgetConfig = useMemo(() => {
    const config: Record<ScreenId, ReactNode[]> = {
      home: [
        <TrustScoreWidget key="trust-score" />,
        <RecentlyViewedWidget key="recently-viewed" />,
        <FeaturedPropertiesWidget key="featured-properties" />,
        <DonationWidget key="donation" />,
        <HorizonInitiativeWidget key="horizon" />,
        <EcoCertificationWidget key="eco-cert" />,
      ],
      properties: [
        <PropertyAlertWidget key="property-alert" />,
        <SavedSearchesWidget key="saved-searches" />,
        <NeighborhoodRatingWidget
          key="neighborhood"
          neighborhoodName={neighborhoodName}
          city={city}
          state={state}
        />,
        <EcoCertificationWidget key="eco-cert" />,
      ],
      'property-details': [
        <NeighborhoodRatingWidget
          key="neighborhood"
          propertyId={propertyId}
          neighborhoodName={neighborhoodName}
          city={city}
          state={state}
        />,
        <RecentlyViewedWidget key="recently-viewed" />,
        <EcoCertificationWidget key="eco-cert" />,
      ],
      'saved-properties': [
        <PropertyAlertWidget key="property-alert" />,
        <NeighborhoodRatingWidget
          key="neighborhood"
          neighborhoodName={neighborhoodName}
          city={city}
          state={state}
        />,
      ],
      profile: [
        <TrustScoreWidget key="trust-score" />,
        <DonationWidget key="donation" />,
      ],
      contracts: [],
      payments: [],
      messages: [],
      search: [
        <QuickFiltersWidget key="quick-filters" />,
        <SavedSearchesWidget key="saved-searches" />,
        <PropertyAlertWidget key="property-alert" />,
      ],
      'search-results': [
        <QuickFiltersWidget key="quick-filters" />,
        <SavedSearchesWidget key="saved-searches" />,
        <PropertyAlertWidget key="property-alert" />,
      ],
      'create-property': [<PropertyPreviewWidget key="property-preview" />],
    };
    return config;
  }, [propertyId, neighborhoodName, city, state]);

  // Memoize screen widgets to prevent recreation
  const screenWidgets = useMemo(() => {
    return widgetConfig[screenId] || [];
  }, [widgetConfig, screenId]);

  // Memoize filtered widgets
  const filteredScreenWidgets = useMemo(() => {
    if (NEIGHBORHOOD_WIDGET_ENABLED) {
      return screenWidgets;
    }
    return screenWidgets.filter((widget) => {
      if (!React.isValidElement(widget)) return true;
      return widget.type !== NeighborhoodRatingWidget;
    });
  }, [screenWidgets]);

  if (filteredScreenWidgets.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {filteredScreenWidgets.map((widget, index) => (
        <View key={`widget-${index}`} style={styles.widgetWrapper}>
          {widget}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    gap: 15,
  },
  widgetWrapper: {
    marginBottom: 0, // No margin since we're using gap
  },
});
