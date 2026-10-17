/**
 * The person's saved homes, drawn in the conversation for the catalogue's
 * `listSavedHomes` (`components/sindi/sindiToolRenderers.tsx`).
 *
 * ## Three states, and none of them is silence
 *
 * A failed load must not render as "you have not saved anything": loading,
 * failure and a genuinely empty list each say their own sentence.
 *
 * ## Nothing here is an authorisation
 *
 * The saves come from the viewer's own session through the context every other
 * surface reads — what is saved now, under their own account (#519 §8.3).
 */

import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { P } from '@oxy.so/bloom/typography';

import { PropertyCard } from '@/components/PropertyCard';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { spacing } from '@/constants/styles';

/** How many cards the thread shows before pointing at the real screen. */
export const SINDI_SAVED_PREVIEW_MAX = 4;

export const SindiSavedHomes: React.FC = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { savedProperties, isLoading, error } = useSavedPropertiesContext();

  const saved = savedProperties;

  if (isLoading) {
    return <P style={styles.note}>{t('sindi.saved.loading')}</P>;
  }

  if (error) {
    // NOT "you have nothing saved". The two sentences send people to different
    // places, and only one of them is true.
    return <P style={styles.note}>{t('sindi.saved.failed')}</P>;
  }

  if (saved.length === 0) {
    return <P style={styles.note}>{t('sindi.saved.empty')}</P>;
  }

  const shown = saved.slice(0, SINDI_SAVED_PREVIEW_MAX);

  return (
    <View style={styles.cards}>
      {shown.map((property) => (
        <PropertyCard
          key={property.id}
          property={property}
          orientation="horizontal"
          variant="compact"
          onPress={() => router.push(`/properties/${property.id}`)}
          showSaveButton={false}
        />
      ))}
      {/* Said, not hidden: a thread that silently showed four of eleven would
          be answering a different question from the one asked. */}
      {saved.length > shown.length ? (
        <P style={styles.note}>{t('sindi.saved.more', { count: saved.length - shown.length })}</P>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  cards: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  note: {
    fontSize: 13,
    opacity: 0.7,
    marginBottom: spacing.sm,
  },
});
