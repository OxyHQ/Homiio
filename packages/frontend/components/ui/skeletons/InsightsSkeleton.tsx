import React from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Skeleton } from '@oxyhq/bloom';
import { colors } from '@/styles/colors';

export function InsightsSkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.primaryLight }}
      contentContainerStyle={{ paddingBottom: 24 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: insets.top + 20, alignItems: 'center' }}>
        <Skeleton.Box width={200} height={28} style={{ marginBottom: 8 }} />
        <Skeleton.Box width={150} height={16} />
      </View>

      {/* Stats Cards */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 24 }}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              backgroundColor: colors.white,
              padding: 16,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <Skeleton.Box width={40} height={40} borderRadius={20} style={{ marginBottom: 12 }} />
            <Skeleton.Box width={60} height={24} style={{ marginBottom: 8 }} />
            <Skeleton.Box width="80%" height={14} />
          </View>
        ))}
      </View>

      {/* Chart Section */}
      <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
        <View
          style={{
            backgroundColor: colors.white,
            padding: 20,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
          }}>
          <Skeleton.Box width={150} height={20} style={{ marginBottom: 16 }} />
          <Skeleton.Box width="100%" height={200} borderRadius={8} />
        </View>
      </View>

      {/* Top Properties Section */}
      <View style={{ marginHorizontal: 16 }}>
        <Skeleton.Box width={180} height={24} style={{ marginBottom: 16 }} />

        {Array.from({ length: 3 }).map((_, index) => (
          <View
            key={index}
            style={{
              backgroundColor: colors.white,
              borderRadius: 12,
              marginBottom: 12,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <View style={{ flexDirection: 'row' }}>
              <Skeleton.Box width={100} height={80} borderRadius={0} />
              <View style={{ flex: 1, padding: 12 }}>
                <Skeleton.Box width="80%" height={16} style={{ marginBottom: 8 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <Skeleton.Box width={12} height={12} borderRadius={6} />
                  <Skeleton.Box width={100} height={14} style={{ marginLeft: 6 }} />
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                  <Skeleton.Box width={80} height={20} borderRadius={4} />
                  <Skeleton.Box width={60} height={14} />
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
