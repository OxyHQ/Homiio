/**
 * A key whose value is the ENGLISH STRING in every locale is untranslated, and
 * from now on that is a decision somebody records rather than something that
 * happens quietly (#413).
 *
 * ## The hole this closes
 *
 * `scripts/check-locale-parity.ts` compares KEY SETS. A key present in all
 * twelve files carrying the English string passes it — which is how the whole
 * of `home.*` and `location.scope.*` shipped as English in eleven locales
 * across #353 and #354. The scope bar is the first thing a user sees at cold
 * start, and it was in English for every non-English reader, with a green gate.
 *
 * ## Why "identical to English" is a fair test here, measured rather than assumed
 *
 * "Identical is legitimate sometimes" is true and is the reason a naive check
 * would cry wolf — so it was measured before being built. On the tree this test
 * was written against, **589** keys were byte-identical to English in all eleven
 * non-English locales. Of those, **11** are legitimately identical, and every
 * one is mechanically recognisable: a value that is nothing but an interpolation
 * (`"{{type}}"`), or a brand or product name (`Homiio`, `Sindi`, `Wi-Fi`,
 * `WhatsApp`, `Telegram`). The other **578** are real English sentences —
 * "Try widening your area or relaxing your filters.", "Give your search a name"
 * — sitting in the Arabic, Bengali, Hindi, Russian and Chinese files.
 *
 * A **2%** false-positive rate is not a wolf-crier. The reason it is that low is
 * structural rather than lucky: for a string to be legitimately identical across
 * eleven locales it has to survive five different scripts at once, and almost
 * nothing but a proper noun does.
 *
 * Contrast, so the distinction is not lost: at the level of a SINGLE locale,
 * identical-to-English is often correct — "Legal" is the Spanish word, "Studios"
 * is the French one. This test deliberately asks the all-eleven question, which
 * is the one with the low false-positive rate.
 *
 * ## Two lists, and they mean different things
 *
 * Keeping them apart is the whole design. Merging them would let a real defect
 * hide inside "this one is fine".
 *
 *  - {@link LEGITIMATELY_IDENTICAL} — the translation IS the English string.
 *    Permanent, tiny, one reason per entry.
 *  - `untranslatedRegister.json` — this key is untranslated and we know.
 *    Temporary and SHRINK-ONLY: translating a key means deleting its line, in
 *    the same commit, or this test fails on the stale entry.
 *
 * **Being in neither fails.** That is the gate, and it is what makes a new
 * English filler impossible to ship unnoticed: it is not enough to be absent
 * from a list, a key has to be in one of them or genuinely translated. Being in
 * BOTH fails too, so a key cannot hide behind its own exemption.
 *
 * ## What to do when this fails
 *
 * The failure names the keys and the way out. Translate them — or, if that is
 * not this change's job, add them to the register, which is a visible line in a
 * diff somebody reviews instead of a silent English string in eleven files.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = join(__dirname, '..', '..', 'locales');
const REGISTER_PATH = join(__dirname, 'untranslatedRegister.json');

/**
 * Keys whose correct translation IS the English string, in every locale.
 *
 * Every entry is a proper noun or a bare interpolation. Before adding one, ask
 * whether the word really has no translation in Arabic, Bengali, Hindi, Russian
 * AND Chinese — `applications.docType.id` ("ID") looks like it belongs here and
 * does NOT, because that one has ordinary translations in all five and is
 * simply untranslated. It is in the register instead.
 */
const LEGITIMATELY_IDENTICAL: ReadonlyMap<string, string> = new Map([
  ['properties.type.title', 'the value is nothing but the interpolation `{{type}}`'],
  ['search.filters.amenity.wifi', 'Wi-Fi is the same token everywhere'],
  ['settings.aboutHomiio.appName', 'the product name'],
  ['subscriptions.page.headerTitle', 'the product name, Homiio+'],
  ['evictions.timeline.systemActor', 'the product name, used as the actor'],
  ['sindi.name', 'the assistant is called Sindi in every language'],
  ['sindi.title', 'the assistant is called Sindi in every language'],
  ['sindi.panel.title', 'the assistant is called Sindi in every language'],
  ['sidebar.navigation.sindi', 'the assistant is called Sindi in every language'],
  ['evictions.detail.contact.whatsapp', 'the messaging app is a brand name'],
  ['evictions.detail.contact.telegram', 'the messaging app is a brand name'],
]);

/**
 * A floor on the locales compared.
 *
 * Without it a directory read that returned nothing would compare English to
 * an empty set, find no key identical "in every locale" vacuously, and report a
 * perfectly translated app.
 */
const MINIMUM_NON_ENGLISH_LOCALES = 8;

/** A floor on the keys compared, for the same reason. */
const MINIMUM_KEYS = 2000;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Flatten to dotted paths, with the same top-level exception the shipped
 * parity script makes: a top-level key that already contains dots is a leaf, not
 * a path. Divergence here would compare two different key spaces.
 */
function flatten(value: Record<string, Json>, prefix = ''): Map<string, Json> {
  const flat = new Map<string, Json>();
  for (const [key, child] of Object.entries(value)) {
    if (prefix === '' && key.includes('.') && (typeof child === 'string' || Array.isArray(child))) {
      flat.set(key, child);
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      for (const [nested, nestedValue] of flatten(child as Record<string, Json>, path)) {
        flat.set(nested, nestedValue);
      }
    } else {
      flat.set(path, child);
    }
  }
  return flat;
}

function loadLocale(file: string): Map<string, Json> {
  return flatten(JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as Record<string, Json>);
}

/** Deep equality by serialisation — values here are strings and string arrays. */
const sameValue = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);

const NON_ENGLISH_FILES = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json') && file !== 'en.json')
  .sort();

