import type React from 'react';
import { View, StyleSheet } from 'react-native';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { TextLines } from './TextLines';

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
        <View key={index} className="bg-card" style={styles.gridItem}>
          <Skeleton.Box width="100%" height={180} borderRadius={12} />
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
        <View key={index} className="bg-card" style={styles.listItem}>
          <Skeleton.Box width={120} height={100} borderRadius={12} />
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

  return <View>{viewMode === 'grid' ? renderGridSkeleton() : renderListSkeleton()}</View>;
};

const styles = StyleSheet.create({
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  gridItem: {
    width: '47%',
    borderRadius: 12,
    overflow: 'hidden',
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
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
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
