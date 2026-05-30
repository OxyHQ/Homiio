import React from 'react';
import { View, ScrollView } from 'react-native';
import { Skeleton } from '@oxyhq/bloom';
import { TextLines } from './TextLines';
import { colors } from '@/styles/colors';

interface TipsSkeletonProps {
  itemCount?: number;
}

export function TipsSkeleton({ itemCount = 6 }: TipsSkeletonProps) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.primaryLight }}>
      {/* Header */}
      <View style={{ padding: 20, alignItems: 'center' }}>
        <Skeleton.Box width={120} height={28} style={{ marginBottom: 8 }} />
        <Skeleton.Box width={200} height={16} />
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
    <View
      style={{
        backgroundColor: colors.white,
        borderRadius: 12,
        marginBottom: 16,
        overflow: 'hidden',
        shadowColor: colors.COLOR_BLACK,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
      }}>
      {/* Gradient Header */}
      <Skeleton.Box width="100%" height={120} borderRadius={0} />

      {/* Content */}
      <View style={{ padding: 16 }}>
        {/* Category Tag */}
        <Skeleton.Box width={80} height={20} borderRadius={10} style={{ marginBottom: 12 }} />

        {/* Title */}
        <Skeleton.Box width="90%" height={20} style={{ marginBottom: 8 }} />

        {/* Description */}
        <TextLines lines={2} lineHeight={16} lastLineWidth="85%" style={{ marginBottom: 16 }} />

        {/* Footer */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton.Box width={16} height={16} borderRadius={8} />
            <Skeleton.Box width={80} height={14} style={{ marginLeft: 8 }} />
          </View>
          <Skeleton.Box width={60} height={14} />
        </View>
      </View>
    </View>
  );
}

export function TipDetailSkeleton() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.primaryLight }}>
      {/* Header Image */}
      <Skeleton.Box width="100%" height={200} borderRadius={0} />

      {/* Content */}
      <View style={{ padding: 20 }}>
        {/* Category */}
        <Skeleton.Box width={100} height={18} borderRadius={9} style={{ marginBottom: 12 }} />

        {/* Title */}
        <Skeleton.Box width="95%" height={28} style={{ marginBottom: 16 }} />

        {/* Meta Info */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton.Box width={16} height={16} borderRadius={8} />
            <Skeleton.Box width={100} height={14} style={{ marginLeft: 8 }} />
          </View>
          <Skeleton.Box width={80} height={14} />
        </View>

        {/* Content Paragraphs */}
        <View style={{ marginBottom: 20 }}>
          <TextLines lines={3} lineHeight={18} lastLineWidth="70%" style={{ marginBottom: 16 }} />
          <TextLines lines={2} lineHeight={18} lastLineWidth="85%" style={{ marginBottom: 16 }} />
          <TextLines lines={4} lineHeight={18} lastLineWidth="60%" style={{ marginBottom: 16 }} />
        </View>

        {/* Action Buttons */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Skeleton.Box width="48%" height={48} borderRadius={8} />
          <Skeleton.Box width="48%" height={48} borderRadius={8} />
        </View>
      </View>
    </ScrollView>
  );
}