const english = loadLocale('en.json');
const translations = NON_ENGLISH_FILES.map((file) => ({
  locale: file.replace(/\.json$/, ''),
  values: loadLocale(file),
}));

/** Keys carrying the English value in EVERY non-English locale. */
const identicalEverywhere = [...english.entries()]
  .filter(([key, value]) =>
    translations.every(({ values }) => values.has(key) && sameValue(values.get(key) as Json, value)),
  )
  .map(([key]) => key);

const register: string[] = JSON.parse(readFileSync(REGISTER_PATH, 'utf8')) as string[];
const registered = new Set(register);

describe('the comparison itself is not vacuous', () => {
  it('compares enough locales and enough keys to mean something', () => {
    expect(NON_ENGLISH_FILES.length).toBeGreaterThanOrEqual(MINIMUM_NON_ENGLISH_LOCALES);
    expect(english.size).toBeGreaterThanOrEqual(MINIMUM_KEYS);
  });

  it('flattens nested objects and dotted top-level keys the same way the shipped parity script does', () => {
    // The POSITIVE control. A flattener that stopped descending would produce a
    // handful of top-level keys, find nothing identical, and pass forever.
    const flat = flatten({
      home: { hero: { title: 'Find your ethical home' } },
      'a.dotted.top.level.key': 'kept whole',
    } as Record<string, Json>);
    expect(flat.get('home.hero.title')).toBe('Find your ethical home');
    expect(flat.get('a.dotted.top.level.key')).toBe('kept whole');
    expect(flat.size).toBe(2);
  });

  it('finds a planted untranslated key, and does not flag a translated one', () => {
    // The predicate under test, exercised directly on both sides of the
    // distinction it exists to make.
    const enSample = new Map<string, Json>([['x', 'Save'], ['y', 'Search']]);
    const localeSample = new Map<string, Json>([['x', 'Save'], ['y', 'Buscar']]);
    const flagged = [...enSample.entries()]
      .filter(([key, value]) => sameValue(localeSample.get(key) as Json, value))
      .map(([key]) => key);
    expect(flagged).toEqual(['x']);
  });
});

describe('every untranslated key is accounted for', () => {
  it('has no key that is English everywhere and in neither list', () => {
    // THE GATE. `home.*` and `location.scope.*` would have failed here for the
    // whole of their life before #413.
    const unaccounted = identicalEverywhere.filter(
      (key) => !registered.has(key) && !LEGITIMATELY_IDENTICAL.has(key),
    );

    expect({
      count: unaccounted.length,
      keys: unaccounted.slice(0, 25),
      howToFix:
        'Translate these, or add them to __tests__/i18n/untranslatedRegister.json in the same commit.',
    }).toEqual({
      count: 0,
      keys: [],
      howToFix:
        'Translate these, or add them to __tests__/i18n/untranslatedRegister.json in the same commit.',
    });
  });

  it('has no key in BOTH lists', () => {
    // A key cannot be excused as legitimate AND tracked as a defect; that is how
    // an exemption becomes a hiding place.
    const both = register.filter((key) => LEGITIMATELY_IDENTICAL.has(key));
    expect(both).toEqual([]);
  });
});

describe('the register only shrinks', () => {
  it('has no entry that is already translated, or gone', () => {
    // Translating a key means deleting its line here, in the same commit. A
    // stale entry is not harmless: it is a claim that something is broken when
    // it is not, and a register nobody trusts stops being read.
    const identical = new Set(identicalEverywhere);
    const stale = register.filter((key) => !identical.has(key));

    expect({
      count: stale.length,
      keys: stale.slice(0, 25),
      howToFix: 'These are translated (or deleted). Remove them from untranslatedRegister.json.',
    }).toEqual({
      count: 0,
      keys: [],
      howToFix: 'These are translated (or deleted). Remove them from untranslatedRegister.json.',
    });
  });

  it('is sorted and free of duplicates, so a diff on it is readable', () => {
    expect(register).toEqual([...new Set(register)].sort());
  });
});

describe('the legitimate-identical list stays honest', () => {
  it('names only keys that exist and really are identical everywhere', () => {
    // A stranded exemption outlives the string it excused and quietly widens
    // what the gate permits.
    const identical = new Set(identicalEverywhere);
    const stranded = [...LEGITIMATELY_IDENTICAL.keys()].filter((key) => !identical.has(key));
    expect(stranded).toEqual([]);
  });

  it('gives a reason for every entry', () => {
    const unexplained = [...LEGITIMATELY_IDENTICAL.entries()]
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([key]) => key);
    expect(unexplained).toEqual([]);
  });
});

describe('the surfaces #413 named are translated', () => {
  it.each(['home.', 'location.scope.', 'search.where.'])(
    'has no key under %s left in English everywhere',
    (prefix) => {
      // Pinned separately from the register so these three cannot quietly be
      // added back to it. The scope bar is the first thing a user sees.
      const stillEnglish = identicalEverywhere.filter((key) => key.startsWith(prefix));
      expect(stillEnglish).toEqual([]);
    },
  );

  it('kept every interpolation placeholder that English carries', () => {
    // A translation that drops `{{place}}` renders a sentence with a hole in it,
    // and nothing else in this repository would notice.
    const placeholders = (value: Json): string =>
      [...String(value).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((match) => match[1]).sort().join(',');

    const broken: string[] = [];
    for (const [key, value] of english) {
      if (typeof value !== 'string' || !value.includes('{{')) continue;
      for (const { locale, values } of translations) {
        const translated = values.get(key);
        if (typeof translated !== 'string') continue;
        if (placeholders(translated) !== placeholders(value)) {
          broken.push(`${locale}: ${key}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
