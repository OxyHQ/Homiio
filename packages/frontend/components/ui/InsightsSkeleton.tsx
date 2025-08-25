import React from 'react';
import { View, ScrollView } from 'react-native';
import { Skeleton } from './Skeleton';
import { colors } from '@/styles/colors';

export function InsightsSkeleton() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.primaryLight }} contentContainerStyle={{ paddingBottom: 24 }}>
      {/* Header */}
      <View style={{ padding: 20, alignItems: 'center' }}>
        <Skeleton width={200} height={28} style={{ marginBottom: 8 }} />
        <Skeleton width={150} height={16} />
      </View>
      
      {/* Stats Cards */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 24 }}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View key={index} style={{ 
            flex: 1, 
            backgroundColor: 'white', 
            padding: 16, 
            borderRadius: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 3
          }}>
            <Skeleton width={40} height={40} borderRadius={20} style={{ marginBottom: 12 }} />
            <Skeleton width={60} height={24} style={{ marginBottom: 8 }} />
            <Skeleton width={'80%' as any} height={14} />
          </View>
        ))}
      </View>
      
      {/* Chart Section */}
      <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
        <View style={{ 
          backgroundColor: 'white', 
          padding: 20, 
          borderRadius: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 3
        }}>
          <Skeleton width={150} height={20} style={{ marginBottom: 16 }} />
          <Skeleton width={'100%' as any} height={200} borderRadius={8} />
        </View>
      </View>
      
      {/* Top Properties Section */}
      <View style={{ marginHorizontal: 16 }}>
        <Skeleton width={180} height={24} style={{ marginBottom: 16 }} />
        
        {Array.from({ length: 3 }).map((_, index) => (
          <View key={index} style={{
            backgroundColor: 'white',
            borderRadius: 12,
            marginBottom: 12,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 3
          }}>
            <View style={{ flexDirection: 'row' }}>
              <Skeleton width={100} height={80} borderRadius={0} />
              <View style={{ flex: 1, padding: 12 }}>
                <Skeleton width={'80%' as any} height={16} style={{ marginBottom: 8 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <Skeleton width={12} height={12} borderRadius={6} />
                  <Skeleton width={100} height={14} style={{ marginLeft: 6 }} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Skeleton width={80} height={20} borderRadius={4} />
                  <Skeleton width={60} height={14} />
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
