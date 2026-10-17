/**
 * Homiio's drawings of its own catalogue tools' results, inside Alia's thread.
 *
 * Keyed `homiio:<tool>`: the SDK parses the key from the tool's canonical name
 * (`oxy_homiio__searchListings`), never from anything the model wrote
 * (`docs/agent-embedding.md` §3 in the Alia repository). They replace the old
 * `<PROPERTIES_JSON>` blocks the model was asked to type into its reply: the
 * homes come from the tool's structured output, so a card can only show a home
 * the catalogue actually returned.
 *
 * The same renderers draw a consulted agent's results — Sindi answering inside
 * an Alia conversation in Homiio shows the same cards.
 */

import type { AliaToolRenderers, AliaToolResult } from '@alia.onl/sdk';
import type { Property } from '@homiio/shared-types';
import { useRouter } from 'expo-router';
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { P } from '@oxy.so/bloom/typography';

import { PropertyCard } from '@/components/PropertyCard';
import { SindiSavedHomes } from '@/components/sindi/SindiSavedHomes';
import { spacing } from '@/constants/styles';

/** How many cards a result shows before saying how many more there are. */
export const SINDI_LISTING_PREVIEW_MAX = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isListing = (value: unknown): value is Property =>
  isRecord(value) && typeof value.id === 'string' && value.id.length > 0;

/** The listings of a search's output (`{ data: Property[], total }`), and how many matched in all. */
export function listingsOfOutput(output: unknown): { listings: Property[]; total: number } {
  if (!isRecord(output) || !Array.isArray(output.data)) return { listings: [], total: 0 };
  const listings = output.data.filter(isListing);
  const total =
    typeof output.total === 'number' && output.total >= listings.length
      ? output.total
      : listings.length;
  return { listings, total };
}

/** The one listing of `getListing`'s output (`{ data: Property }`), or null. */
export function listingOfOutput(output: unknown): Property | null {
  return isRecord(output) && isListing(output.data) ? output.data : null;
}

/**
 * What a `resolvePlace` call could not commit to, or null when it resolved.
 *
 * "Muéstrame pisos en Hamburg" with two Hamburgs must be SAID: refusing to choose
 * is required (ADR 0002 §12.2), refusing silently was the defect. The sentence
 * is drawn from the tool's own answer, so it appears whatever the model writes.
 */
export function placeClarificationOf(
  result: Pick<AliaToolResult, 'input' | 'output'>,
): { requested: string; reason: 'ambiguous' | 'not_found' } | null {
  const { input, output } = result;
  if (!isRecord(output)) return null;
  if (output.status !== 'ambiguous' && output.status !== 'not_found') return null;
  const requested = typeof input?.city === 'string' ? input.city.trim() : '';
  if (requested === '') return null;
  return { requested, reason: output.status };
}

function ListingCards({ listings, total }: { listings: Property[]; total: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  if (listings.length === 0) return null;
  const shown = listings.slice(0, SINDI_LISTING_PREVIEW_MAX);
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
      {/* Said, not hidden: four cards of eleven answer a different question. */}
      {total > shown.length ? (
        <P style={styles.note}>{t('sindi.saved.more', { count: total - shown.length })}</P>
      ) : null}
    </View>
  );
}

export function SindiPlaceClarification({
  requested,
  reason,
}: {
  requested: string;
  reason: 'ambiguous' | 'not_found';
}) {
  const { t } = useTranslation();
  // Two sentences, not one with a severity: "which Barcelona?" is answerable by
  // naming a region, and "I have no Atlantis" is not.
  return (
    <P style={styles.note}>
      {t(reason === 'ambiguous' ? 'sindi.place.ambiguous' : 'sindi.place.notFound', {
        place: requested,
      })}
    </P>
  );
}

const searchResults = (result: AliaToolResult): React.ReactNode => (
  <ListingCards {...listingsOfOutput(result.output)} />
);

export const SINDI_TOOL_RENDERERS: AliaToolRenderers = {
  'homiio:searchListings': searchResults,
  'homiio:findNearbyListings': searchResults,
  'homiio:getListing': (result) => {
    const listing = listingOfOutput(result.output);
    return listing ? <ListingCards listings={[listing]} total={1} /> : null;
  },
  // The saves come from the person's own session, as on every other surface,
  // so the cards show what is saved NOW rather than what was when the tool ran.
  'homiio:listSavedHomes': () => <SindiSavedHomes />,
  'homiio:resolvePlace': (result) => {
    const clarification = placeClarificationOf(result);
    return clarification ? <SindiPlaceClarification {...clarification} /> : null;
  },
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
