/**
 * What an alert SAYS — the one place a change becomes a sentence.
 *
 * Three surfaces, built from one explanation so they cannot disagree:
 *
 *  - the in-app notification's `title` / `message`, which is the visible source
 *    of truth;
 *  - the structured `data` payload, which carries the explanation itself so the
 *    client can render it in the reader's own language and so "por qué recibí
 *    esto" can be answered from the row rather than re-derived;
 *  - the push lock-screen text, which is a DIFFERENT sentence on purpose.
 *
 * ## Every sentence names the change AND the watch
 *
 * That is the acceptance criterion, and it is why there is no code path here
 * that produces a message without a `watchName`. The issue forbids "recomendado
 * para ti" with no concrete reason by name; the way to make that unshippable is
 * to have no function that can produce it, rather than a rule saying not to.
 *
 * ## The push text is prudent by default, and that is not the same sentence
 *
 * A push is read by whoever is holding the phone, which is not necessarily the
 * person the alert belongs to. `discreet` — the default — names neither the
 * listing nor the area, only that something changed and where to look. A user
 * who prefers the detail opts into `detailed`, which is the in-app sentence.
 * Both go through {@link findUnsafeAlertFields} at the storage boundary like
 * everything else.
 *
 * ## Money is formatted HERE and nowhere else in this feature
 *
 * Through `@homiio/shared-types/format`, never by concatenation. The in-app
 * string is composed server-side and so has to pick a locale; it picks the one
 * the amount's currency implies rather than guessing the reader's, and the
 * client can always re-render from `data.explanation`, which carries the amounts
 * as numbers.
 */

import {
  formatMoney,
  type AlertExplanation,
  type AlertExplanationDetail,
  type AlertPushText,
  type PushPrivacyMode,
} from '@homiio/shared-types';

/**
 * The locale the server composes its own copy in.
 *
 * The backend has no reader locale — a notification row is written by a sweep,
 * long before anybody opens the app — so it writes English and ships the
 * structured explanation beside it. The client re-renders from that; this
 * constant exists so the choice is visible rather than implied by a bare
 * `'en-GB'` in the middle of a template.
 */
const SERVER_COPY_LOCALE = 'en-GB';

/** The notification `type`, which the mailbox groups and routes on. */
export const HOUSING_ALERT_NOTIFICATION_TYPE = 'housing_alert';

function money(amount: number, currency: string): string {
  return formatMoney(amount, currency, SERVER_COPY_LOCALE);
}

/** The change, in one sentence, with no mention of the watch. */
function describeChange(detail: AlertExplanationDetail): string {
  switch (detail.kind) {
    case 'new_listing':
      return `New listing: ${detail.listingTitle}.`;
    case 'price_change': {
      const verb = detail.direction === 'decrease' ? 'dropped' : 'rose';
      return (
        `The price ${verb} from ${money(detail.fromAmount, detail.currency)} to ` +
        `${money(detail.toAmount, detail.currency)} on ${detail.listingTitle}.`
      );
    }
    case 'cost_terms_changed':
      return `The ${detail.terms.join(' and ')} changed on ${detail.listingTitle}.`;
    case 'listing_removed':
      return `${detail.listingTitle} is no longer listed.`;
    case 'listing_reappeared':
      return `${detail.listingTitle} is listed again, on ${detail.sourceName}.`;
    case 'new_review':
      // ADR 0003 §5.1 — the BUILDING, never the unit.
      return `A new verified review was published for ${detail.buildingLabel}.`;
    case 'eviction_nearby':
      // ADR 0003 §7.1/§7.2 — a stated radius, no unit, no household.
      return (
        `An eviction is scheduled within about ${detail.approximateRadiusMeters} m of ` +
        `${detail.areaLabel}.`
      );
    case 'source_conflict':
      return `${detail.listingTitle} now appears on ${detail.sourceCount} sources.`;
    default: {
      // A new explanation variant must write its own sentence. Falling back to a
      // generic one is exactly the "recommended for you" this module forbids.
      const exhaustive: never = detail;
      return exhaustive;
    }
  }
}

/** The mailbox headline. Short, and always the WATCH, so grouping reads right. */
function titleFor(detail: AlertExplanationDetail, watchName: string): string {
  switch (detail.kind) {
    case 'new_listing':
      return `New home in ${watchName}`;
    case 'price_change':
      return detail.direction === 'decrease'
        ? `Price drop in ${watchName}`
        : `Price rise in ${watchName}`;
    case 'cost_terms_changed':
      return `Costs changed in ${watchName}`;
    case 'listing_removed':
      return `A home left ${watchName}`;
    case 'listing_reappeared':
      return `A home is back in ${watchName}`;
    case 'new_review':
      return `New review in ${watchName}`;
    case 'eviction_nearby':
      return `Eviction near ${watchName}`;
    case 'source_conflict':
      return `Duplicate listing in ${watchName}`;
    default: {
      const exhaustive: never = detail;
      return exhaustive;
    }
  }
}

