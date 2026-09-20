/**
 * What an action looks like when the app cannot be driven — and when it was.
 *
 * ## The offer is now the RARE case, and that is the change
 *
 * This row used to be the answer for two of the three hosts: with the chat
 * full-screen, or behind the overlay panel's scrim, "muéstrame pisos por menos
 * de 1.200 €" rendered a button instead of doing anything, per #519 §8.1 —
 * "una representación/acción explícita dentro del chat; no sustituir la
 * pantalla sin intervención". The person who asked for that in the abstract
 * rejected it in practice ("debería interactuar como hablamos"), so both hosts
 * act now and the offer is left for a surface with nowhere to show a result:
 * the in-property sheet, which sends no app context and therefore receives no
 * action at all.
 *
 * It is kept — rather than deleted as unreachable — because `inline` remains
 * the honest outcome for any host that cannot present a result, and because a
 * press IS the intervention: it applies the action regardless of the layout,
 * which is the one legitimate route past the capability check. The homes
 * themselves already appear as cards in the conversation (the assistant's
 * `<PROPERTIES_JSON>` block, rendered by `ChatMessage`), so the offer adds the
 * navigation, not the results.
 *
 * ## It also reports what DID happen, and never overstates it
 *
 * `applied` gets a quiet confirmation naming what changed, because #519 §8.4 is
 * blunt about the alternative: "Sindi no debe afirmar que cambió filtros si el
 * executor no lo hizo." `stale` says the user's own later change won — it is
 * not an error and must not read as one. `failed` and `rejected` say so plainly
 * rather than being hidden, since a silent refusal is indistinguishable from
 * the feature not existing.
 */

import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { P } from '@oxy.so/bloom/typography';

import { SindiSavedHomes } from '@/components/sindi/SindiSavedHomes';
import type { SindiAction, SindiActionOutcome } from '@homiio/shared-types';

import type { SindiActionExecution } from '@/hooks/useSindiActions';

/** The i18n key describing what an action would do. One key per member. */
function actionKey(action: SindiAction): string {
  switch (action.kind) {
    case 'apply_search':
      return 'sindi.actions.applySearch';
    case 'show_saved':
      return 'sindi.actions.showSaved';
    case 'open_listing':
      return 'sindi.actions.openListing';
    case 'set_results_view':
      return action.view === 'map' ? 'sindi.actions.showMap' : 'sindi.actions.showList';
    case 'navigate':
      return `sindi.actions.navigate.${action.destination}`;
    default: {
      const exhaustive: never = action;
      void exhaustive;
      return 'sindi.actions.applySearch';
    }
  }
}

/** The sentence shown for an outcome that is NOT an offer. */
function outcomeKey(outcome: SindiActionOutcome): string | null {
  switch (outcome) {
    case 'applied':
      return 'sindi.actions.applied';
    case 'stale':
      // Deliberately not an error: the person changed something themselves and
      // their change won, which is the designed behaviour.
      return 'sindi.actions.stale';
    case 'failed':
      return 'sindi.actions.failed';
    case 'rejected':
      return null;
    case 'inline':
      return null;
  }
}

export interface SindiActionCardProps {
  readonly execution: SindiActionExecution;
  /** Take the action now, by explicit press. Only called for an `inline` offer. */
  readonly onTake: (action: SindiAction) => void;
}

export function SindiActionCard({ execution, onTake }: SindiActionCardProps) {
  const { t } = useTranslation();
  const { envelope, outcome } = execution;

  const take = useCallback(() => onTake(envelope.action), [onTake, envelope.action]);

  if (outcome === 'inline') {
    return (
      <View>
        {/* "Show me my saved homes" is answered, not offered. The answer IS the
            list, and a button that leaves the conversation to go and look at it
            is a worse version of answering. The offer stays below for anybody
            who wants the full screen. */}
        {envelope.action.kind === 'show_saved' ? (
          <SindiSavedHomes folderId={envelope.action.folderId} />
        ) : null}
        <View className="mx-4 mb-2 flex-row flex-wrap items-center gap-2">
          <P className="text-[13px] text-muted-foreground">{t(actionKey(envelope.action))}</P>
          <Button
            variant="secondary"
            size="small"
            onPress={take}
            accessibilityLabel={t('sindi.actions.takeAccessible')}
          >
            {t('sindi.actions.take')}
          </Button>
        </View>
      </View>
    );
  }

  const key = outcomeKey(outcome);
  if (!key) return null;

  return (
    <View className="mx-4 mb-2">
      <P className="text-[13px] text-muted-foreground">
        {t(key, { what: t(actionKey(envelope.action)) })}
      </P>
    </View>
  );
}
