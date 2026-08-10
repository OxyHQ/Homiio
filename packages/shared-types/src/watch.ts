/**
 * Saved housing watches and the alerts they produce — issue #356.
 *
 * A WATCH is a saved search that has been given a job: keep looking, and tell me
 * when something changes. The search half already exists (`saved_searches`, with
 * the canonical `LocationSelection` #352 put on it); everything in this module is
 * the alerting half — which rules a watch subscribes to, how often it may speak,
 * through which channels, and what a resulting alert is allowed to SAY.
 *
 * ## Three properties this module exists to make structural
 *
 * **1. A rule that cannot be evaluated correctly is not offerable.** The issue is
 * explicit — "No emitir reglas que no puedan evaluarse correctamente" — and the
 * temptation is to ship the full nine-value vocabulary and quietly never fire
 * four of them. {@link HOUSING_ALERT_RULE_SPECS} carries an `availability` per
 * rule with the REASON attached, the API refuses to enable an unavailable rule,
 * and the matcher refuses to evaluate one. The vocabulary is therefore complete
 * (so a stored row survives a rule becoming available later) while the offer is
 * honest. See {@link RuleAvailability}.
 *
 * **2. An explanation is a CLOSED union, not a string somebody assembles.** Every
 * alert has to say what changed and which watch matched — "recomendado para ti"
 * with no concrete reason is forbidden — and the same sentence must not leak a
 * coordinate. A free-form message can do both wrong at once. {@link AlertExplanation}
 * is a discriminated union whose variants carry only the fields a safe sentence
 * needs, so a coordinate has nowhere to sit: there is no variant with a `latitude`.
 * {@link findUnsafeAlertFields} is the second, kind-agnostic layer over the top,
 * for the same reason `observability/redaction` runs two — a union is only as
 * safe as the next variant somebody adds to it.
 *
 * **3. Cadence, cooldown and thresholds are DATA, not scattered constants.** A
 * cooldown window in the matcher and a default threshold in a controller drift
 * the day one of them is tuned. Both live on the rule spec.
 *
 * ## What is deliberately NOT here
 *
 * The geographic evaluation. A watch's area comes from its `LocationSelection`
 * (`./location`), and turning one into a polygon is the backend's job because it
 * is answered by PostGIS against real reference geometry. This module only names
 * the selection kinds a watch may be built from — see {@link isWatchableSelection},
 * which is the one piece of that decision the frontend must agree with, since it
 * decides whether the "create a watch" affordance is offered at all.
 */

import type { LocationSelection } from './location';

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Every change a watch could subscribe to.
 *
 * COMPLETE on purpose, including the rules nothing can evaluate yet. A stored
 * `alert_rules` row names one of these, so trimming the tuple to "what works
 * today" would make a row written tomorrow unreadable by a build from last week
 * — and would hide, rather than record, which parts of the product are not
 * finished. What each one can actually do is {@link HOUSING_ALERT_RULE_SPECS}.
 */
export const HOUSING_ALERT_RULE_TYPES = [
  'new_listing',
  'price_decrease',
  'price_increase',
  'cost_terms_changed',
  'listing_removed',
  'listing_reappeared',
  'new_review',
  'eviction_nearby',
  'source_conflict',
] as const;

export type HousingAlertRuleType = (typeof HOUSING_ALERT_RULE_TYPES)[number];

/**
 * Whether a rule can be offered, and if not, why not.
 *
 * The reason is part of the data rather than a comment because it is shown to
 * nobody and read by everybody: a rule marked unavailable with no reason invites
 * the next person to flip the flag, and the whole point is that flipping it needs
 * the SOURCE to change first.
 */
