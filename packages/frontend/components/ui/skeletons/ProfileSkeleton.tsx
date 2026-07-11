import React from 'react';
import { View, ScrollView } from 'react-native';
import { Skeleton } from '@oxyhq/bloom';
import { TextLines } from './TextLines';
import { colors } from '@/styles/colors';

interface ProfileSkeletonProps {
  showHeader?: boolean;
  showActions?: boolean;
}

export function ProfileSkeleton({ showHeader = true, showActions = true }: ProfileSkeletonProps) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.primaryLight }}>
      {showHeader && (
        <View style={{ padding: 16, alignItems: 'center' }}>
          {/* Profile Picture */}
          <Skeleton.Box width={120} height={120} borderRadius={60} />

          {/* Name and Status */}
          <View style={{ alignItems: 'center', marginTop: 16 }}>
            <Skeleton.Box width={200} height={24} />
            <Skeleton.Box width={150} height={16} style={{ marginTop: 8 }} />
          </View>

          {/* Stats Row */}
          <View style={{ flexDirection: 'row', marginTop: 20, gap: 24 }}>
            <View style={{ alignItems: 'center' }}>
              <Skeleton.Box width={40} height={20} />
              <Skeleton.Box width={60} height={14} style={{ marginTop: 4 }} />
            </View>
            <View style={{ alignItems: 'center' }}>
              <Skeleton.Box width={40} height={20} />
              <Skeleton.Box width={60} height={14} style={{ marginTop: 4 }} />
            </View>
            <View style={{ alignItems: 'center' }}>
              <Skeleton.Box width={40} height={20} />
              <Skeleton.Box width={60} height={14} style={{ marginTop: 4 }} />
            </View>
          </View>
        </View>
      )}

      {showActions && (
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 20 }}>
          <Skeleton.Box width="48%" height={44} borderRadius={8} />
          <Skeleton.Box width="48%" height={44} borderRadius={8} />
        </View>
      )}

      {/* Profile Sections */}
      <View style={{ paddingHorizontal: 16 }}>
        {/* About Section */}
        <View style={{ marginBottom: 24 }}>
          <Skeleton.Box width={100} height={20} style={{ marginBottom: 12 }} />
          <TextLines lines={3} lineHeight={16} lastLineWidth="75%" />
        </View>

        {/* Details Section */}
        <View style={{ marginBottom: 24 }}>
          <Skeleton.Box width={120} height={20} style={{ marginBottom: 12 }} />
          {Array.from({ length: 4 }).map((_, index) => (
            <View
              key={index}
              style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
              <Skeleton.Box width={100} height={16} />
              <Skeleton.Box width={120} height={16} />
            </View>
          ))}
        </View>

        {/* Preferences Section */}
        <View style={{ marginBottom: 24 }}>
          <Skeleton.Box width={140} height={20} style={{ marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton.Box key={index} width={80} height={32} borderRadius={16} />
            ))}
          </View>
        </View>

        {/* References Section */}
        <View style={{ marginBottom: 24 }}>
          <Skeleton.Box width={100} height={20} style={{ marginBottom: 12 }} />
          {Array.from({ length: 2 }).map((_, index) => (
            <View
              key={index}
              style={{
                backgroundColor: colors.white,
                padding: 16,
                borderRadius: 8,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: colors.border,
              }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Skeleton.Box width={40} height={40} borderRadius={20} />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Skeleton.Box width={150} height={16} />
                  <Skeleton.Box width={100} height={14} style={{ marginTop: 4 }} />
                </View>
              </View>
              <TextLines lines={2} lineHeight={14} lastLineWidth="80%" />
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
