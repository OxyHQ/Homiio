import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Skeleton, SkeletonText } from './Skeleton';
import { colors } from '@/styles/colors';

export const PropertyDetailSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* Header image skeleton */}
      <Skeleton width="100%" height={250} borderRadius={0} style={styles.headerImage} />
      
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Title and location */}
        <View style={styles.section}>
          <SkeletonText lines={2} lastLineWidth="70%" lineHeight={24} lineSpacing={8} />
          <View style={styles.locationRow}>
            <Skeleton width={20} height={20} borderRadius={10} />
            <Skeleton width="60%" height={16} style={{ marginLeft: 8 }} />
          </View>
        </View>

        {/* Basic info pills */}
        <View style={styles.section}>
          <View style={styles.pillsRow}>
            <Skeleton width={80} height={32} borderRadius={16} />
            <Skeleton width={90} height={32} borderRadius={16} />
            <Skeleton width={75} height={32} borderRadius={16} />
          </View>
        </View>

        {/* Photo gallery */}
        <View style={styles.section}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.galleryRow}>
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton
                  key={index}
                  width={120}
                  height={90}
                  borderRadius={8}
                  style={styles.galleryImage}
                />
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Basic info section */}
        <View style={styles.section}>
          <Skeleton width="40%" height={20} style={styles.sectionTitle} />
          <View style={styles.infoGrid}>
            {Array.from({ length: 4 }).map((_, index) => (
              <View key={index} style={styles.infoItem}>
                <Skeleton width={30} height={30} borderRadius={15} />
                <SkeletonText lines={2} lastLineWidth="80%" lineHeight={14} lineSpacing={4} />
              </View>
            ))}
          </View>
        </View>

        {/* Property details card */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Skeleton width="50%" height={18} style={styles.cardTitle} />
            {Array.from({ length: 5 }).map((_, index) => (
              <View key={index} style={styles.detailRow}>
                <Skeleton width="30%" height={16} />
                <Skeleton width="40%" height={16} />
              </View>
            ))}
          </View>
        </View>

        {/* Features section */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Skeleton width="40%" height={18} style={styles.cardTitle} />
            <View style={styles.featuresGrid}>
              {Array.from({ length: 6 }).map((_, index) => (
                <View key={index} style={styles.featureItem}>
                  <Skeleton width={24} height={24} borderRadius={12} />
                  <Skeleton width="100%" height={14} style={{ marginTop: 6 }} />
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Pricing section */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Skeleton width="30%" height={18} style={styles.cardTitle} />
            <Skeleton width="60%" height={28} style={{ marginTop: 12 }} />
            {Array.from({ length: 3 }).map((_, index) => (
              <View key={index} style={styles.detailRow}>
                <Skeleton width="40%" height={16} />
                <Skeleton width="30%" height={16} />
              </View>
            ))}
          </View>
        </View>

        {/* Location section */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Skeleton width="35%" height={18} style={styles.cardTitle} />
            <Skeleton width="100%" height={200} borderRadius={12} style={{ marginTop: 12 }} />
            <SkeletonText lines={2} lastLineWidth="85%" lineHeight={16} lineSpacing={6} style={{ marginTop: 12 }} />
          </View>
        </View>

        {/* Action bar space */}
        <View style={styles.actionBarSpace} />
      </ScrollView>

      {/* Action bar skeleton */}
      <View style={styles.actionBar}>
        <View style={styles.priceSection}>
          <Skeleton width={80} height={20} />
          <Skeleton width={60} height={16} style={{ marginTop: 4 }} />
        </View>
        <Skeleton width={140} height={48} borderRadius={24} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  headerImage: {
    backgroundColor: '#f0f0f0',
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  galleryRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
  },
  galleryImage: {
    backgroundColor: '#f0f0f0',
  },
  sectionTitle: {
    marginBottom: 16,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  infoItem: {
    alignItems: 'center',
    width: '22%',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  featureItem: {
    alignItems: 'center',
    width: '30%',
  },
  actionBarSpace: {
    height: 80,
  },
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  priceSection: {
    flex: 1,
  },
});
