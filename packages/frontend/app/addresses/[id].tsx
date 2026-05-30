/**
 * Address detail — properties + reviews at one address.
 *
 * Stream Q polish:
 *   - Bloom Typography (H2/H3/Text) everywhere, no raw <Text>.
 *   - Bloom Button replaces TouchableOpacity CTAs (Write review, Helpful,
 *     Report, Reply, Switch).
 *   - withShadow('sm') cards with radius.lg, no border accents.
 *   - Shared EmptyState / ErrorState / SectionEyebrow.
 *   - Skeleton via PropertyListSkeleton for properties, Skeleton.Box rows
 *     for reviews while loading.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { AddressDisplay } from '@/components/AddressDisplay';
import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { PropertyListSkeleton } from '@/components/ui/skeletons/PropertyListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { NeighborhoodRatingWidget } from '@/components/widgets/NeighborhoodRatingWidget';
import { api } from '@/utils/api';
import { Property } from '@homiio/shared-types';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface AddressData {
  _id: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  neighborhood?: string;
  coordinates: {
    type: 'Point';
    coordinates: [number, number];
  };
  fullAddress: string;
  location: string;
  createdAt: string;
  updatedAt: string;
}

interface ReviewData {
  _id: string;
  addressId: string;
  addressLevel: 'BUILDING' | 'UNIT';
  greenHouse?: string;
  price: number;
  currency: string;
  livedFrom: string;
  livedTo: string;
  livedForMonths: number;
  recommendation: boolean;
  opinion: string;
  positiveComment?: string;
  negativeComment?: string;
  images: string[];
  rating: number;
  summerTemperature?: string;
  winterTemperature?: string;
  noise?: string;
  light?: string;
  conditionAndMaintenance?: string;
  services?: string[];
  landlordTreatment?: string;
  problemResponse?: string;
  depositReturned?: boolean;
  staircaseNeighbors?: string;
  touristApartments?: boolean;
  neighborRelations?: string;
  cleaning?: string;
  areaTourists?: string;
  areaSecurity?: string;
  createdAt: string;
  updatedAt: string;
  verified: boolean;
  isAnonymous?: boolean;
  confidenceScore?: number;
  evidenceAttached?: boolean;
  flaggedIssues?: string[];
  karmaScore?: number;
  replyAllowed?: boolean;
  moderationStatus?: 'pending' | 'approved' | 'flagged' | 'removed';
  helpfulVotes?: number;
  unhelpfulVotes?: number;
  reportCount?: number;
  livedDurationText?: string;
  evidenceCount?: number;
}

type ReviewTab = 'overall' | 'apartments' | 'community' | 'area';
type ContentTab = 'properties' | 'reviews';

const REVIEW_TABS: { id: ReviewTab; label: string }[] = [
  { id: 'overall', label: 'Overall' },
  { id: 'apartments', label: 'Apartments' },
  { id: 'community', label: 'Community' },
  { id: 'area', label: 'Area' },
];

const Stars: React.FC<{ rating: number }> = ({ rating }) => {
  const fullStars = Math.floor(rating);
  const halfStar = rating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);

  return (
    <View style={styles.starsContainer}>
      {Array.from({ length: fullStars }).map((_, i) => (
        <Ionicons
          key={`full-${i}`}
          name="star"
          size={16}
          color={colors.ratingStar}
        />
      ))}
      {halfStar ? (
        <Ionicons name="star-half" size={16} color={colors.ratingStar} />
      ) : null}
      {Array.from({ length: emptyStars }).map((_, i) => (
        <Ionicons
          key={`empty-${i}`}
          name="star-outline"
          size={16}
          color={colors.ratingStar}
        />
      ))}
    </View>
  );
};

const ReviewCardItem: React.FC<{
  review: ReviewData;
  onHelpful: () => void;
  onReport: () => void;
  onReply: () => void;
}> = ({ review, onHelpful, onReport, onReply }) => {
  const confidenceColor =
    (review.confidenceScore ?? 0) >= 80
      ? colors.success
      : (review.confidenceScore ?? 0) >= 60
        ? colors.warning
        : colors.danger;

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <View style={styles.avatarSmall}>
          <Ionicons name="person" size={18} color={colors.muted} />
        </View>
        <View style={styles.reviewerInfo}>
          <BloomText style={styles.reviewerName}>
            {review.isAnonymous ? 'Anonymous' : 'Verified Resident'}
          </BloomText>
          <View style={styles.metaRow}>
            <BloomText style={styles.metaText}>
              {new Date(review.createdAt).toLocaleDateString()}
            </BloomText>
            <BloomText style={styles.metaText}>·</BloomText>
            <BloomText style={styles.metaText}>
              Lived {review.livedForMonths} months
            </BloomText>
          </View>
        </View>
        <Stars rating={review.rating} />
      </View>

      <View style={styles.badgesRow}>
        {review.verified ? (
          <View
            style={[styles.badge, { backgroundColor: colors.infoSubtle }]}
          >
            <Ionicons name="checkmark-circle" size={12} color={colors.info} />
            <BloomText style={[styles.badgeText, { color: colors.info }]}>
              Verified
            </BloomText>
          </View>
        ) : null}
        <View
          style={[
            styles.badge,
            { backgroundColor: confidenceColor + '20' },
          ]}
        >
          <BloomText style={[styles.badgeText, { color: confidenceColor }]}>
            {review.confidenceScore ?? 0}% confident
          </BloomText>
        </View>
        {review.evidenceAttached ? (
          <View
            style={[styles.badge, { backgroundColor: colors.mutedSubtle }]}
          >
            <Ionicons
              name="document-attach"
              size={12}
              color={colors.COLOR_BLACK_LIGHT_2}
            />
            <BloomText style={styles.badgeText}>
              {review.evidenceCount ?? 1} proof
              {(review.evidenceCount ?? 1) > 1 ? 's' : ''}
            </BloomText>
          </View>
        ) : null}
      </View>

      <BloomText style={styles.reviewBody}>{review.opinion}</BloomText>

      {review.positiveComment ? (
        <View style={styles.commentSection}>
          <BloomText style={styles.commentLabel}>What I liked</BloomText>
          <BloomText style={styles.commentText}>
            {review.positiveComment}
          </BloomText>
        </View>
      ) : null}

      {review.negativeComment ? (
        <View style={styles.commentSection}>
          <BloomText style={styles.commentLabel}>What I disliked</BloomText>
          <BloomText style={styles.commentText}>
            {review.negativeComment}
          </BloomText>
        </View>
      ) : null}

      <View style={styles.reviewFooter}>
        <View style={styles.actionRow}>
          <Button variant="ghost" size="small" onPress={onHelpful}>
            Helpful ({review.helpfulVotes ?? 0})
          </Button>
          <Button variant="ghost" size="small" onPress={onReport}>
            Report
          </Button>
          {review.replyAllowed ? (
            <Button variant="ghost" size="small" onPress={onReply}>
              Reply
            </Button>
          ) : null}
        </View>
        <BloomText
          style={[
            styles.recommendation,
            {
              color: review.recommendation ? colors.success : colors.danger,
            },
          ]}
        >
          {review.recommendation ? 'Recommends' : 'Does not recommend'}
        </BloomText>
      </View>
    </View>
  );
};

interface ContentTabSwitcherProps {
  selected: ContentTab;
  propertyCount: number;
  reviewCount: number;
  onChange: (value: ContentTab) => void;
}

interface ContentTabButtonProps {
  label: string;
  icon: IoniconName;
  active: boolean;
  onPress: () => void;
}

const ContentTabButton: React.FC<ContentTabButtonProps> = ({
  label,
  icon,
  active,
  onPress,
}) => {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.tabPill,
        active && styles.tabPillActive,
        pressed && styles.tabPillPressed,
      ]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Ionicons
        name={icon}
        size={16}
        color={active ? colors.white : colors.COLOR_BLACK_LIGHT_2}
      />
      <BloomText
        style={[styles.tabPillLabel, active && styles.tabPillLabelActive]}
      >
        {label}
      </BloomText>
    </Pressable>
  );
};

const ContentTabSwitcher: React.FC<ContentTabSwitcherProps> = ({
  selected,
  propertyCount,
  reviewCount,
  onChange,
}) => (
  <View style={styles.tabSwitcher}>
    {[
      { id: 'properties' as const, label: `Properties (${propertyCount})`, icon: 'home-outline' as IoniconName },
      { id: 'reviews' as const, label: `Reviews (${reviewCount})`, icon: 'chatbubbles-outline' as IoniconName },
    ].map((tab) => (
      <ContentTabButton
        key={tab.id}
        label={tab.label}
        icon={tab.icon}
        active={selected === tab.id}
        onPress={() => onChange(tab.id)}
      />
    ))}
  </View>
);

interface ReviewTabSwitcherProps {
  selected: ReviewTab;
  onChange: (tab: ReviewTab) => void;
}

const ReviewTabSwitcher: React.FC<ReviewTabSwitcherProps> = ({
  selected,
  onChange,
}) => (
  <View style={styles.reviewTabBar}>
    {REVIEW_TABS.map((tab) => {
      const active = selected === tab.id;
      return (
        <Pressable
          key={tab.id}
          onPress={() => onChange(tab.id)}
          style={[styles.reviewTab, active && styles.reviewTabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: active }}
        >
          <BloomText
            style={[
              styles.reviewTabLabel,
              active && styles.reviewTabLabelActive,
            ]}
          >
            {tab.label}
          </BloomText>
        </Pressable>
      );
    })}
  </View>
);

export default function AddressDetailsPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<ReviewTab>('overall');
  const [contentTab, setContentTab] = useState<ContentTab>('properties');
  const [address, setAddress] = useState<AddressData | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [reviews, setReviews] = useState<ReviewData[]>([]);
  const [loading, setLoading] = useState(true);

  const addressId = id;

  const filteredReviews = (() => {
    if (!Array.isArray(reviews)) return [];
    switch (activeTab) {
      case 'apartments':
        return reviews.filter(
          (review) =>
            review.summerTemperature ||
            review.winterTemperature ||
            review.noise ||
            review.light ||
            review.conditionAndMaintenance ||
            (review.services?.length || 0) > 0,
        );
      case 'community':
        return reviews.filter(
          (review) =>
            review.landlordTreatment ||
            review.problemResponse ||
            review.depositReturned !== undefined ||
            review.staircaseNeighbors ||
            review.touristApartments !== undefined ||
            review.neighborRelations,
        );
      case 'area':
        return reviews.filter(
          (review) => review.areaTourists || review.areaSecurity,
        );
      case 'overall':
      default:
        return reviews;
    }
  })();

  const fetchAddress = useCallback(async () => {
    const response = await api.get(`/api/addresses/${addressId}`);
    setAddress(response.data?.address || response.data);
  }, [addressId]);

  const fetchPropertiesAtAddress = useCallback(async () => {
    const response = await api.get('/api/properties/search', {
      params: { addressId, limit: 50 },
    });
    const list =
      response.data?.data || response.data?.properties || [];
    setProperties(list);
  }, [addressId]);

  const fetchAddressReviews = useCallback(async () => {
    const response = await api.get(`/api/reviews/address/${addressId}`);
    let data: ReviewData[] = [];
    const payload = response.data;
    if (payload?.success) {
      const buildingReviews = payload.buildingReviews || [];
      const unitReviews = payload.unitReviews || [];
      data = [...buildingReviews, ...unitReviews].map(
        (review: Partial<ReviewData>) => ({
          ...(review as ReviewData),
          isAnonymous: review.isAnonymous ?? true,
          confidenceScore: review.confidenceScore ?? 75,
          evidenceAttached: review.evidenceAttached ?? false,
          flaggedIssues: review.flaggedIssues ?? [],
          karmaScore: review.karmaScore ?? 0,
          replyAllowed: review.replyAllowed ?? true,
          moderationStatus: review.moderationStatus ?? 'approved',
          helpfulVotes: review.helpfulVotes ?? 0,
          unhelpfulVotes: review.unhelpfulVotes ?? 0,
          reportCount: review.reportCount ?? 0,
          evidenceCount: review.evidenceCount ?? 0,
        }),
      );
    } else {
      const fallback =
        payload?.data || payload?.reviews || payload || [];
      data = Array.isArray(fallback) ? fallback : [];
    }
    setReviews(data);
  }, [addressId]);

  const fetchAllData = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        await Promise.all([
          fetchAddress(),
          fetchPropertiesAtAddress(),
          fetchAddressReviews(),
        ]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchAddress, fetchPropertiesAtAddress, fetchAddressReviews],
  );

  useEffect(() => {
    // Inline async wrapper keeps the fetchers' internal setState off the
    // synchronous effect path (avoids cascading renders).
    void (async () => {
      await fetchAllData();
    })();
  }, [fetchAllData]);

  const handleWriteReview = () => {
    router.push(`/reviews/write?addressId=${addressId}`);
  };

  const handleReviewHelpful = (_reviewId: string) => {
    Alert.alert('Thank you', 'Your feedback has been recorded.');
  };

  const handleReviewReport = (_reviewId: string) => {
    Alert.alert(
      'Report Review',
      'Are you sure you want to report this review for inappropriate content?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Reported',
              'This review has been reported to our moderation team.',
            );
          },
        },
      ],
    );
  };

  const handleReplyToReview = (_reviewId: string) => {
    Alert.alert(
      'Reply to Review',
      'Reply functionality will allow landlords and property managers to respond to reviews.',
      [{ text: 'OK' }],
    );
  };

  const getAddressTitle = () => {
    if (!address) return 'Address';
    if (address.fullAddress) return address.fullAddress;
    if (address.location) return address.location;
    const parts = [address.street, address.city, address.state].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'Address';
  };

  const headerTitle = (() => {
    const raw = getAddressTitle();
    return raw.length > 35 ? `${raw.substring(0, 32)}...` : raw;
  })();

  if (loading && !refreshing) {
    return (
      <View style={styles.root}>
        <Header
          options={{ title: headerTitle, showBackButton: true }}
        />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.sectionCard}>
            <Skeleton.Text style={{ width: 220, lineHeight: 22 }} />
            <Skeleton.Text style={{ width: 180, lineHeight: 14 }} />
          </View>
          <PropertyListSkeleton viewMode="list" />
        </ScrollView>
      </View>
    );
  }

  if (!address) {
    return (
      <View style={styles.root}>
        <Header
          options={{ title: 'Address', showBackButton: true }}
        />
        <ErrorState
          icon="search-outline"
          title="Address not found"
          description="We couldn't find any details for this address."
          onRetry={() => router.back()}
          retryLabel="Go back"
        />
      </View>
    );
  }

  const addressForDisplay = {
    street: address.street,
    city: address.city,
    state: address.state,
    zipCode: address.zipCode,
    country: address.country,
    coordinates: address.coordinates
      ? {
          lat: address.coordinates.coordinates[1],
          lng: address.coordinates.coordinates[0],
        }
      : undefined,
  };

  const avgConfidence =
    reviews.length > 0
      ? Math.round(
          reviews.reduce((acc, r) => acc + (r.confidenceScore ?? 0), 0) /
            reviews.length,
        )
      : 0;
  const verifiedCount = reviews.filter((r) => r.verified).length;
  const evidenceCount = reviews.filter((r) => r.evidenceAttached).length;

  return (
    <View style={styles.root}>
      <Header options={{ title: headerTitle, showBackButton: true }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchAllData(true)}
              colors={[colors.primaryColor]}
            />
          }
        >
          <View style={styles.sectionCard}>
            <AddressDisplay
              address={addressForDisplay}
              variant="detailed"
              showActions
            />
          </View>

          <View style={styles.sectionCard}>
            <SectionEyebrow>Trust & transparency</SectionEyebrow>
            <H3 style={styles.cardHeading}>Community signal</H3>
            <View style={styles.metricsRow}>
              <View style={styles.metric}>
                <BloomText style={styles.metricValue}>
                  {avgConfidence}%
                </BloomText>
                <BloomText style={styles.metricLabel}>Confidence</BloomText>
              </View>
              <View style={styles.metric}>
                <BloomText style={styles.metricValue}>
                  {verifiedCount}
                </BloomText>
                <BloomText style={styles.metricLabel}>Verified</BloomText>
              </View>
              <View style={styles.metric}>
                <BloomText style={styles.metricValue}>
                  {evidenceCount}
                </BloomText>
                <BloomText style={styles.metricLabel}>With evidence</BloomText>
              </View>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <NeighborhoodRatingWidget
              neighborhoodName={address.neighborhood || ''}
              city={address.city}
              state={address.state}
            />
          </View>

          <ContentTabSwitcher
            selected={contentTab}
            propertyCount={properties.length}
            reviewCount={reviews.length}
            onChange={setContentTab}
          />

          {contentTab === 'properties' ? (
            <View style={styles.sectionCard}>
              <H3 style={styles.cardHeading}>Properties at this address</H3>
              {properties.length === 0 ? (
                <EmptyState
                  icon="home-outline"
                  title="No properties yet"
                  description="There are currently no listings at this address."
                />
              ) : (
                <View style={styles.propertiesList}>
                  {properties.map((property) => (
                    <PropertyCard
                      key={property._id}
                      property={property}
                      onPress={() =>
                        router.push(`/properties/${property._id}`)
                      }
                      variant="compact"
                      orientation="horizontal"
                    />
                  ))}
                </View>
              )}
            </View>
          ) : (
            <View style={styles.sectionCard}>
              <View style={styles.reviewsHeader}>
                <View style={styles.headerText}>
                  <SectionEyebrow>Reviews</SectionEyebrow>
                  <H2 style={styles.cardHeading}>Stories from residents</H2>
                </View>
                <Button
                  variant="primary"
                  size="medium"
                  onPress={handleWriteReview}
                  icon={
                    <Ionicons
                      name="create-outline"
                      size={16}
                      color={colors.white}
                    />
                  }
                >
                  Write review
                </Button>
              </View>

              <ReviewTabSwitcher
                selected={activeTab}
                onChange={setActiveTab}
              />

              {filteredReviews.length === 0 ? (
                <EmptyState
                  icon="chatbubble-outline"
                  title={
                    activeTab === 'overall'
                      ? 'No reviews yet'
                      : `No ${activeTab} reviews yet`
                  }
                  description={
                    activeTab === 'overall'
                      ? 'Be the first to review this address and help others choose with confidence.'
                      : `Be the first to review the ${activeTab} at this address.`
                  }
                />
              ) : (
                <View style={styles.reviewsList}>
                  {filteredReviews.map((review) => (
                    <ReviewCardItem
                      key={review._id}
                      review={review}
                      onHelpful={() => handleReviewHelpful(review._id)}
                      onReport={() => handleReviewReport(review._id)}
                      onReply={() => handleReplyToReview(review._id)}
                    />
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  sectionCard: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.md,
    ...withShadow('sm'),
  },
  cardHeading: {
    letterSpacing: -0.3,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.mutedSubtle,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.primaryColor,
    letterSpacing: -0.5,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  tabSwitcher: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.xs,
    backgroundColor: colors.mutedSubtle,
    borderRadius: radius.pill,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  tabPillActive: {
    backgroundColor: colors.COLOR_BLACK,
  },
  tabPillPressed: {
    opacity: 0.85,
  },
  tabPillLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  tabPillLabelActive: {
    color: colors.white,
  },
  propertiesList: {
    gap: spacing.md,
  },
  reviewsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  reviewTabBar: {
    flexDirection: 'row',
    backgroundColor: colors.mutedSubtle,
    borderRadius: radius.md,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  reviewTab: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  reviewTabActive: {
    backgroundColor: colors.primaryColor,
  },
  reviewTabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  reviewTabLabelActive: {
    color: colors.white,
  },
  reviewsList: {
    gap: spacing.md,
  },
  reviewCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    ...withShadow('sm'),
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatarSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.mutedSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewerInfo: {
    flex: 1,
    gap: 2,
  },
  reviewerName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: 12,
    color: colors.muted,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 2,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  reviewBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  commentSection: {
    backgroundColor: colors.mutedSubtle,
    padding: spacing.sm,
    borderRadius: radius.md,
    gap: 2,
  },
  commentLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  commentText: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_2,
    lineHeight: 18,
  },
  reviewFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexShrink: 1,
  },
  recommendation: {
    fontSize: 12,
    fontWeight: '600',
  },
});
