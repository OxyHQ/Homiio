import React from 'react';
import { View, StyleSheet, FlatList, ViewStyle, Dimensions } from 'react-native';
import { PropertyCard } from './PropertyCard';
import { Property } from '@/services/propertyService';

const { width: screenWidth } = Dimensions.get('window');
const AIRBNB_CARD_WIDTH = 180;

type PropertyListProps = {
    properties: Property[];
    onPropertyPress?: (property: Property) => void;
    numColumns?: number;
    horizontal?: boolean;
    style?: ViewStyle;
    contentContainerStyle?: ViewStyle;
    ItemSeparatorComponent?: React.ComponentType<any>;
    variant?: 'default' | 'compact' | 'featured' | 'saved';
};

export function PropertyList({
    properties,
    onPropertyPress,
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
            ...(isGrid ? {
                width: Math.min((screenWidth - 48) / numColumns, AIRBNB_CARD_WIDTH),
                marginHorizontal: 4,
            } : {}),
            ...(horizontal ? styles.horizontalCard : {}),
        };

        return (
            <PropertyCard
                property={item}
                variant={variant}
                onPress={() => onPropertyPress?.(item)}
                style={cardStyle}
            />
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
            contentContainerStyle={[
                styles.contentContainer,
                contentContainerStyle,
            ]}
            ItemSeparatorComponent={ItemSeparatorComponent}
            columnWrapperStyle={numColumns > 1 ? styles.columnWrapper : undefined}
        />
    );
}

const styles = StyleSheet.create({
    contentContainer: {
        padding: 16,
    },
    columnWrapper: {
        justifyContent: 'flex-start',
        marginBottom: 8,
        alignItems: 'stretch',
        flexDirection: 'row',
    },
    card: {
        marginBottom: 12,
        flex: 1,
        alignSelf: 'stretch',
    },
    horizontalCard: {
        width: AIRBNB_CARD_WIDTH,
        marginRight: 12,
    },
}); 