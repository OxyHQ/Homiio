/**
 * The sentence that explains what the pin on the map actually means.
 *
 * ## Why this component exists at all
 *
 * A coordinate looks exact to every consumer. The board publishes a CENTRE and a
 * RADIUS — the true point is somewhere inside that disc, uniformly — and a map
 * that draws a pin without saying so is telling the reader something false in
 * the most confident possible way. #358 asks for an "explicación de precisión
 * aproximada"; this is it, and it states the radius rather than saying
 * "approximate", because a supporter needs to know whether to look for a street
 * or a neighbourhood.
 *
 * Three states, and they are different facts:
 *
 *  - **held** — somebody reported the location as too precise or as exposing
 *    personal data, so no point is published at all until the organiser answers.
 *    Rendered as a Bloom `warning` admonition: something is being withheld.
 *  - **archived** — the case is old; what remains is the neighbourhood.
 *  - **published** — a centre and a radius.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Admonition } from '@oxy.so/bloom/admonition';
import {
  formatDistance,
  type EvictionLocationPublic,
  type EvictionModerationState,
} from '@homiio/shared-types';

export interface EvictionPrecisionNoteProps {
  readonly location: EvictionLocationPublic;
  readonly moderation: EvictionModerationState;
  readonly locale: string;
}

export const EvictionPrecisionNote: React.FC<EvictionPrecisionNoteProps> = ({
  location,
  moderation,
  locale,
}) => {
  const { t } = useTranslation();

  const message = (() => {
    if (moderation.precautionaryHold) return t('evictions.precision.held');
    if (!location.approximateCoordinates || !location.radiusMeters) {
      return t('evictions.precision.noPoint');
    }
    return t('evictions.precision.radius', {
      distance: formatDistance(location.radiusMeters, locale),
    });
  })();

  return (
    <Admonition type={moderation.precautionaryHold ? 'warning' : 'info'}>{message}</Admonition>
  );
};

export default EvictionPrecisionNote;
