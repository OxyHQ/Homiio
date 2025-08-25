import React from 'react';
import { View, ScrollView } from 'react-native';
import { Skeleton, SkeletonText } from './Skeleton';
import { colors } from '@/styles/colors';

interface TipsSkeletonProps {
  itemCount?: number;
}

export function TipsSkeleton({ itemCount = 6 }: TipsSkeletonProps) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.primaryLight }}>
      {/* Header */}
      <View style={{ padding: 20, alignItems: 'center' }}>
        <Skeleton width={120} height={28} style={{ marginBottom: 8 }} />
        <Skeleton width={200} height={16} />
      </View>
      
      {/* Tips Grid */}
      <View style={{ padding: 16 }}>
        {Array.from({ length: itemCount }).map((_, index) => (
          <TipCardSkeleton key={index} />
        ))}
      </View>
    </ScrollView>
  );
}

function TipCardSkeleton() {
  return (
    <View style={{
      backgroundColor: 'white',
      borderRadius: 12,
      marginBottom: 16,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 3
    }}>
      {/* Gradient Header */}
      <Skeleton width={'100%' as any} height={120} borderRadius={0} />
      
      {/* Content */}
      <View style={{ padding: 16 }}>
        {/* Category Tag */}
        <Skeleton width={80} height={20} borderRadius={10} style={{ marginBottom: 12 }} />
        
        {/* Title */}
        <Skeleton width={'90%' as any} height={20} style={{ marginBottom: 8 }} />
        
        {/* Description */}
        <SkeletonText lines={2} lineHeight={16} lastLineWidth={'85%' as any} style={{ marginBottom: 16 }} />
        
        {/* Footer */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton width={16} height={16} borderRadius={8} />
            <Skeleton width={80} height={14} style={{ marginLeft: 8 }} />
          </View>
          <Skeleton width={60} height={14} />
        </View>
      </View>
    </View>
  );
}

export function TipDetailSkeleton() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.primaryLight }}>
      {/* Header Image */}
      <Skeleton width={'100%' as any} height={200} borderRadius={0} />
      
      {/* Content */}
      <View style={{ padding: 20 }}>
        {/* Category */}
        <Skeleton width={100} height={18} borderRadius={9} style={{ marginBottom: 12 }} />
        
        {/* Title */}
        <Skeleton width={'95%' as any} height={28} style={{ marginBottom: 16 }} />
        
        {/* Meta Info */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton width={16} height={16} borderRadius={8} />
            <Skeleton width={100} height={14} style={{ marginLeft: 8 }} />
          </View>
          <Skeleton width={80} height={14} />
        </View>
        
        {/* Content Paragraphs */}
        <View style={{ marginBottom: 20 }}>
          <SkeletonText lines={3} lineHeight={18} lastLineWidth={'70%' as any} style={{ marginBottom: 16 }} />
          <SkeletonText lines={2} lineHeight={18} lastLineWidth={'85%' as any} style={{ marginBottom: 16 }} />
          <SkeletonText lines={4} lineHeight={18} lastLineWidth={'60%' as any} style={{ marginBottom: 16 }} />
        </View>
        
        {/* Action Buttons */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Skeleton width={'48%' as any} height={48} borderRadius={8} />
          <Skeleton width={'48%' as any} height={48} borderRadius={8} />
        </View>
      </View>
    </ScrollView>
  );
}
