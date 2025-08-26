import React from 'react';
import { View, ScrollView } from 'react-native';
import { Skeleton, SkeletonText } from './Skeleton';
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
          <Skeleton width={120} height={120} borderRadius={60} />
          
          {/* Name and Status */}
          <View style={{ alignItems: 'center', marginTop: 16 }}>
            <Skeleton width={200} height={24} />
            <Skeleton width={150} height={16} style={{ marginTop: 8 }} />
          </View>
          
          {/* Stats Row */}
          <View style={{ flexDirection: 'row', marginTop: 20, gap: 24 }}>
            <View style={{ alignItems: 'center' }}>
              <Skeleton width={40} height={20} />
              <Skeleton width={60} height={14} style={{ marginTop: 4 }} />
            </View>
            <View style={{ alignItems: 'center' }}>
              <Skeleton width={40} height={20} />
              <Skeleton width={60} height={14} style={{ marginTop: 4 }} />
            </View>
            <View style={{ alignItems: 'center' }}>
              <Skeleton width={40} height={20} />
              <Skeleton width={60} height={14} style={{ marginTop: 4 }} />
            </View>
          </View>
        </View>
      )}
      
      {showActions && (
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 20 }}>
          <Skeleton width={'48%' as any} height={44} borderRadius={8} />
          <Skeleton width={'48%' as any} height={44} borderRadius={8} />
        </View>
      )}
      
      {/* Profile Sections */}
      <View style={{ paddingHorizontal: 16 }}>
        {/* About Section */}
        <View style={{ marginBottom: 24 }}>
          <Skeleton width={100} height={20} style={{ marginBottom: 12 }} />
          <SkeletonText lines={3} lineHeight={16} lastLineWidth={'75%' as any} />
        </View>
        
        {/* Details Section */}
        <View style={{ marginBottom: 24 }}>
          <Skeleton width={120} height={20} style={{ marginBottom: 12 }} />
          {Array.from({ length: 4 }).map((_, index) => (
            <View key={index} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
              <Skeleton width={100} height={16} />
              <Skeleton width={120} height={16} />
            </View>
          ))}
        </View>
        
        {/* Preferences Section */}
        <View style={{ marginBottom: 24 }}>
          <Skeleton width={140} height={20} style={{ marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} width={80} height={32} borderRadius={16} />
            ))}
          </View>
        </View>
        
        {/* References Section */}
        <View style={{ marginBottom: 24 }}>
          <Skeleton width={100} height={20} style={{ marginBottom: 12 }} />
          {Array.from({ length: 2 }).map((_, index) => (
            <View key={index} style={{ 
              backgroundColor: 'white', 
              padding: 16, 
              borderRadius: 8, 
              marginBottom: 12,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.1,
              shadowRadius: 3,
              elevation: 2
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Skeleton width={40} height={40} borderRadius={20} />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Skeleton width={150} height={16} />
                  <Skeleton width={100} height={14} style={{ marginTop: 4 }} />
                </View>
              </View>
              <SkeletonText lines={2} lineHeight={14} lastLineWidth={'80%' as any} />
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
