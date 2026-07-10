import React from 'react';
import { View } from 'react-native';
import { Skeleton } from '@oxyhq/bloom';
import { TextLines } from './TextLines';
import { colors } from '@/styles/colors';
import { radius, spacing, withShadow } from '@/constants/styles';

interface TipsSkeletonProps {
  itemCount?: number;
  featured?: boolean;
}

export function TipsSkeleton({ itemCount = 4, featured = true }: TipsSkeletonProps) {
  return (
    <View style={{ gap: spacing.xl }}>
      {featured ? <FeaturedTipCardSkeleton /> : null}
      <View style={{ gap: spacing.lg }}>
        {Array.from({ length: itemCount }).map((_, index) => (
          <TipCardSkeleton key={index} />
        ))}
      </View>
    </View>
  );
}

function FeaturedTipCardSkeleton() {
  return (
    <View
      style={{
        backgroundColor: colors.surfaceElevated,
        borderRadius: radius.xl,
        overflow: 'hidden',
        ...withShadow('sm'),
      }}
    >
      <Skeleton.Box width="100%" height={260} borderRadius={0} />
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Skeleton.Box width="90%" height={24} />
        <TextLines lines={2} lineHeight={16} lastLineWidth="85%" />
        <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs }}>
          <Skeleton.Box width={80} height={14} />
          <Skeleton.Box width={100} height={14} />
        </View>
      </View>
    </View>
  );
}

function TipCardSkeleton() {
  return (
    <View
      style={{
        backgroundColor: colors.surfaceElevated,
        borderRadius: radius.lg,
        overflow: 'hidden',
        ...withShadow('sm'),
      }}
    >
      <Skeleton.Box width="100%" height={180} borderRadius={0} />
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Skeleton.Box width="90%" height={20} />
        <TextLines lines={2} lineHeight={16} lastLineWidth="85%" />
        <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs }}>
          <Skeleton.Box width={80} height={14} />
          <Skeleton.Box width={100} height={14} />
        </View>
      </View>
    </View>
  );
}

export function TipDetailSkeleton() {
  return (
    <View style={{ padding: spacing.lg, gap: spacing['2xl'] }}>
      <Skeleton.Box width="100%" height={280} borderRadius={radius.xl} />
      <View style={{ gap: spacing.sm }}>
        <Skeleton.Box width={100} height={18} borderRadius={radius.pill} />
        <Skeleton.Box width="95%" height={32} />
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <Skeleton.Box width={100} height={14} />
          <Skeleton.Box width={80} height={14} />
          <Skeleton.Box width={110} height={14} />
        </View>
        <TextLines lines={2} lineHeight={18} lastLineWidth="70%" />
      </View>
      <View style={{ gap: spacing.md }}>
        <TextLines lines={3} lineHeight={18} lastLineWidth="70%" />
        <TextLines lines={2} lineHeight={18} lastLineWidth="85%" />
        <TextLines lines={4} lineHeight={18} lastLineWidth="60%" />
      </View>
    </View>
  );
}
