/**
 * Sindi answering "show me my saved homes" INLINE (#519 §8).
 *
 * ## Why this exists
 *
 * When the chat is full-screen there is no main pane to send anywhere, so an
 * action becomes an offer the person can take. For most actions that is the
 * right answer: applying a filter to a screen nobody can see would be a change
 * they never witness.
 *
 * "Show me my saved homes" is different. The answer IS the list, and offering a
 * button that leaves the conversation to go and look at it is a worse version
 * of answering — the person asked a question and got a door. So the list is
 * rendered here, in the thread, and the offer to open the real screen stays
 * beside it for anybody who wants the full surface.
 *
 * ## Three states, and none of them is silence
 *
 * A failed load must not render as "you have not saved anything". That
 * confusion has cost this codebase real defects — a signed-out visitor seeing
 * an empty availability calendar, a 500 rendering as "no trips" — so loading,
 * failure and a genuinely empty collection each say their own sentence.
 *
 * ## Nothing here is an authorisation
 *
 * The saves come from the viewer's own session through the context every other
 * surface reads. A `folderId` from the model is used only to FILTER what that
 * session already returned, so an id naming somebody else's collection matches
 * nothing rather than reaching for it (#519 §8.3).
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { P } from '@oxy.so/bloom/typography';

import { PropertyCard } from '@/components/PropertyCard';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { propertiesInFolder } from '@/utils/savedFolders';
import { spacing } from '@/constants/styles';

/** How many cards the thread shows before pointing at the real screen. */
export const SINDI_SAVED_PREVIEW_MAX = 4;

export interface SindiSavedHomesProps {
  /** The collection the person named, or undefined for everything saved. */
  readonly folderId?: string;
}

export const SindiSavedHomes: React.FC<SindiSavedHomesProps> = ({ folderId }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { savedProperties, isLoading, error } = useSavedPropertiesContext();

  const inFolder = useMemo(
    () => propertiesInFolder(savedProperties, folderId),
    [savedProperties, folderId],
  );

  if (isLoading) {
    return <P style={styles.note}>{t('sindi.saved.loading')}</P>;
  }

  if (error) {
    // NOT "you have nothing saved". The two sentences send people to different
    // places, and only one of them is true.
    return <P style={styles.note}>{t('sindi.saved.failed')}</P>;
  }

  if (inFolder.length === 0) {
    return (
      <P style={styles.note}>
        {folderId ? t('sindi.saved.emptyFolder') : t('sindi.saved.empty')}
      </P>
    );
  }

  const shown = inFolder.slice(0, SINDI_SAVED_PREVIEW_MAX);

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
      {inFolder.length > shown.length ? (
        <P style={styles.note}>
          {t('sindi.saved.more', { count: inFolder.length - shown.length })}
        </P>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  cards: {
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  note: {
    fontSize: 13,
    opacity: 0.7,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
