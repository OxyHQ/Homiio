/**
 * Right-rail "Saved searches": the first few saved searches as the same Bloom
 * `SavedSearchCard`s the Saved page draws (`SavedSearchCards`), so a card runs
 * its search, opens its settings and deletes identically wherever it appears.
 *
 * The rail used to carry its own row, an actions sheet and an edit dialog (name,
 * free-text query, a legacy notifications switch). Renaming now lives on the
 * watch's settings screen beside the cadence that replaced that switch.
 *
 * Renders only when there are saved searches to show: signed out, loading, an
 * error and an empty list all render nothing.
 */
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Button } from '@oxy.so/bloom/button';
import { RiBookmarkFill } from '@oxy.so/bloom/icons/RiBookmarkFill';
import { useTheme } from '@oxy.so/bloom/theme';

import { SavedSearchCards } from '@/components/saved/SavedSearchCards';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { BaseWidget } from './BaseWidget';

const HEADER_ICON_SIZE = 22;
/** Saved searches shown in the rail before "View all". */
const PREVIEW_COUNT = 3;

export function SavedSearchesWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const { searches, isLoading, error, isAuthenticated } = useSavedSearches();

  if (!isAuthenticated || isLoading || error || searches.length === 0) {
    return null;
  }

  const remaining = searches.length - PREVIEW_COUNT;

  return (
    <BaseWidget
      title={t('search.widgets.savedSearches.title')}
      icon={
        <RiBookmarkFill
          width={HEADER_ICON_SIZE}
          height={HEADER_ICON_SIZE}
          fill={colors.primarySubtleForeground}
        />
      }
    >
      <View className="gap-3">
        <SavedSearchCards searches={searches.slice(0, PREVIEW_COUNT)} />
        {remaining > 0 ? (
          <Button size="md" onPress={() => router.push('/saved')} tone="accent" appearance="subtle">
            {t('search.widgets.savedSearches.viewAllCount', { count: remaining })}
          </Button>
        ) : null}
      </View>
    </BaseWidget>
  );
}
