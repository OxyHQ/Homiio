/**
 * What an action looks like when the app cannot be driven — and when it was.
 *
 * ## The chat-only column of #519 §8.1
 *
 * With the chat full-screen, "muéstrame pisos por menos de 1.200 €" must NOT
 * navigate. The homes themselves already appear as cards in the conversation
 * (the assistant's `<PROPERTIES_JSON>` block, rendered by `ChatMessage`), so
 * what is missing is the OFFER: a way to take the action deliberately, "una
 * representación/acción explícita dentro del chat; no sustituir la pantalla sin
 * intervención".
 *
 * That is this row. Pressing it is the intervention — an explicit press by the
 * person reading — so it applies the action regardless of the layout, which is
 * the one legitimate route past the capability check.
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
