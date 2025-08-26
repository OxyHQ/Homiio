import React from 'react';
import { View, ScrollView } from 'react-native';
import { Skeleton } from './Skeleton';
import { colors } from '@/styles/colors';

interface SearchSkeletonProps {
  showFilters?: boolean;
  itemCount?: number;
}

export function SearchSkeleton({ showFilters = true, itemCount = 6 }: SearchSkeletonProps) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.primaryLight }}>
      {/* Search Bar */}
      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Skeleton width={'85%' as any} height={48} borderRadius={24} />
          <Skeleton width={48} height={48} borderRadius={24} />
        </View>
      </View>
      
      {/* Filters */}
      {showFilters && (
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} width={80} height={32} borderRadius={16} />
              ))}
            </View>
          </ScrollView>
        </View>
      )}
      
      {/* Results Count */}
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <Skeleton width={150} height={16} />
      </View>
      
      {/* Search Results */}
      <View style={{ paddingHorizontal: 16 }}>
        {Array.from({ length: itemCount }).map((_, index) => (
          <SearchResultSkeleton key={index} />
        ))}
      </View>
    </ScrollView>
  );
}

function SearchResultSkeleton() {
  return (
    <View style={{
      backgroundColor: 'white',
      borderRadius: 12,
      marginBottom: 16,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3
    }}>
      {/* Image */}
      <Skeleton width={'100%' as any} height={200} borderRadius={0} />
      
      {/* Content */}
      <View style={{ padding: 16 }}>
        {/* Title and Price */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <Skeleton width={'65%' as any} height={20} />
          <Skeleton width={80} height={24} borderRadius={4} />
        </View>
        
        {/* Location */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Skeleton width={16} height={16} borderRadius={8} />
          <Skeleton width={120} height={16} style={{ marginLeft: 8 }} />
        </View>
        
        {/* Features */}
        <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton width={16} height={16} borderRadius={8} />
            <Skeleton width={40} height={14} style={{ marginLeft: 4 }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton width={16} height={16} borderRadius={8} />
            <Skeleton width={40} height={14} style={{ marginLeft: 4 }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton width={16} height={16} borderRadius={8} />
            <Skeleton width={50} height={14} style={{ marginLeft: 4 }} />
          </View>
        </View>
        
        {/* Tags */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Skeleton width={60} height={20} borderRadius={10} />
          <Skeleton width={80} height={20} borderRadius={10} />
          <Skeleton width={70} height={20} borderRadius={10} />
        </View>
      </View>
    </View>
  );
}
