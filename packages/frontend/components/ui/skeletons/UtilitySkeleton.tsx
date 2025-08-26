import React from 'react';
import { View, DimensionValue } from 'react-native';
import { Skeleton } from './Skeleton';

interface ButtonSkeletonProps {
  width?: DimensionValue;
  height?: number;
  style?: any;
}

export function ButtonSkeleton({ width = 120, height = 44, style }: ButtonSkeletonProps) {
  return (
    <Skeleton 
      width={width} 
      height={height} 
      borderRadius={8} 
      style={style} 
    />
  );
}

interface FormSkeletonProps {
  fieldCount?: number;
  showSubmitButton?: boolean;
}

export function FormSkeleton({ fieldCount = 4, showSubmitButton = true }: FormSkeletonProps) {
  return (
    <View style={{ padding: 16 }}>
      {Array.from({ length: fieldCount }).map((_, index) => (
        <View key={index} style={{ marginBottom: 20 }}>
          <Skeleton width={100} height={16} style={{ marginBottom: 8 }} />
          <Skeleton width={'100%' as any} height={48} borderRadius={8} />
        </View>
      ))}
      
      {showSubmitButton && (
        <ButtonSkeleton width={'100%' as any} style={{ marginTop: 20 }} />
      )}
    </View>
  );
}

interface ListItemSkeletonProps {
  showAvatar?: boolean;
  showIcon?: boolean;
  style?: any;
}

export function ListItemSkeleton({ showAvatar = false, showIcon = false, style }: ListItemSkeletonProps) {
  return (
    <View style={[{ 
      flexDirection: 'row', 
      alignItems: 'center', 
      padding: 16,
      backgroundColor: 'white',
      borderBottomWidth: 1,
      borderBottomColor: '#f0f0f0'
    }, style]}>
      {showAvatar && (
        <Skeleton width={40} height={40} borderRadius={20} style={{ marginRight: 12 }} />
      )}
      
      <View style={{ flex: 1 }}>
        <Skeleton width={'80%' as any} height={16} style={{ marginBottom: 4 }} />
        <Skeleton width={'60%' as any} height={14} />
      </View>
      
      {showIcon && (
        <Skeleton width={24} height={24} borderRadius={4} />
      )}
    </View>
  );
}
