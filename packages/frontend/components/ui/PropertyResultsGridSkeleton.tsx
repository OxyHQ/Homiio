/**
 * PropertyResultsGridSkeleton — the loading state of `PropertyResultsGrid`.
 *
 * The same Bloom `ListingCardGrid` holding `ListingCard`s in their `loading`
 * state, so the placeholders take exactly the columns, photo ratio and text
 * lines the loaded grid will — nothing shifts when results arrive.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { ListingCard, ListingCardGrid } from '@oxy.so/bloom/listing-card';

interface PropertyResultsGridSkeletonProps {
  count?: number;
  style?: StyleProp<ViewStyle>;
}

const NO_PHOTOS: readonly string[] = [];

export const PropertyResultsGridSkeleton: React.FC<PropertyResultsGridSkeletonProps> = ({
  count = 6,
  style,
}) => (
  <View style={style}>
    <ListingCardGrid>
      {Array.from({ length: count }, (_, index) => (
        <ListingCard key={index} loading photos={NO_PHOTOS} title="" />
      ))}
    </ListingCardGrid>
  </View>
);

export default PropertyResultsGridSkeleton;
