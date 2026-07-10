import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Skeleton } from '@oxyhq/bloom';
import { TextLines } from './TextLines';
import { colors } from '@/styles/colors';

interface PropertyListSkeletonProps {
  viewMode?: 'list' | 'grid';
  itemCount?: number;
}

export const PropertyListSkeleton: React.FC<PropertyListSkeletonProps> = ({
  viewMode = 'list',
  itemCount = 6,
}) => {
  const renderGridSkeleton = () => (
    <View style={styles.gridContainer}>
      {Array.from({ length: itemCount }).map((_, index) => (
        <View key={index} style={styles.gridItem}>
          <Skeleton.Box width="100%" height={180} borderRadius={12} style={styles.gridImage} />
          <View style={styles.gridContent}>
            <TextLines lines={2} lastLineWidth="80%" lineHeight={16} lineSpacing={6} />
            <View style={styles.gridPriceRow}>
              <Skeleton.Box width="40%" height={14} />
              <Skeleton.Box width={20} height={20} borderRadius={10} />
            </View>
            <View style={styles.gridInfoRow}>
              <Skeleton.Box width="30%" height={12} />
              <Skeleton.Box width="25%" height={12} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );

  const renderListSkeleton = () => (
    <View style={styles.listContainer}>
      {Array.from({ length: itemCount }).map((_, index) => (
        <View key={index} style={styles.listItem}>
          <Skeleton.Box width={120} height={100} borderRadius={12} style={styles.listImage} />
          <View style={styles.listContent}>
            <TextLines lines={2} lastLineWidth="70%" lineHeight={16} lineSpacing={6} />
            <View style={styles.listPriceRow}>
              <Skeleton.Box width="50%" height={14} style={{ marginTop: 8 }} />
              <Skeleton.Box width={24} height={24} borderRadius={12} />
            </View>
            <View style={styles.listInfoRow}>
              <Skeleton.Box width="40%" height={12} />
              <Skeleton.Box width="30%" height={12} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {viewMode === 'grid' ? renderGridSkeleton() : renderListSkeleton()}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  gridItem: {
    width: '47%',
    backgroundColor: colors.white,
    borderRadius: 12,
    overflow: 'hidden',
  },
  gridImage: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
  },
  gridContent: {
    padding: 12,
  },
  gridPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  gridInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 16,
  },
  listItem: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
  },
  listImage: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
  },
  listContent: {
    flex: 1,
  },
  listPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
});
