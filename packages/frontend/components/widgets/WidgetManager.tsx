import React, { type ReactNode, useMemo } from 'react';
import { View } from 'react-native';
import { FeaturedPropertiesWidget } from './FeaturedPropertiesWidget';
import { NeighbourSupportWidget } from './NeighbourSupportWidget';
import { SavedSearchesWidget } from './SavedSearchesWidget';
import { PropertyAlertWidget } from './PropertyAlertWidget';
import { NeighborhoodRatingWidget } from './NeighborhoodRatingWidget';
import { RecentlyViewedWidget } from './RecentlyViewedWidget';
import { PropertyPreviewWidget } from './PropertyPreviewWidget';
import { PropertyBookingWidget } from './PropertyBookingWidget';
import { MissionWidget } from './MissionWidget';
import type { ScreenId } from './screenIds';

// Feature flag: controls whether the Neighborhood widget is rendered.
// Off by default — the widget only renders real, Homiio-derived metrics, so it
// stays gated until neighborhood data coverage is broad enough to be useful.
const NEIGHBORHOOD_WIDGET_ENABLED =
  (process.env.EXPO_PUBLIC_NEIGHBORHOOD_WIDGET_ENABLED || '').toLowerCase() === 'true';

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
        <RecentlyViewedWidget key="recently-viewed" />,
        <FeaturedPropertiesWidget key="featured-properties" />,
        <MissionWidget key="mission" />,
        <NeighbourSupportWidget key="neighbour-support" />,
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
        <NeighbourSupportWidget key="neighbour-support" />,
      ],
      'property-details': [
        <PropertyBookingWidget key="booking" propertyId={propertyId} />,
        <NeighborhoodRatingWidget
          key="neighborhood"
          propertyId={propertyId}
          neighborhoodName={neighborhoodName}
          city={city}
          state={state}
        />,
        <RecentlyViewedWidget key="recently-viewed" />,
        <NeighbourSupportWidget key="neighbour-support" />,
      ],
      profile: [<MissionWidget key="mission" />],
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

  return <View className="flex-col gap-4">{filteredScreenWidgets}</View>;
});
