/**
 * Right-rail "Saved searches": the first few saved searches as the same Bloom
 * `SavedSearchCard`s the Saved page draws (`SavedSearchCards`), so a card runs
 * its search, opens its settings and deletes identically wherever it appears.
 *
 * The rail used to carry its own row, an actions sheet and an edit dialog (name,
 * free-text query, a legacy notifications switch). Renaming now lives on the
 * watch's settings screen beside the cadence that replaced that switch.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';
import { Button } from '@oxy.so/bloom/button';
import { RiBookmarkFill, RiBookmarkLine, RiErrorWarningFill } from '@oxy.so/bloom/icons';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { SavedSearchCards } from '@/components/saved/SavedSearchCards';
import { ICON_SIZES } from '@/constants/styles';
import { useColors } from '@/hooks/useThemeColor';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { BaseWidget } from './BaseWidget';

const HEADER_ICON_SIZE = 22;
/** Saved searches shown in the rail before "View all". */
const PREVIEW_COUNT = 3;

/** Centred icon + message block shared by the sign-in, error and empty states. */
function StateBlock({ children }: { children: React.ReactNode }) {
  return <View className="items-center gap-3 py-3">{children}</View>;
}

export function SavedSearchesWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const colors = useColors();
  const { openAccountDialog } = useOxy();
  const { searches, isLoading, error, isAuthenticated } = useSavedSearches();

  const renderState = () => {
    if (!isAuthenticated) {
      return (
        <StateBlock>
          <RiBookmarkLine width={ICON_SIZES.xl} height={ICON_SIZES.xl} fill={colors.textTertiary} />
          <BloomText className="text-center text-[15px] font-semibold text-foreground">
            {t('search.widgets.savedSearches.signInPrompt')}
          </BloomText>
          <Button variant="primary" size="medium" onPress={() => openAccountDialog('signin')}>
            {t('search.widgets.common.signIn')}
          </Button>
        </StateBlock>
      );
    }

    if (isLoading && searches.length === 0) {
      return <Skeleton.Box width="100%" height={148} borderRadius={16} />;
    }

    if (error) {
      return (
        <StateBlock>
          <RiErrorWarningFill width={ICON_SIZES.xl} height={ICON_SIZES.xl} fill={colors.error} />
          <BloomText className="text-center text-[15px] font-semibold text-foreground">
            {t('search.widgets.savedSearches.loadError')}
          </BloomText>
          <Button
            variant="secondary"
            size="medium"
            onPress={() => queryClient.invalidateQueries({ queryKey: ['savedSearches'] })}
          >
            {t('common.retry')}
          </Button>
        </StateBlock>
      );
    }

    if (searches.length === 0) {
      return (
        <StateBlock>
          <RiBookmarkLine width={ICON_SIZES.xl} height={ICON_SIZES.xl} fill={colors.textTertiary} />
          <View className="items-center gap-1">
            <BloomText className="text-center text-[15px] font-semibold text-foreground">
              {t('search.widgets.savedSearches.empty')}
            </BloomText>
            <BloomText className="text-center text-[13px] text-muted-foreground">
              {t('search.widgets.savedSearches.emptyHelper')}
            </BloomText>
          </View>
          <Button variant="primary" size="medium" onPress={() => router.push('/explore')}>
            {t('search.widgets.savedSearches.createNew')}
          </Button>
        </StateBlock>
      );
    }

    const remaining = searches.length - PREVIEW_COUNT;
    return (
      <View className="gap-3">
        <SavedSearchCards searches={searches.slice(0, PREVIEW_COUNT)} />
        {remaining > 0 ? (
          <Button variant="ghost" size="medium" onPress={() => router.push('/saved')}>
            {t('search.widgets.savedSearches.viewAllCount', { count: remaining })}
          </Button>
        ) : null}
      </View>
    );
  };

  return (
    <BaseWidget
      title={t('search.widgets.savedSearches.title')}
      icon={<RiBookmarkFill width={HEADER_ICON_SIZE} height={HEADER_ICON_SIZE} fill={colors.primary} />}
    >
      {renderState()}
    </BaseWidget>
  );
}