export type RuleAvailability =
  | { readonly status: 'available' }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface HousingAlertRuleSpec {
  readonly type: HousingAlertRuleType;
  readonly availability: RuleAvailability;
  /** Whether a NEW watch subscribes to it by default. Conservative on purpose. */
  readonly defaultEnabled: boolean;
  /**
   * Whether `threshold` means anything for this rule.
   *
   * Only the two price rules use it, as a MINIMUM PERCENT move. A rule that
   * ignores thresholds rejects one rather than storing a number that does
   * nothing — a stored value nobody reads is a promise the product does not keep.
   */
  readonly supportsThreshold: boolean;
  /** Percent move a price rule must clear to fire, when the watch names none. */
  readonly defaultThreshold?: number;
  /**
   * Hours during which a SECOND alert of this rule for the same watch and the
   * same subject is suppressed, however different the transition.
   *
   * `0` means no cooldown, and it is not the same as a short one — see
   * `cooldownBucket` in the backend repository, where zero is stored as NULL and
   * the unique index therefore stops constraining the row at all.
   *
   * The rules that oscillate under re-ingestion are the ones with a window: a
   * portal that republishes a listing at a rounded price and back again produces
   * a genuine, distinct transition each time, so structural transition dedupe
   * cannot catch it and only a time window can.
   */
  readonly cooldownHours: number;
}

/**
 * What each rule can do TODAY, with the reason attached where it can do nothing.
 *
 * The four unavailable ones are unavailable for three different reasons, and the
 * distinction is worth keeping because it says what would have to change:
 *
 *  - `listing_reappeared` and `source_conflict` need listing HISTORY — a record
 *    of what a listing looked like before it went away, and of which sources
 *    have described the same dwelling. Homiio stores neither today (ADR 0001
 *    names the housing graph as the future home for both), so the rule cannot be
 *    evaluated at all rather than being evaluated badly.
 *  - `new_review` could be evaluated spatially today, and is off for a PRIVACY
 *    reason rather than a data one: ADR 0003 §5.1 publishes a review at the
 *    BUILDING level while a watch matches an AREA, and "a review appeared inside
 *    your area" over a small enough area is an identification. It needs the
 *    k-anonymity floor of ADR 0003 §4.4 applied to the area before it is safe.
 *  - `eviction_nearby` is owned by the eviction domain (#358). The rule type,
 *    the matching and the approximate-location explanation all exist here; what
 *    does not exist is a producer, and inventing one from this side would mean
 *    reaching into tables another change owns. See `recordHousingDomainEvent`.
 */
export const HOUSING_ALERT_RULE_SPECS: Readonly<
  Record<HousingAlertRuleType, HousingAlertRuleSpec>
> = {
  new_listing: {
    type: 'new_listing',
    availability: { status: 'available' },
    defaultEnabled: true,
    supportsThreshold: false,
    // No window. Two different listings are two different subjects, and the same
    // listing cannot be new twice — the transition key already makes that
    // impossible, so a window here would only suppress something real.
    cooldownHours: 0,
  },
  price_decrease: {
    type: 'price_decrease',
    availability: { status: 'available' },
    defaultEnabled: true,
    supportsThreshold: true,
    defaultThreshold: 3,
    cooldownHours: 24,
  },
  price_increase: {
    type: 'price_increase',
    availability: { status: 'available' },
    // OFF by default: a rent going up is not news somebody asked for, and a
    // watch that fires on every portal re-price is the fastest way to have the
    // whole feature muted.
    defaultEnabled: false,
    supportsThreshold: true,
    defaultThreshold: 5,
    cooldownHours: 24,
  },
  cost_terms_changed: {
    type: 'cost_terms_changed',
    availability: { status: 'available' },
    defaultEnabled: false,
    supportsThreshold: false,
    cooldownHours: 24,
  },
  listing_removed: {
    type: 'listing_removed',
    availability: { status: 'available' },
    defaultEnabled: false,
    supportsThreshold: false,
    cooldownHours: 24,
  },
  listing_reappeared: {
    type: 'listing_reappeared',
    availability: {
      status: 'unavailable',
      reason:
        'Needs listing history: nothing records that a listing was previously withdrawn, ' +
        'so a re-ingest of a listing Homiio never saw leave is indistinguishable from a return.',
    },
    defaultEnabled: false,
    supportsThreshold: false,
    cooldownHours: 72,
  },
  new_review: {
    type: 'new_review',
    availability: {
      status: 'unavailable',
      reason:
        'Needs the ADR 0003 §4.4 k-anonymity floor applied to a watch area: over a small ' +
        'enough area, "a review appeared here" identifies the household it is about.',
    },
    defaultEnabled: false,
    supportsThreshold: false,
    cooldownHours: 0,
  },
  eviction_nearby: {
    type: 'eviction_nearby',
    availability: {
      status: 'unavailable',
      reason:
        'Owned by the eviction domain (#358). The rule, the match and the approximate-area ' +
        'explanation exist; the producer that records the domain event does not.',
    },
    defaultEnabled: false,
    supportsThreshold: false,
    cooldownHours: 24,
  },
  source_conflict: {
    type: 'source_conflict',
    availability: {
      status: 'unavailable',
      reason:
        'Needs cross-source dwelling identity: without it, the same flat on two portals and ' +
        'two different flats in one building are the same observation.',
    },
    defaultEnabled: false,
    supportsThreshold: false,
    cooldownHours: 72,
  },
};

