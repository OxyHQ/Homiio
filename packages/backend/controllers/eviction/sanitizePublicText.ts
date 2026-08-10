/**
 * Free text on the eviction board, reduced to what the board may publish.
 *
 * ## Why this file exists at all
 *
 * ADR 0003 records it as finding F9: `eviction_cases.location_label` and
 * `.description` were unconstrained `text`, published verbatim, beside a
 * coordinate the write path carefully degraded. *"Rounding a coordinate while
 * publishing an unconstrained label is theatre: the label is where a reporter
 * types 'Carrer de X 42, 3r 2a'."* The most careful geometry in the world is
 * undone by one line of prose, and the prose is the field a reporter fills in
 * fastest.
 *
 * ## What is removed, and what is deliberately kept
 *
 * The street NAME stays. A street is tier C and is exactly what a supporter
 * needs to find the gathering; ADR 0003 §7.2 draws the line precisely there —
 * *"'Carrer X 42' is what a supporter needs; '3-2' is what a debt collector
 * needs"* — and then §7.1 pulls it one notch coarser for this board by
 * publishing the street without its number.
 *
 * So four classes are removed and nothing else:
 *
 *  1. **A building number following a street word.** Only the NUMBER, so
 *     "Carrer de Sants 42" becomes "Carrer de Sants" rather than disappearing.
 *  2. **Unit designators** — floor, door, staircase, in the Spanish, Catalan and
 *     English forms this market actually produces.
 *  3. **Email addresses.**
 *  4. **Phone numbers**, including the `wa.me` and `t.me` links that are a phone
 *     number with extra steps.
 *
 * ## The report names CATEGORIES, never the removed value
 *
 * {@link sanitizePublicText} returns `['building_number', 'phone']`, not the
 * number it took out. Echoing the value back would put it in a response body,
 * and F4 in the same ADR is that this deployment logs response and request
 * bodies on every error — so the "helpful" version of this function would
 * reintroduce the exact disclosure into the log, from the code written to
 * prevent it.
 *
 * ## What this is NOT
 *
 * It is not a moderation surface and it makes no judgement about the content. It
 * is a mechanical write-path rule with a fixed vocabulary, applied identically
 * to every case, and the reporter is told which rule fired so they can rewrite
 * the sentence — which is ADR 0003 §5.8's *"what the author is always told:
 * which rule fired, which field it applied to, and what would change the
 * outcome"*.
 */

/** Which class of thing was taken out. The wire never carries the value. */
export type RemovedTextClass = 'building_number' | 'unit_designator' | 'email' | 'phone';

export interface SanitizedText {
  readonly text: string;
  /** Deduplicated, in a stable order, so a client can render fixed copy. */
  readonly removed: readonly RemovedTextClass[];
}

/**
 * Street words this market produces, in Spanish, Catalan and English.
 *
 * The list is what makes the number-stripping TARGETED rather than a blanket
 * "remove digits": "we meet at 10am" and "the hearing is on the 3rd" must
 * survive, and they only survive because a bare number is left alone.
 */
const STREET_WORDS = [
  'calle',
  'c\\/',
  'carrer',
  'carretera',
  'avenida',
  'avinguda',
  'avda',
  'av',
  'plaza',
  'pla[çc]a',
  'paseo',
  'passeig',
  'rambla',
  'camino',
  'cami',
  'travesera',
  'travessera',
  'ronda',
  'street',
  'road',
  'avenue',
  'square',
  'lane',
].join('|');

/**
 * A street phrase followed by its number.
 *
 * The number is captured separately so only it is removed. `[^,;\n]{0,40}?` is
 * lazy and stops at punctuation, so the pattern cannot run away across a whole
 * paragraph and swallow an unrelated figure at the end of it.
 */
const STREET_NUMBER = new RegExp(
  `\\b(${STREET_WORDS})\\b([^,;\\n]{0,40}?)[\\s,]{1,8}(?:n[ºo°]?\\.?[ \\t]{0,4})?(\\d{1,4})(?:[ \\t]{0,4}[-–][ \\t]{0,4}\\d{1,4})?\\b`,
  'gi',
);

/**
 * Floor / door / staircase designators.
 *
 * Several alternatives rather than one clever pattern, because the Catalan
 * `3r 2a`, the Spanish `3º 2ª` and the English `flat 2` share no shape, and a
 * pattern general enough to cover all three also matches ordinary prose.
 */
