import React from 'react';
import { FlatList, FlatListProps, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';

// Use FlashList when available (native) for better performance
// Fall back to regular FlatList for web and other platforms where FlashList might not be available
const List = React.forwardRef((props: any, ref) => {
  // If we're on native platforms, use FlashList for better performance
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    // Make sure to provide estimatedItemSize for FlashList
    const estimatedItemSize = props.estimatedItemSize || 100;
    return <FlashList ref={ref} estimatedItemSize={estimatedItemSize} {...props} />;
  }
  
  // Otherwise fall back to FlatList for web and other platforms
  return <FlatList ref={ref} {...props} />;
});

export { List };