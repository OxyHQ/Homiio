/**
 * The Saved page's "Saved searches" section: every saved search as a
 * `SavedSearchCard`, with loading, error and empty states.
 */
import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@oxy.so/bloom/button';
import { RiSearchLine } from '@oxy.so/bloom/icons';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';

import { useSavedSearches } from '@/hooks/useSavedSearches';

import { SavedSearchCards } from './SavedSearchCards';
import { SavedSection } from './SavedSection';

export function SavedSearchesSection() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { searches, isLoading, error } = useSavedSearches();

  let body: React.ReactNode;
  if (isLoading && searches.length === 0) {
    body = (
      <View style={{ gap: 12 }}>
        <Skeleton.Box width="100%" height={148} borderRadius={16} />
        <Skeleton.Box width="100%" height={148} borderRadius={16} />
      </View>
    );
  } else if (searches.length === 0) {
    body = (
      <View style={{ gap: 12, alignItems: 'flex-start' }}>
        <Text variant="body-2-regular" style={{ color: theme.colors.textSecondary }}>
          {t(error ? 'search.widgets.savedSearches.loadError' : 'search.widgets.savedSearches.emptyHelper')}
        </Text>
        {error ? (
          <Button
            variant="secondary"
            size="small"
            onPress={() => void queryClient.invalidateQueries({ queryKey: ['savedSearches'] })}
          >
            {t('common.retry')}
          </Button>
        ) : (
          <Button variant="secondary" size="small" leadingIcon={RiSearchLine} onPress={() => router.push('/explore')}>
            {t('saved.exploreCta')}
          </Button>
        )}
      </View>
    );
  } else {
    body = <SavedSearchCards searches={searches} />;
  }

  return (
    <SavedSection
      title={t('saved.sections.searches')}
      description={searches.length > 0 ? t('saved.sections.searchesDescription') : undefined}
      testID="saved-searches"
    >
      {body}
    </SavedSection>
  );
}
