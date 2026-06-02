import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Skeleton } from '@oxyhq/bloom';
import { TextLines } from './TextLines';
import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';

export const PropertyDetailSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* Header image skeleton */}
      <Skeleton.Box width="100%" height={250} borderRadius={0} style={styles.headerImage} />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Title and location */}
        <View style={styles.section}>
          <TextLines lines={2} lastLineWidth="70%" lineHeight={24} lineSpacing={8} />
          <View style={styles.locationRow}>
            <Skeleton.Box width={20} height={20} borderRadius={10} />
            <Skeleton.Box width="60%" height={16} style={{ marginLeft: 8 }} />
          </View>
        </View>

        {/* Basic info pills */}
        <View style={styles.section}>
          <View style={styles.pillsRow}>
            <Skeleton.Box width={80} height={32} borderRadius={16} />
            <Skeleton.Box width={90} height={32} borderRadius={16} />
            <Skeleton.Box width={75} height={32} borderRadius={16} />
          </View>
        </View>

        {/* Photo gallery */}
        <View style={styles.section}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.galleryRow}>
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton.Box
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
          <Skeleton.Box width="40%" height={20} style={styles.sectionTitle} />
          <View style={styles.infoGrid}>
            {Array.from({ length: 4 }).map((_, index) => (
              <View key={index} style={styles.infoItem}>
                <Skeleton.Box width={30} height={30} borderRadius={15} />
                <TextLines lines={2} lastLineWidth="80%" lineHeight={14} lineSpacing={4} />
              </View>
            ))}
          </View>
        </View>

        {/* Property details card */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Skeleton.Box width="50%" height={18} style={styles.cardTitle} />
            {Array.from({ length: 5 }).map((_, index) => (
              <View key={index} style={styles.detailRow}>
                <Skeleton.Box width="30%" height={16} />
                <Skeleton.Box width="40%" height={16} />
              </View>
            ))}
          </View>
        </View>

        {/* Features section */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Skeleton.Box width="40%" height={18} style={styles.cardTitle} />
            <View style={styles.featuresGrid}>
              {Array.from({ length: 6 }).map((_, index) => (
                <View key={index} style={styles.featureItem}>
                  <Skeleton.Box width={24} height={24} borderRadius={12} />
                  <Skeleton.Box width="100%" height={14} style={{ marginTop: 6 }} />
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Pricing section */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Skeleton.Box width="30%" height={18} style={styles.cardTitle} />
            <Skeleton.Box width="60%" height={28} style={{ marginTop: 12 }} />
            {Array.from({ length: 3 }).map((_, index) => (
              <View key={index} style={styles.detailRow}>
                <Skeleton.Box width="40%" height={16} />
                <Skeleton.Box width="30%" height={16} />
              </View>
            ))}
          </View>
        </View>

        {/* Location section */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Skeleton.Box width="35%" height={18} style={styles.cardTitle} />
            <Skeleton.Box width="100%" height={200} borderRadius={12} style={{ marginTop: 12 }} />
            <TextLines
              lines={2}
              lastLineWidth="85%"
              lineHeight={16}
              lineSpacing={6}
              style={{ marginTop: 12 }}
            />
          </View>
        </View>

        {/* Action bar space */}
        <View style={styles.actionBarSpace} />
      </ScrollView>

      {/* Action bar skeleton */}
      <View style={styles.actionBar}>
        <View style={styles.priceSection}>
          <Skeleton.Box width={80} height={20} />
          <Skeleton.Box width={60} height={16} style={{ marginTop: 4 }} />
        </View>
        <Skeleton.Box width={140} height={48} borderRadius={24} />
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
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
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
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
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
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    ...shadowToken({ y: 1, blur: 4, color: colors.COLOR_BLACK, opacity: 0.1, elevation: 2 }),
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
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.COLOR_BLACK_LIGHT_6,
  },
  priceSection: {
    flex: 1,
  },
});