const UNIT_DESIGNATORS: readonly RegExp[] = [
  // `3º 2ª`, `3o 2a`, `4º B`
  /\b\d{1,3}[ \t]{0,4}[ºoª°][ \t]{0,4}[.,-]?[ \t]{0,4}\d{0,3}[ \t]{0,4}[ªaᵃ]?\b/gi,
  // Catalan `3r 2a`, `1r 1a`, `2n 3a`
  /\b\d{1,3}[ \t]{0,4}(?:r|n|er|on|t|rt)[ \t]{1,4}\d{1,3}[ \t]{0,4}a\b/gi,
  // Spanish words
  /\b(?:piso|planta|puerta|pta|escalera|esc|bajo|baixos|[áa]tico|entresuelo)[ \t]{0,4}\.?[ \t]{0,4}[A-Za-z0-9]{1,3}\b/gi,
  // English words
  /\b(?:floor|flat|apt|apartment|unit|door|staircase)[ \t]{0,4}\.?[ \t]{0,4}[A-Za-z0-9]{1,4}\b/gi,
];

/**
 * An email address, with every quantifier BOUNDED to the RFC's own limits.
 *
 * `[\w.+-]+` was the last polynomial pattern in this module and the one CodeQL
 * kept flagging (`js/polynomial-redos`, "many repetitions of '+'"): the class
 * contains `+`, it is unbounded, and it is followed by an `@` that a run of
 * plus signs never reaches — so every start position rescans the whole run and
 * the match is quadratic in attacker-controlled text on a public write path.
 *
 * The ceilings are the real ones (64-character local part, 63-character DNS
 * labels, at most a handful of them), so nothing a person can actually send
 * stops being matched.
 */
const EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;

/**
 * A phone number, requiring at least nine digits.
 *
 * The digit floor is what keeps a date ("12-03-2026") and a time out of it. A
 * looser pattern would strip the very dates a case exists to announce, which is
 * a failure that reads as data loss rather than as over-zealous privacy.
 *
 * The repetition is BOUNDED (`{7,30}`) and every quantifier in this module is,
 * because this function runs on attacker-controlled text on a public write path.
 * `[\d\s().-]` overlaps the `\d` that follows it, so an unbounded `{7,}` makes
 * the match quadratic in the length of a run of spaces — `js/polynomial-redos`,
 * flagged by CodeQL on this exact line. A ceiling of 30 covers every real
 * international number (the longest E.164 is 15 digits plus separators) and
 * turns the worst case into a constant multiple of the input length.
 */
const PHONE = /\+?\d[\d\s().-]{7,30}\d/g;

/** A phone number wearing a link. */
const MESSENGER_LINK = /\b(?:https?:\/\/)?(?:wa\.me|t\.me|api\.whatsapp\.com)\/\S{1,200}/gi;

/**
 * Collapse the whitespace a removal leaves behind, without touching newlines.
 *
 * Every quantifier here is BOUNDED for the reason the phone pattern documents:
 * these run on attacker-controlled text, and `\s+` scanned from each position
 * of a long run of spaces is quadratic. The ceilings are far above any real
 * gap a removal leaves — a removed phone number is under 40 characters — so
 * bounding them changes no output this module can actually produce.
 */
function tidy(value: string): string {
  return value
    .replace(/[ \t]{2,200}/g, ' ')
    .replace(/[ \t]{1,200}([,;.])/g, '$1')
    .replace(/,[ \t]{0,200},/g, ',')
    .trim();
}

/**
 * Remove the four classes above from a piece of public text.
 *
 * Order matters: messenger links go before the bare phone pattern, or the phone
 * pattern eats the numeric part of a `wa.me/34600...` link and leaves a dangling
 * host behind.
 */
export function sanitizePublicText(input: string): SanitizedText {
  const removed = new Set<RemovedTextClass>();
  let text = input;

  const strip = (pattern: RegExp, kind: RemovedTextClass, replacement = ' ') => {
    // `pattern` is module-level and carries `g`, so `lastIndex` survives between
    // calls. Resetting it is not tidiness: without it the SECOND case processed
    // in a request starts matching from wherever the first one stopped, and the
    // text it skips is published unsanitised.
    pattern.lastIndex = 0;
    if (!pattern.test(text)) return;
    removed.add(kind);
    pattern.lastIndex = 0;
    text = text.replace(pattern, replacement);
  };

  strip(MESSENGER_LINK, 'phone');
  strip(EMAIL, 'email');
  strip(PHONE, 'phone');

  for (const pattern of UNIT_DESIGNATORS) strip(pattern, 'unit_designator');

  // The street number, keeping the street. `$1$2` puts back the street word and
  // whatever came between it and the number.
  STREET_NUMBER.lastIndex = 0;
  if (STREET_NUMBER.test(text)) {
    removed.add('building_number');
    STREET_NUMBER.lastIndex = 0;
    text = text.replace(STREET_NUMBER, '$1$2');
  }

  // A stable order so the client's copy list does not reshuffle between saves.
  const order: readonly RemovedTextClass[] = [
    'building_number',
    'unit_designator',
    'phone',
    'email',
  ];
  return { text: tidy(text), removed: order.filter((kind) => removed.has(kind)) };
}