export interface AlertNarrative {
  readonly title: string;
  readonly message: string;
  readonly push: AlertPushText;
}

/**
 * The three sentences for one explanation.
 *
 * `message` states the change and then the watch that matched, in that order,
 * because the change is the news and the watch is the justification — and
 * because the acceptance criterion is that BOTH are present, which a single
 * template guarantees more reliably than a review does.
 */
export function alertNarrative(
  explanation: AlertExplanation,
  pushPrivacyMode: PushPrivacyMode,
): AlertNarrative {
  const change = describeChange(explanation.detail);
  const title = titleFor(explanation.detail, explanation.watchName);
  const message = `${change} It matched your saved area "${explanation.watchName}".`;

  const push: AlertPushText =
    pushPrivacyMode === 'detailed'
      ? { title, body: message, mode: 'detailed' }
      : {
          // Names nothing: not the listing, not the area, not the kind of change.
          // Somebody reading over a shoulder learns that this person uses Homiio,
          // which they could see from the app icon anyway.
          title: 'Homiio',
          body: 'There is an update on one of your saved areas.',
          mode: 'discreet',
        };

  return { title, message, push };
}

/**
 * The notification's `data` payload.
 *
 * Carries the explanation verbatim (so the client can localise and so the "why"
 * screen reads the same words the alert was written with), the alert id (so the
 * client can open the right history entry), and the deep link the push must
 * round-trip to.
 *
 * `locToken` is ADR 0002's own `loc` token, produced by the shared serialiser —
 * never a URL format invented here. That is what makes the round trip real: the
 * app parses it with the same parser it uses for every other link, so a token
 * this feature can emit is a token the search screen can already open.
 */
/** How many changes a digest names before it says "and N more". */
const DIGEST_HEADLINE_COUNT = 3;

export interface DigestNarrative {
  readonly title: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
}

/**
 * One sentence for several changes — the digest.
 *
 * Names the TOP few concretely and then counts the rest, which is the issue's
 * "digest con top changes y enlace a todos". It deliberately does not summarise
 * into a category ("some price changes"): the whole point of the explainability
 * requirement is that a person can tell what happened without opening anything,
 * and a digest that says "3 updates" is the "recomendado para ti" problem with a
 * number attached.
 *
 * `distinctSubjects` is reported separately from the alert count because they
 * differ in the case the grouping exists for: four price moves on one listing is
 * four alerts and ONE home, and saying "4 changes" would overstate the market.
 */
export function digestNarrative(input: {
  readonly watchName: string;
  readonly explanations: readonly AlertExplanation[];
  readonly distinctSubjects: number;
  readonly cadence: 'daily' | 'weekly';
  readonly pushPrivacyMode: PushPrivacyMode;
}): DigestNarrative {
  const headline = input.explanations.slice(0, DIGEST_HEADLINE_COUNT).map((explanation) =>
    describeChange(explanation.detail),
  );
  const remaining = input.explanations.length - headline.length;
  const homes = input.distinctSubjects === 1 ? '1 home' : `${input.distinctSubjects} homes`;
  const period = input.cadence === 'daily' ? 'today' : 'this week';

  const message =
    `${headline.join(' ')}${remaining > 0 ? ` And ${remaining} more.` : ''} ` +
    `${homes} changed in your saved area "${input.watchName}" ${period}.`;

  const push: AlertPushText =
    input.pushPrivacyMode === 'detailed'
      ? {
          title: `${homes} changed in ${input.watchName}`,
          body: message,
          mode: 'detailed',
        }
      : {
          title: 'Homiio',
          body: 'There are updates on one of your saved areas.',
          mode: 'discreet',
        };

  return {
    title: `${homes} changed in ${input.watchName}`,
    message,
    data: {
      digest: true,
      cadence: input.cadence,
      watchName: input.watchName,
      alertCount: input.explanations.length,
      distinctSubjects: input.distinctSubjects,
      /** Every explanation, so "enlace a todos" is data rather than a promise. */
      explanations: input.explanations,
      screen: '/saved/alerts',
      push,
    },
  };
}

export function alertNotificationData(input: {
  readonly alertId: string;
  readonly watchId: string;
  readonly explanation: AlertExplanation;
  readonly locToken: string | undefined;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly push: AlertPushText;
}): Record<string, unknown> {
  return {
    alertId: input.alertId,
    watchId: input.watchId,
    explanation: input.explanation,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    /**
     * Where the notification opens.
     *
     * The WATCH's query rather than the listing, when a token exists: the alert
     * is about a change inside an area the person is following, and landing them
     * in that area with the change visible is the answer to "show me". A
     * listing-only deep link loses the context that made it relevant.
     */
    screen: input.locToken ? '/explore' : '/saved',
    locToken: input.locToken,
    push: input.push,
  };
}
