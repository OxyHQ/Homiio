/**
 * PropertyResultsGrid — the single, app-wide multi-column property grid.
 *
 * Every surface that renders a grid of `PropertyCard`s uses THIS component:
 * search/explore, the browse screens (`/properties`, `/properties/my`,
 * `/properties/type/[type]`, recently-viewed, a city), Saved (recent + folder
 * detail) and an agency page. Carousels and single-card/popover/chat/widget
 * usages are not grids and do not use it.
 *
 * Layout is Bloom's `ListingCardGrid`: columns follow the grid's OWN measured
 * width (1 below 640, 2 below 950, 3 below 1280, 4 from there), so the explore
 * list beside the map counts the room it has rather than the window's.
 *
 * What stays Homiio's: the explore link between a card and its map chip — a
 * web hover reports the card's id, and the card whose marker was chosen is
 * outlined — plus an optional per-card footer (owner actions, saved notes).
 */
import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ListingCardGrid } from '@oxy.so/bloom/listing-card';

import { PropertyCard } from '@/components/PropertyCard';
import { colors } from '@/styles/colors';
import type { Property } from '@homiio/shared-types';

const IS_WEB = Platform.OS === 'web';

interface PropertyResultsGridProps {
  properties: readonly Property[];
  onPropertyPress: (property: Property) => void;
  highlightedPropertyId?: string | null;
  /**
   * Web-only — fired when a pointer enters a card, with the card's `id`. The
   * explore split view uses it to highlight the matching map price chip. The
   * list and map are a toggle on native and never co-visible, so hover is moot
   * there.
   */
  onPropertyHoverIn?: (id: string) => void;
  /** Web-only — fired when the pointer leaves a card (un-highlights the chip). */
  onPropertyHoverOut?: () => void;
  /** Container style (the page gutter). */
  style?: StyleProp<ViewStyle>;
  /**
   * Optional per-card footer, rendered under each card. Owner-facing lists (My
   * properties) attach edit/delete actions here without forking the card.
   */
  renderFooter?: (property: Property) => React.ReactNode;
}

export const PropertyResultsGrid: React.FC<PropertyResultsGridProps> = ({
  properties,
  onPropertyPress,
  highlightedPropertyId,
  onPropertyHoverIn,
  onPropertyHoverOut,
  style,
  renderFooter,
}) => {
  if (properties.length === 0) return null;

  return (
    <View style={style}>
      <ListingCardGrid>
        {properties.map((property) => (
          <View
            key={property.id}
            style={property.id === highlightedPropertyId ? styles.highlighted : null}
            onPointerEnter={
              IS_WEB && onPropertyHoverIn ? () => onPropertyHoverIn(property.id) : undefined
            }
            onPointerLeave={IS_WEB && onPropertyHoverOut ? onPropertyHoverOut : undefined}
          >
            <PropertyCard
              property={property}
              onPress={() => onPropertyPress(property)}
              footerContent={renderFooter ? renderFooter(property) : undefined}
            />
          </View>
        ))}
      </ListingCardGrid>
    </View>
  );
};

const styles = StyleSheet.create({
  // An outline, not a border: it draws outside the box, so the chosen card
  // neither shifts nor shrinks while its marker is selected.
  highlighted: {
    borderRadius: 20,
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: colors.primaryColor,
    outlineOffset: 4,
  },
});

export default PropertyResultsGrid;