/** The rules a watch may currently subscribe to. Derived, never retyped. */
export const AVAILABLE_HOUSING_ALERT_RULE_TYPES: readonly HousingAlertRuleType[] =
  HOUSING_ALERT_RULE_TYPES.filter(
    (type) => HOUSING_ALERT_RULE_SPECS[type].availability.status === 'available',
  );

export function isHousingAlertRuleType(value: unknown): value is HousingAlertRuleType {
  return (
    typeof value === 'string' &&
    (HOUSING_ALERT_RULE_TYPES as readonly string[]).includes(value)
  );
}

export function isRuleAvailable(type: HousingAlertRuleType): boolean {
  return HOUSING_ALERT_RULE_SPECS[type].availability.status === 'available';
}

export interface HousingAlertRule {
  readonly type: HousingAlertRuleType;
  readonly enabled: boolean;
  /** Minimum percent move, for the rules whose spec supports one. */
  readonly threshold?: number;
}

/** The rule set a brand-new watch starts with. Conservative defaults, per the issue. */
export function defaultAlertRules(): HousingAlertRule[] {
  return AVAILABLE_HOUSING_ALERT_RULE_TYPES.map((type) => {
    const spec = HOUSING_ALERT_RULE_SPECS[type];
    return spec.supportsThreshold && spec.defaultThreshold !== undefined
      ? { type, enabled: spec.defaultEnabled, threshold: spec.defaultThreshold }
      : { type, enabled: spec.defaultEnabled };
  });
}

// ---------------------------------------------------------------------------
// Channels and cadence
// ---------------------------------------------------------------------------

/**
 * Where an alert may be delivered.
 *
 * `in_app` is MANDATORY and the schema enforces it: the issue calls it the
 * visible source of truth, and a watch delivering only to a channel that later
 * fails leaves the user with no record that anything happened at all.
 */
