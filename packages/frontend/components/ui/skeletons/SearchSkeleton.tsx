import React from 'react';
import { View, ScrollView } from 'react-native';
import { Skeleton } from '@oxyhq/bloom';
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
          <Skeleton.Box width="85%" height={48} borderRadius={24} />
          <Skeleton.Box width={48} height={48} borderRadius={24} />
        </View>
      </View>

      {/* Filters */}
      {showFilters && (
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton.Box key={index} width={80} height={32} borderRadius={16} />
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {/* Results Count */}
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <Skeleton.Box width={150} height={16} />
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
    <View
      style={{
        backgroundColor: colors.white,
        borderRadius: 12,
        marginBottom: 16,
        overflow: 'hidden',
        shadowColor: colors.COLOR_BLACK,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
      }}>
      {/* Image */}
      <Skeleton.Box width="100%" height={200} borderRadius={0} />

      {/* Content */}
      <View style={{ padding: 16 }}>
        {/* Title and Price */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 8,
          }}>
          <Skeleton.Box width="65%" height={20} />
          <Skeleton.Box width={80} height={24} borderRadius={4} />
        </View>

        {/* Location */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Skeleton.Box width={16} height={16} borderRadius={8} />
          <Skeleton.Box width={120} height={16} style={{ marginLeft: 8 }} />
        </View>

        {/* Features */}
        <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton.Box width={16} height={16} borderRadius={8} />
            <Skeleton.Box width={40} height={14} style={{ marginLeft: 4 }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton.Box width={16} height={16} borderRadius={8} />
            <Skeleton.Box width={40} height={14} style={{ marginLeft: 4 }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton.Box width={16} height={16} borderRadius={8} />
            <Skeleton.Box width={50} height={14} style={{ marginLeft: 4 }} />
          </View>
        </View>

        {/* Tags */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Skeleton.Box width={60} height={20} borderRadius={10} />
          <Skeleton.Box width={80} height={20} borderRadius={10} />
          <Skeleton.Box width={70} height={20} borderRadius={10} />
        </View>
      </View>
    </View>
  );
}
