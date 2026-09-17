/**
 * Property drafts — locally-saved, in-progress listings the user hasn't
 * published yet. The data source is unchanged: AsyncStorage under the
 * `property_drafts` key (drafts are partial form state, NOT server `Property`
 * objects, so they don't flow through `PropertyResultsGrid`).
 *
 * Modernized to match the rest of the property surfaces: the shared
 * `PropertyListHeader` over Bloom-typed draft cards, `PropertyResultsGridSkeleton`
 * for loading and `EmptyState` for empty. All copy is Bloom `Text`/`H4` — no
 * `ThemedText`. AsyncStorage reads/writes are wrapped in React Query
 * (query + mutation) instead of a `useEffect` + manual `useState(loading)`,
 * which also gives us a clean optimistic delete.
 */
import React, { useCallback } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import {
  RiAddCircleLine,
  RiAddLine,
  RiBuilding2Line,
  RiDeleteBinLine,
  RiEditLine,
  RiFolderOpenLine,
  RiGroupLine,
  RiHomeLine,
  RiHotelBedLine,
  RiLeafLine,
  RiMoreFill,
  RiSaveLine,
  RiTeamLine,
  RiTimeLine,
} from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { H4, Text as BloomText } from '@oxy.so/bloom/typography';

import { PropertyListHeader } from '@/components/ui/PropertyListHeader';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import { colors } from '@/styles/colors';
import { contentClamp, spacing } from '@/constants/styles';
import { logger } from '@/utils/logger';
import { formatPrice } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';

type RemixIcon = typeof RiHomeLine;

const SKELETON_COUNT = 4;
/** AsyncStorage keys owned by the draft flow. */
const DRAFTS_KEY = 'property_drafts';
const CURRENT_DRAFT_KEY = 'current_draft';
/** Hours/day boundaries for the relative "last saved" label. */
const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 1000 * 60 * 60;

interface PropertyDraft {
  id: string;
  title: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  type: string;
  description: string;
  rent: {
    amount: number;
    currency: string;
  };
  images: unknown[];
  lastSaved: Date;
  formData: unknown;
}

/** Shape persisted to AsyncStorage, where `lastSaved` is serialized as an ISO string. */
type StoredPropertyDraft = Omit<PropertyDraft, 'lastSaved'> & { lastSaved: string };

const DRAFTS_QUERY_KEY = ['propertyDrafts'] as const;

async function readDrafts(): Promise<PropertyDraft[]> {
  const raw = await AsyncStorage.getItem(DRAFTS_KEY);
  if (!raw) return [];
  const parsed: StoredPropertyDraft[] = JSON.parse(raw);
  return parsed.map((draft) => ({ ...draft, lastSaved: new Date(draft.lastSaved) }));
}

const PROPERTY_TYPE_ICONS: Record<string, RemixIcon> = {
  apartment: RiBuilding2Line,
  house: RiHomeLine,
  room: RiHotelBedLine,
  studio: RiHomeLine,
  couchsurfing: RiGroupLine,
  roommates: RiTeamLine,
  coliving: RiHomeLine,
  hostel: RiHotelBedLine,
  guesthouse: RiHomeLine,
  campsite: RiLeafLine,
  boat: RiHomeLine,
  treehouse: RiLeafLine,
  yurt: RiHomeLine,
  other: RiMoreFill,
};

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  apartment: 'Apartment',
  house: 'House',
  room: 'Room',
  studio: 'Studio',
  couchsurfing: 'Couchsurfing',
  roommates: 'Roommates',
  coliving: 'Co-Living',
  hostel: 'Hostel',
  guesthouse: 'Guesthouse',
  campsite: 'Campsite',
  boat: 'Boat/Houseboat',
  treehouse: 'Treehouse',
  yurt: 'Yurt/Tent',
  other: 'Other',
};

function getPropertyTypeIcon(type: string): RemixIcon {
  return PROPERTY_TYPE_ICONS[type] ?? RiHomeLine;
}

function getPropertyTypeLabel(type: string): string {
  return PROPERTY_TYPE_LABELS[type] ?? 'Property';
}

function formatRelativeDate(date: Date): string {
  const diffInHours = Math.floor((Date.now() - date.getTime()) / MS_PER_HOUR);
  if (diffInHours < 1) return 'Just now';
  if (diffInHours < HOURS_PER_DAY) {
    return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  }
  const diffInDays = Math.floor(diffInHours / HOURS_PER_DAY);
  return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
}

