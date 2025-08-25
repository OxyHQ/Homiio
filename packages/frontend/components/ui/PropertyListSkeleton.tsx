import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Skeleton, SkeletonText } from './Skeleton';
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
          <Skeleton width="100%" height={180} borderRadius={12} style={styles.gridImage} />
          <View style={styles.gridContent}>
            <SkeletonText lines={2} lastLineWidth="80%" lineHeight={16} lineSpacing={6} />
            <View style={styles.gridPriceRow}>
              <Skeleton width="40%" height={14} />
              <Skeleton width={20} height={20} borderRadius={10} />
            </View>
            <View style={styles.gridInfoRow}>
              <Skeleton width="30%" height={12} />
              <Skeleton width="25%" height={12} />
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
          <Skeleton width={120} height={100} borderRadius={12} style={styles.listImage} />
          <View style={styles.listContent}>
            <SkeletonText lines={2} lastLineWidth="70%" lineHeight={16} lineSpacing={6} />
            <View style={styles.listPriceRow}>
              <Skeleton width="50%" height={14} style={{ marginTop: 8 }} />
              <Skeleton width={24} height={24} borderRadius={12} />
            </View>
            <View style={styles.listInfoRow}>
              <Skeleton width="40%" height={12} />
              <Skeleton width="30%" height={12} />
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
    backgroundColor: '#ffffff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  gridImage: {
    backgroundColor: '#f0f0f0',
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
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  listImage: {
    backgroundColor: '#f0f0f0',
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
