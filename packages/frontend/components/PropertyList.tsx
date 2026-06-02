import React from 'react';
import { View, StyleSheet, FlatList, ViewStyle, ViewProps, FlatListProps, Dimensions, Platform } from 'react-native';
import { PropertyCard } from './PropertyCard';
import { Property } from '@/services/propertyService';
import { PROPERTY_GRID_GAP, spacing } from '@/constants/styles';

const { width: screenWidth } = Dimensions.get('window');
const AIRBNB_CARD_WIDTH = 180;

/**
 * Horizontal space the content padding reserves on both sides of a multi-column
 * grid row, so the measured card width never overflows the gutter. Derived from
 * the shared page gutter (`spacing.lg`) the rest of the property grids use.
 */
const GRID_CONTENT_INSET = spacing.lg * 2;

// Web-only pointer handlers. RN's ViewProps omits mouse events, but RN-Web
// forwards them; spreading the object keeps the View typings intact.
type WebHoverHandlers = {
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

type PropertyListProps = {
  properties: Property[];
  onPropertyPress?: (property: Property) => void;
  onItemHover?: (property: Property | null) => void;
  numColumns?: number;
  horizontal?: boolean;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  ItemSeparatorComponent?: FlatListProps<Property>['ItemSeparatorComponent'];
  variant?: 'default' | 'compact' | 'featured' | 'saved';
};

export function PropertyList({
  properties,
  onPropertyPress,
  onItemHover,
  numColumns = 1,
  horizontal = false,
  style,
  contentContainerStyle,
  ItemSeparatorComponent,
  variant = 'default',
}: PropertyListProps) {
  const renderItem = ({ item }: { item: Property }) => {
    const isGrid = numColumns > 1;
    const cardStyle = {
      ...styles.card,
      ...(isGrid
        ? {
          // Subtract the row inset and the inter-column gaps so N cards plus
          // their `PROPERTY_GRID_GAP` gutters fit the content width exactly.
          width: Math.min(
            (screenWidth - GRID_CONTENT_INSET - PROPERTY_GRID_GAP * (numColumns - 1)) /
              numColumns,
            AIRBNB_CARD_WIDTH,
          ),
        }
        : {}),
      ...(horizontal ? styles.horizontalCard : {}),
    };

    const hoverHandlers: WebHoverHandlers =
      Platform.OS === 'web' && onItemHover
        ? {
          onMouseEnter: () => onItemHover(item),
          onMouseLeave: () => onItemHover(null),
        }
        : {};

    const Wrapper: React.FC<ViewProps> = ({ children, ...props }) => (
      <View {...props} {...hoverHandlers}>
        {children}
      </View>
    );

    return (
      <Wrapper style={cardStyle}>
        <PropertyCard property={item} variant={variant} onPress={() => onPropertyPress?.(item)} />
      </Wrapper>
    );
  };

  return (
    <FlatList
      data={properties}
      renderItem={renderItem}
      keyExtractor={(item) => item._id || item.id || ''}
      numColumns={horizontal ? 1 : numColumns}
      horizontal={horizontal}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      style={style}
      contentContainerStyle={[styles.contentContainer, contentContainerStyle]}
      ItemSeparatorComponent={ItemSeparatorComponent}
      columnWrapperStyle={numColumns > 1 ? styles.columnWrapper : undefined}
    />
  );
}

const styles = StyleSheet.create({
  // Page gutter shared with the rest of the property grids (`spacing.lg`), so a
  // `PropertyList` lines up to the same left edge as `PropertyResultsGrid`.
  contentContainer: {
    padding: spacing.lg,
  },
  // Multi-column rows: the inter-column gutter is the shared `PROPERTY_GRID_GAP`
  // (same value the other property grids use). Row-to-row spacing is owned by
  // each card's `marginBottom` below, so it stays a single source of truth and
  // rows never double-space.
  columnWrapper: {
    justifyContent: 'flex-start',
    gap: PROPERTY_GRID_GAP,
    alignItems: 'stretch',
    flexDirection: 'row',
  },
  card: {
    marginBottom: PROPERTY_GRID_GAP,
    flex: 1,
    alignSelf: 'stretch',
  },
  horizontalCard: {
    width: AIRBNB_CARD_WIDTH,
    marginRight: PROPERTY_GRID_GAP,
  },
});