export const ALERT_CHANNELS = ['in_app', 'push', 'email'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const MANDATORY_ALERT_CHANNEL: AlertChannel = 'in_app';

/**
 * Which channels have a delivering writer behind them.
 *
 * The issue's rule is "no añadir canales sin un writer/dispatcher idempotente",
 * and the honest position today is that exactly one channel has one:
 * `notificationDispatchService`, the single in-app chokepoint.
 *
 *  - `push` has NO server transport. Homiio registers no device token anywhere,
 *    so nothing server-side can reach a lock screen. What exists is the client's
 *    own local presentation (`utils/notifications.ts`), which is why the push
 *    TEXT is still produced and stored — see {@link AlertPushText} — and why the
 *    client is the thing that must check permission before presenting it.
 *  - `email` has no sender, no unsubscribe-per-category surface and no bounce
 *    handling. Storing the preference is fine; delivering without those is not.
 *
 * A channel selected but not deliverable produces a delivery row in the
 * `suppressed` state naming the reason, rather than silently doing nothing —
 * the difference between the two is exactly what the alert history has to be
 * able to show when somebody asks why they were not told.
 */
export const DELIVERABLE_ALERT_CHANNELS: readonly AlertChannel[] = ['in_app'];

export function isAlertChannel(value: unknown): value is AlertChannel {
  return typeof value === 'string' && (ALERT_CHANNELS as readonly string[]).includes(value);
}

export const WATCH_CADENCES = ['instant', 'daily', 'weekly', 'off'] as const;
export type WatchCadence = (typeof WATCH_CADENCES)[number];

export function isWatchCadence(value: unknown): value is WatchCadence {
  return typeof value === 'string' && (WATCH_CADENCES as readonly string[]).includes(value);
}

/**
 * How a matched alert leaves the matcher.
 *
 * `pending` is the digest state: the alert EXISTS (so its idempotency key is
 * claimed and the same transition cannot be matched twice) but nothing has been
 * delivered yet. That ordering is the whole reason a digest cannot double-send.
 */
export const ALERT_DELIVERY_STATES = ['pending', 'delivered', 'suppressed', 'failed'] as const;
export type AlertDeliveryState = (typeof ALERT_DELIVERY_STATES)[number];

/**
 * Why an alert was matched and then NOT delivered.
 *
 * Recorded rather than inferred, because "you have no alerts" and "we suppressed
 * four of them because your watch is muted" are different answers to the same
 * question, and only one of them tells the user what to change.
 */
export const ALERT_SUPPRESSION_REASONS = [
  'muted',
  'cadence_off',
  'channel_unavailable',
  'rate_limited',
] as const;
export type AlertSuppressionReason = (typeof ALERT_SUPPRESSION_REASONS)[number];

// ---------------------------------------------------------------------------
// The watch
// ---------------------------------------------------------------------------

/**
 * Which selection kinds may become a watch.
 *
 * `current_location` is REFUSED, and it is the only refusal:
 *
 *  - It is not a place. "Near me" means "near wherever I am when I look", and a
 *    watch is evaluated by a server job with no device attached, so the only way
 *    to persist one is to freeze a device fix into the row — which is precisely
 *    the exact GPS position ADR 0002 keeps out of every key, URL and log, and
 *    which this issue names again ("No guardar ubicación GPS exacta cuando un
 *    área aproximada sea suficiente").
 *  - The user's intent survives anyway: picking the place they are in produces a
 *    `place` selection, which watches fine.
 *
 * `polygon` is accepted here even though ADR 0002 §2.1 reserves its URL form —
 * a watch is stored, not serialised into a `loc` token, so the two constraints
 * are independent. What it costs is the deep link, and the backend says so by
 * returning no `locToken` for such a watch rather than inventing one.
 */
export function isWatchableSelection(selection: LocationSelection | null | undefined): boolean {
  if (!selection) return false;
  return selection.kind !== 'current_location';
}

export interface SavedHousingWatch {
  readonly id: string;
  readonly oxyUserId: string;
  readonly name: string;
  /**
   * Which version of the search contract `query` / `filters` / `location` were
   * written against. `2` is ADR 0002's contract; `1` is a row from before it, in
   * which `query` holds a place LABEL rather than free text.
   *
   * It is load-bearing rather than bookkeeping: a version-1 row cannot be
   * evaluated, because reading its label as free text would search for the
   * string "Barcelona" and reading it as a place would be the homonym bug ADR
   * 0002 §11.3 refuses. Such a watch asks for confirmation instead of firing.
   */
  readonly queryVersion: number;
  /** The free-text dimension. Usually empty for a place watch. */
  readonly query: string;
  readonly filters: Record<string, unknown>;
  readonly location: LocationSelection | null;
  readonly locationStatus: 'resolved' | 'needs_confirmation';
  /**
   * Whether this is the area Home opens on.
   *
   * At most one per person, enforced by a partial unique index rather than by
   * whoever writes the update. Consumed read-only by the Home feed (#353), which
   * degrades to its own default when no watch carries it.
   */
  readonly isPrimaryArea: boolean;
  readonly alertRules: readonly HousingAlertRule[];
  readonly channels: readonly AlertChannel[];
  readonly cadence: WatchCadence;
  /** ISO timestamp until which this watch delivers nothing. */
  readonly mutedUntil?: string | null;
  /**
   * The moment this watch started watching.
   *
   * An event that happened BEFORE it does not alert, and that is one of the two
   * mechanisms that stop a new watch announcing the entire existing catalogue as
   * "new" (the other is the backfill flag on the event itself). Both are needed:
   * this one protects a NEW watch from OLD listings, and the flag protects an OLD
   * watch from a bulk re-index.
   */
  readonly alertsActiveFrom: string;
  /**
   * Whether the alerting half can actually run, and why not when it cannot.
   *
   * Derived on read rather than stored, because every input to it (the location,
   * the cadence, the rule set, whether an area could be derived) is already a
   * column and a stored copy would be a second authority that goes stale.
   */
  readonly alertStatus: WatchAlertStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Whether a watch will produce anything, stated positively or with a reason.
 *
 * `no_area` is the interesting one: a watch whose location resolved but whose
 * geometry could not be turned into an area — a named place Homiio holds with a
 * centroid and no extent — matches nothing spatially. It has to SAY so. A watch
 * that silently never fires is indistinguishable from a quiet market.
 */
export type WatchAlertStatus =
  | { readonly status: 'active' }
  | {
      readonly status: 'inactive';
      readonly reason:
        | 'cadence_off'
        | 'no_rules_enabled'
        | 'location_needs_confirmation'
        | 'legacy_query_version'
        | 'no_area'
        | 'muted';
    };

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

/**
 * What an alert is allowed to say, as a closed union.
 *
 * Every variant answers both halves of the acceptance criterion at once — what
 * changed, and which watch matched — because `watchName` is on the envelope
 * ({@link AlertExplanation}) rather than on the variants. There is deliberately
 * no `custom` / `text` variant: one would re-admit the free-form sentence this
 * union exists to replace, and with it the coordinate and the "recommended for
 * you" that the issue forbids by name.
 *
 * MONEY IS CARRIED AS AN AMOUNT PLUS A CURRENCY, never as a formatted string.
 * Formatting is `@homiio/shared-types/format`'s job at the point of display, in
 * the reader's locale, which is not knowable when the alert is written.
 */
export type AlertExplanationDetail =
  | {
      readonly kind: 'new_listing';
      readonly listingTitle: string;
      readonly offering: string;
    }
  | {
      readonly kind: 'price_change';
      readonly direction: 'decrease' | 'increase';
      readonly listingTitle: string;
      readonly fromAmount: number;
      readonly toAmount: number;
      readonly currency: string;
      /** Signed percent move, rounded to one decimal. */
      readonly percent: number;
    }
  | {
      readonly kind: 'cost_terms_changed';
      readonly listingTitle: string;
      /** Which cost terms moved (`deposit`, `utilities`), never their values. */
      readonly terms: readonly string[];
    }
  | {
      readonly kind: 'listing_removed';
      readonly listingTitle: string;
    }
  | {
      readonly kind: 'listing_reappeared';
      readonly listingTitle: string;
      readonly sourceName: string;
    }
  | {
      readonly kind: 'new_review';
      /** ADR 0003 §5.1: a review is published at the BUILDING, never the unit. */
      readonly buildingLabel: string;
    }
  | {
      /**
       * ADR 0003 §7.1: a centre and a STATED radius, never a rounded pair that
       * looks exact. No unit, no household, no street number — see §7.2.
       */
      readonly kind: 'eviction_nearby';
      readonly approximateRadiusMeters: number;
      readonly areaLabel: string;
    }
  | {
      readonly kind: 'source_conflict';
      readonly listingTitle: string;
      readonly sourceCount: number;
    };

export interface AlertExplanation {
  /** The watch that matched, by name — the "which watch" half, always present. */
  readonly watchName: string;
  readonly watchId: string;
  readonly ruleType: HousingAlertRuleType;
  /**
   * Which revision of the matching rules produced this.
   *
   * Stored on every alert so a later "why did I get this?" can be answered
   * against the rules AS THEY WERE, rather than against whatever they became.
   */
  readonly ruleVersion: number;
  readonly detail: AlertExplanationDetail;
}

/**
 * The current revision of the matching rules.
 *
 * BUMP THIS whenever a change alters which events match or how a threshold is
 * read. It is written onto every alert, so a stored history stays interpretable
 * across the change rather than silently re-describing old alerts under new
 * rules. It does NOT participate in the idempotency key — see the backend's
 * `alertIdempotencyKey`, where the reasoning is that a rule-version bump must not
 * re-notify a transition somebody has already been told about.
 */
export const HOUSING_ALERT_RULE_VERSION = 1;

// ---------------------------------------------------------------------------
// The safety sweep
// ---------------------------------------------------------------------------

/**
 * Field names an alert payload must never carry, whatever their value.
 *
 * Lower-cased and matched as a SUBSTRING, so `propertyLatitude`, `geoPoint` and
 * `bbox_west` are all caught. A substring match over-reaches by design: the cost
 * of refusing a field that merely sounds spatial is that somebody renames it,
 * and the cost of the reverse is publishing where a person lives.
 */
const FORBIDDEN_ALERT_FIELD_FRAGMENTS: readonly string[] = [
  'latitude',
  'longitude',
  'coordinate',
  'geopoint',
  'geometry',
  'bbox',
  'bounds',
  'lat',
  'lng',
  'lon',
];

/**
 * A string that looks like a coordinate pair — `41.3851, 2.1734` and friends.
 *
 * Guards the case the key-name sweep cannot see: a coordinate pasted into a
 * listing TITLE, which is a legitimate free-text field carried by three
 * explanation variants and populated from portal data Homiio does not author.
 */
const COORDINATE_PAIR = /-?\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/;

/**
 * Every reason a payload is unfit to be published in a notification.
 *
 * Returns FIELD PATHS and never values — a violation is itself something that
 * gets logged, and "rejected: title=41.3851, 2.1734" logs exactly what the
 * rejection prevented. Same rule as `observability/redaction`.
 *
 * This is the SECOND layer. The first is {@link AlertExplanationDetail} being a
 * closed union with no coordinate-shaped field in any variant; this one runs over
 * the assembled object so that the next variant somebody adds is covered before
 * they have thought about it.
 */
export function findUnsafeAlertFields(payload: unknown): string[] {
  const violations: string[] = [];

  const walk = (value: unknown, path: string, depth: number): void => {
    // A payload nested deeper than this is not an explanation, and an unbounded
    // walk over a cyclic object would not return at all.
    if (depth > 8) {
      violations.push(`${path}: too deeply nested to verify`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const lowered = key.toLowerCase();
        const fragment = FORBIDDEN_ALERT_FIELD_FRAGMENTS.find((needle) =>
          lowered.includes(needle),
        );
        const childPath = path ? `${path}.${key}` : key;
        if (fragment !== undefined) {
          violations.push(`${childPath}: field name contains '${fragment}'`);
          continue;
        }
        walk(child, childPath, depth + 1);
      }
      return;
    }
    if (typeof value === 'string' && COORDINATE_PAIR.test(value)) {
      violations.push(`${path}: value looks like a coordinate pair`);
    }
  };

  walk(payload, '', 0);
  return violations;
}

/**
 * The lock-screen text for an alert, and the reason it is a separate shape.
 *
 * A push notification is read by whoever is holding the phone, which is not
 * necessarily the person the alert belongs to. The issue requires the lock-screen
 * text to be configurable and prudent; `discreet` is the default, and it names
 * nothing about the listing or the area at all.
 */
export const PUSH_PRIVACY_MODES = ['discreet', 'detailed'] as const;
export type PushPrivacyMode = (typeof PUSH_PRIVACY_MODES)[number];

export function isPushPrivacyMode(value: unknown): value is PushPrivacyMode {
  return typeof value === 'string' && (PUSH_PRIVACY_MODES as readonly string[]).includes(value);
}

export interface AlertPushText {
  readonly title: string;
  readonly body: string;
  readonly mode: PushPrivacyMode;
}