/** A single draft card on Bloom `Card`, with Bloom icon buttons for edit/delete. */
function DraftCard({
  draft,
  onContinue,
  onDelete,
}: {
  draft: PropertyDraft;
  onContinue: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale, priceUnitLabels } = useFormatting();
  return (
    <Card style={styles.draftCard}>
      <View style={styles.draftHeader}>
        <View style={styles.draftTypeContainer}>
          {React.createElement(getPropertyTypeIcon(draft.type), {
            size: 'md',
            fill: theme.colors.primary,
          })}
          <BloomText style={styles.draftType}>{getPropertyTypeLabel(draft.type)}</BloomText>
        </View>
        <View style={styles.draftActions}>
          <Button
            variant="ghost"
            iconOnly
            leadingIcon={RiEditLine}
            onPress={onContinue}
            accessibilityLabel={t('common.edit')}
          />
          <Button
            variant="ghost"
            iconOnly
            leadingIcon={RiDeleteBinLine}
            onPress={onDelete}
            accessibilityLabel={t('common.delete')}
          />
        </View>
      </View>

      <View style={styles.draftContent}>
        <H4 style={styles.draftTitle}>
          {draft.title || `${draft.address.street}, ${draft.address.city}`}
        </H4>
        <BloomText style={styles.draftAddress}>
          {draft.address.street}, {draft.address.city}, {draft.address.state}{' '}
          {draft.address.zipCode}
        </BloomText>
        {draft.rent.amount > 0 ? (
          <BloomText style={styles.draftPrice}>
            {formatPrice(
              { amount: draft.rent.amount, currency: draft.rent.currency, unit: 'month' },
              locale,
              { unitLabels: priceUnitLabels, maximumFractionDigits: 0 },
            )}
          </BloomText>
        ) : null}
        <View style={styles.draftMeta}>
          <View style={styles.draftMetaItem}>
            <RiTimeLine size="xs" fill={theme.colors.textSecondary} />
            <BloomText style={styles.draftMetaText}>{formatRelativeDate(draft.lastSaved)}</BloomText>
          </View>
          <View style={styles.draftMetaItem}>
            <RiSaveLine size="xs" fill={theme.colors.textSecondary} />
            <BloomText style={styles.draftMetaText}>Draft</BloomText>
          </View>
        </View>
      </View>
    </Card>
  );
}

export default function PropertyDraftsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: drafts = [], isLoading } = useQuery({
    queryKey: DRAFTS_QUERY_KEY,
    queryFn: readDrafts,
  });

  const deleteMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const current = await readDrafts();
      const next = current.filter((draft) => draft.id !== draftId);
      const stored: StoredPropertyDraft[] = next.map((draft) => ({
        ...draft,
        lastSaved: draft.lastSaved.toISOString(),
      }));
      await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(stored));
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(DRAFTS_QUERY_KEY, next);
      toast.success(t('property.drafts.toastDeleted'));
    },
    onError: (error: unknown) => {
      logger.error('Error deleting draft:', error);
      toast.error(t('property.drafts.toastDeleteFailed'));
    },
  });

  const continueEditing = useCallback(
    async (draft: PropertyDraft) => {
      try {
        await AsyncStorage.setItem(CURRENT_DRAFT_KEY, JSON.stringify(draft.formData));
        router.push('/properties/create');
      } catch (error: unknown) {
        logger.error('Error setting current draft:', error);
        toast.error(t('property.drafts.toastLoadFailed'));
      }
    },
    [router, t],
  );

  const handleDelete = useCallback(
    async (draftId: string) => {
      const ok = await confirm({
        title: t('property.drafts.deleteTitle'),
        description: t('property.drafts.deleteMessage'),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (ok) deleteMutation.mutate(draftId);
    },
    [deleteMutation, t],
  );

  const body = (() => {
    if (isLoading && drafts.length === 0) {
      return (
        <PropertyResultsGridSkeleton
          count={SKELETON_COUNT}
          style={styles.gridPadding}
        />
      );
    }
    if (drafts.length === 0) {
      return (
        <EmptyState
          icon={RiFolderOpenLine}
          title={t('property.drafts.emptyTitle')}
          description={t('property.drafts.emptyDescription')}
          actionText={t('property.drafts.createFirst')}
          actionIcon={RiAddLine}
          onAction={() => router.push('/properties/create')}
        />
      );
    }
    return (
      <View style={styles.content}>
        <View style={styles.draftsList}>
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onContinue={() => void continueEditing(draft)}
              onDelete={() => void handleDelete(draft.id)}
            />
          ))}
        </View>
        <Button
          variant="secondary"
          onPress={() => router.push('/properties/create')}
          leadingIcon={RiAddCircleLine}
          style={styles.createNewButton}
        >
          {t('property.drafts.createFirst')}
        </Button>
      </View>
    );
  })();

  return (
    <View style={styles.container}>
      <PropertyListHeader
        title={t('property.drafts.title')}
        subtitle={drafts.length > 0 ? `${drafts.length} saved` : undefined}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: Platform.select<ViewStyle>({
    web: { flex: 1, overflow: 'auto' } as unknown as ViewStyle,
    default: { flex: 1 },
  }) as ViewStyle,
  scrollContent: {
    paddingBottom: spacing['4xl'],
    maxWidth: contentClamp.page,
    width: '100%',
    alignSelf: 'center',
  },
  content: {
    padding: spacing.lg,
  },
  gridPadding: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  draftsList: {
    gap: spacing.lg,
  },
  draftCard: {
    padding: spacing.xl,
  },
  draftHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  draftTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  draftType: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  draftActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  draftContent: {
    gap: spacing.sm,
  },
  draftTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  draftAddress: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  draftPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryColor,
  },
  draftMeta: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  draftMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  draftMetaText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  createNewButton: {
    marginTop: spacing['2xl'],
  },
});
