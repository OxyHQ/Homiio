import React from 'react';
import { View, StyleSheet, FlatList, ViewStyle } from 'react-native';
import { PropertyCard, PropertyType } from './PropertyCard';

export type Property = {
    id: string;
    title: string;
    location: string;
    price: number;
    currency?: string;
    type: PropertyType;
    imageUrl: string;
    bedrooms: number;
    bathrooms: number;
    size: number;
    sizeUnit?: string;
    isFavorite?: boolean;
    isVerified?: boolean;
};

type PropertyListProps = {
    properties: Property[];
    onPropertyPress?: (property: Property) => void;
    onFavoritePress?: (property: Property) => void;
    numColumns?: number;
    horizontal?: boolean;
    style?: ViewStyle;
    contentContainerStyle?: ViewStyle;
    ItemSeparatorComponent?: React.ComponentType<any>;
};

export function PropertyList({
    properties,
    onPropertyPress,
    onFavoritePress,
    numColumns = 1,
    horizontal = false,
    style,
    contentContainerStyle,
    ItemSeparatorComponent,
}: PropertyListProps) {
    const renderItem = ({ item }: { item: Property }) => {
        const cardStyle = {
            ...styles.card,
            ...(numColumns > 1 ? { flex: 1 / numColumns } : {}),
            ...(horizontal ? styles.horizontalCard : {}),
        };

        return (
            <PropertyCard
                {...item}
                onPress={() => onPropertyPress?.(item)}
                onFavoritePress={() => onFavoritePress?.(item)}
                style={cardStyle}
            />
        );
    };

    return (
        <FlatList
            data={properties}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            numColumns={horizontal ? 1 : numColumns}
            horizontal={horizontal}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={style}
            contentContainerStyle={[
                styles.contentContainer,
                contentContainerStyle,
            ]}
            ItemSeparatorComponent={ItemSeparatorComponent}
        />
    );
}

const styles = StyleSheet.create({
    contentContainer: {
        padding: 16,
        gap: 16,
    },
    card: {
        marginHorizontal: 8,
        marginBottom: 16,
    },
    horizontalCard: {
        width: 300,
    },
}); 