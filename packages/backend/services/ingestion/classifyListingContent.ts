/**
 * Classify the *free-text* of an external listing (description + title) into a
 * set of structured restriction/nuance flags that portals almost never expose
 * as structured fields, but routinely bury in prose.
 *
 * Real-world motivation (measured on ~5,600 live prod listings across pisos,
 * fotocasa, habitaclia, immoweb and rightmove — ES/CA/EN/FR/NL):
 * - A `type: apartment` listing whose body actually rents a single ROOM in a
 *   shared flat ("se alquilan habitaciones en piso compartido") — the classic
 *   bait-and-switch (~1.5% of the corpus).
 * - Seasonal / temporary leases ("alquiler de temporada", "short let") sold as
 *   a normal apartment (~18% of the ES corpus).
 * - Hard tenant restrictions: students only, one gender only, employed/nómina
 *   only, no pets, no smoking, no couples, no DSS.
 * - An agency fee payable by the tenant ("honorarios de agencia").
 *
 * This is a DETERMINISTIC keyword/regex classifier — zero per-listing cost, no
 * network, no model. It runs multi-language over normalized (deaccented,
 * lowercased, whitespace-collapsed) text with word boundaries to avoid the
 * substring traps that a naive `includes()` would hit (e.g. "estudio" vs
 * "estudiante", "provisión de gastos" vs German "Maklerprovision").
 *
 * Every rule below was validated against the real corpus; the guard comments
 * cite the concrete false positive each pattern is written to avoid.
 */

import { deaccent } from '@homiio/listing-providers';
import type { IProperty } from '../../models/Property';

/** Classifier output — the schema authority is `IProperty['listingFlags']`. */
export type ListingFlags = NonNullable<IProperty['listingFlags']>;

/** Languages the deterministic detector can distinguish (ISO 639-1). */
type DetectedLanguage = NonNullable<ListingFlags['detectedLanguage']>;

/** Boolean flag keys (everything on `ListingFlags` except `detectedLanguage`). */
type FlagKey = Exclude<keyof ListingFlags, 'detectedLanguage'>;

interface FlagRule {
  readonly flag: FlagKey;
  /** Any trigger match sets the flag… */
  readonly triggers: readonly RegExp[];
  /** …unless a veto matches (used only where a phrase can be explicitly negated). */
  readonly vetoes?: readonly RegExp[];
}

/**
 * `deaccent` already lowercases + strips diacritics + trims; we additionally
 * collapse all whitespace runs to single spaces so multi-token phrases match
 * across line breaks ("no se admiten\nmascotas").
 */
function normalizeText(raw: string): string {
  return deaccent(raw).replace(/\s+/g, ' ');
}

const RULES: readonly FlagRule[] = [
  {
    // studentsOnly — a genuine restriction, NOT mere suitability. Bare
    // "para estudiantes" is deliberately excluded: 47 real listings say
    // "para estudiantes O (jovenes) profesionales/trabajadores/familias"
    // (open to everyone). We require an exclusivity marker (solo / exclusivo
    // para / unicamente / reservado / only) or a dedicated-student-housing
    // noun (residencia de estudiantes / student residence / Studentenwohnheim).
    flag: 'studentsOnly',
    triggers: [
      // ES / CA
      /\b(?:solo|solamente|unicamente|exclusivamente)\s+(?:para\s+)?estudiantes?\b/,
      /\bexclusiv[oa]s?\s+(?:para\s+)?estudiantes?\b/,
      /\breservad[oa]s?\s+(?:a|para)\s+estudiantes?\b/,
      /\bresidencia\s+(?:de\s+estudiantes|universitaria|para\s+estudiantes)\b/,
      /\b(?:nomes|nomes\s+per\s+a|exclusiu\s+per\s+a|reservat\s+a)\s+estudiants?\b/,
      // EN
      /\bstudents?\s+only\b/,
      /\bonly\s+(?:for\s+)?students?\b/,
      /\bstudent\s+(?:residence|accommodation|housing|halls?)\b/,
      // DE
      /\bnur\s+(?:fur\s+)?studenten\b/,
      /\bstudentenwohnheim\b/,
      // IT
      /\bsolo\s+studenti\b/,
      /\b(?:riservato|esclusivamente)\s+(?:a\s+|agli\s+)?studenti\b/,
      // FR
      /\breserve[e]?\s+aux\s+etudiants?\b/,
      /\betudiants?\s+(?:uniquement|seulement)\b/,
      /\buniquement\s+(?:pour\s+|des\s+)?etudiants?\b/,
      /\bresidence\s+etudiante\b/,
      // NL
      /\balleen\s+(?:voor\s+)?studenten\b/,
      /\bstudentenkamer\b/,
      /\bstudentenhuis\b/,
    ],
  },
  {
    // roomNotFullUnit — advertised as a flat/apartment but the body rents a
    // ROOM or a share. High precision required: "el piso son 3 habitaciones"
    // (bedroom COUNT) must NOT match, and "se alquila piso de 3 habitaciones"
    // (whole flat) must NOT match. Achieved via a negative lookahead that
    // blocks a whole-unit noun right after the rent verb, and by never keying
    // off bare "habitacion"/"compartir piso" (110 real "para compartir …" hits
    // describe renting the WHOLE flat to a group).
    flag: 'roomNotFullUnit',
    triggers: [
      // ES: rent-verb directly (or a count/adjective) followed by "habitaci",
      // but never when the first token is a whole-unit noun.
      /\b(?:se\s+alquilan?|alquilo|alquilamos|alquilan)\s+(?!(?:piso|apartamento|departamento|vivienda|casa|chalet|estudio|local|duplex|atico|planta|nave|oficina|plaza|garaje|parking|trastero)\b)(?:\w+\s+){0,2}?habitaci/,
      /\balquiler\s+de\s+habitaci/,
      /\bhabitaci\w*\s+en\s+alquiler\b/,
      /\bpiso\s+compartido\b/,
      /\bhabitaci\w*\s+en\s+(?:un\s+|una\s+)?piso\s+compartid/,
      // CA
      /\bpis\s+compartit\b/,
      /\bllogo?\s+habitaci/,
      // EN
      /\brooms?\s+(?:for\s+rent|to\s+(?:rent|let)|available)\b/,
      /\broom\s+in\s+(?:a\s+|the\s+)?shared\b/,
      /\bshared\s+(?:flat|house|apartment|accommodation)\b/,
      /\b(?:house|flat)\s?share\b/,
      /\bco-?living\b/,
      // DE
      /\bwg-?zimmer\b/,
      /\bzimmer\s+in\s+(?:einer\s+)?(?:wg|wohngemeinschaft)\b/,
      /\bin\s+einer\s+wg\b/,
      /\bwohngemeinschaft\b/,
      // IT
      /\bposto\s+letto\b/,
      /\bstanza\s+(?:singola|doppia|in\s+affitto|in\s+appartamento)\b/,
      /\bappartamento\s+condiviso\b/,
      /\bcamera\s+in\s+appartamento\s+condiviso\b/,
      // FR
      /\bchambre\s+en\s+colocation\b/,
      /\bcolocation\b/,
      /\bchambre\s+dans\s+(?:un\s+)?(?:appartement|coloc)\b/,
      // NL
      /\bkamer\s+(?:te\s+huur|in\s+(?:een\s+)?(?:gedeeld|studentenhuis))\b/,
      /\bgedeeld\s+appartement\b/,
    ],
    // Explicit whole-unit disclaimers ("no se alquila POR habitaciones sueltas",
    // "no se alquilan habitaciones por separado") mean the opposite of a room
    // let — 3 real prod listings that the rent-verb trigger would otherwise trip.
    vetoes: [/\bno\s+se\s+alquilan?\s+(?:por\s+)?habitaci/],
  },
  {
    // temporaryOnly — seasonal/temporary lease, not a permanent home. In Spain
    // "alquiler de temporada" is a legally distinct non-primary-residence lease;
    // "temporada baja/alta" (vacation pricing) and "temporada larga sept-junio"
    // (academic year) are both non-permanent. Guarded against the rare
    // "cuatro/todas las temporadas" (climate/name) even though the corpus had 0.
    flag: 'temporaryOnly',
    triggers: [
      // ES / CA
      /\btemporada\b/,
      /\balquiler\s+temporal\b/,
      /\bcontrato\s+de\s+temporada\b/,
      /\bpor\s+meses\b/,
      /\b(?:corta|media)\s+estancia\b/,
      /\bvacacional\b/,
      // EN
      /\bshort[\s-]?let\b/,
      /\bshort[\s-]?term\s+(?:let|rental|tenancy|stay)\b/,
      /\btemporary\s+(?:let|rental|accommodation|tenancy)\b/,
      /\bholiday\s+(?:let|rental|home)\b/,
      /\bseasonal\s+(?:let|rental)\b/,
      /\bshort\s+stay\b/,
      // DE
      /\bzwischenmiete\b/,
      /\bauf\s+zeit\b/,
      /\bbefristet\w*\b/,
      /\bzeitmietvertrag\b/,
      // IT
      /\btemporaneo\b/,
      /\baffitto\s+breve\b/,
      /\buso\s+transitorio\b/,
      /\btransitorio\b/,
      // FR
      /\blocation\s+saisonniere\b/,
      /\bcourt\s+sejour\b/,
      /\bbail\s+mobilite\b/,
      /\bcourte\s+duree\b/,
      /\bsaisonnier\w*\b/,
      // NL
      /\btijdelijk\w*\b/,
      /\bkort\s+verblijf\b/,
    ],
    vetoes: [/\b(?:cuatro|4|todas\s+las|las\s+cuatro)\s+temporadas?\b/],
  },
  {
    // genderRestricted — one gender only.
    flag: 'genderRestricted',
    triggers: [
      // ES / CA
      /\bsolo\s+(?:para\s+)?(?:chicas?|chicos?|mujeres?|hombres?|femenino|masculino)\b/,
      /\bunicamente\s+(?:chicas?|chicos?|mujeres?|hombres?)\b/,
      /\bsolo\s+(?:noies?|nois?|dones?|homes?)\b/,
      // EN
      /\b(?:women|woman|female|females|ladies|girls?|men|man|male|males|boys?)\s+only\b/,
      /\bonly\s+(?:women|females?|girls?|men|males?)\b/,
      // DE
      /\bnur\s+(?:frauen|manner)\b/,
      // IT
      /\bsolo\s+(?:ragazze|ragazzi|donne|uomini)\b/,
      // FR
      /\b(?:femmes?|hommes?)\s+(?:uniquement|seulement)\b/,
      /\buniquement\s+(?:pour\s+)?(?:femmes?|hommes?)\b/,
      // NL
      /\balleen\s+(?:vrouwen|mannen|dames|meisjes)\b/,
    ],
  },
  {
    // workersOnly / nominaRequired — proof of stable employment/income required,
    // which de-facto excludes students/unemployed. "nomina" (payslip) is the
    // single most reliable ES signal (37/37 real hits were income requirements).
    flag: 'workersOnly',
    triggers: [
      // ES / CA
      /\bsolo\s+(?:para\s+)?trabajadores?\b/,
      /\btrabajadores?\s+con\s+nomina\b/,
      /\bnominas?\b/,
      /\bcontrato\s+de\s+trabajo\b/,
      /\bvida\s+laboral\b/,
      /\bcontrato\s+(?:fijo|indefinido)\b/,
      // EN
      /\bworking\s+professionals?\s+only\b/,
      /\bprofessionals?\s+only\b/,
      /\bworking\s+tenants?\s+only\b/,
      /\bin\s+full[\s-]?time\s+employment\b/,
      /\bproof\s+of\s+(?:income|employment)\b/,
      /\bemployed\s+(?:applicants?|tenants?)\b/,
      // DE
      /\bberufstatig\w*\b/,
      /\beinkommensnachweis\b/,
      /\bgehaltsnachweis\b/,
      // IT
      /\bsolo\s+lavoratori\b/,
      /\bbusta\s+paga\b/,
      /\bcontratto\s+di\s+lavoro\b/,
      // FR
      /\bfiche\s+de\s+paie\b/,
      /\bcontrat\s+de\s+travail\b/,
      /\btravailleurs?\s+(?:uniquement|seulement)\b/,
      /\bjustificatif\s+de\s+revenus?\b/,
      // NL
      /\bloonstrook\b/,
      /\barbeidscontract\b/,
    ],
  },
  {
    // agencyFeePayable — a fee the TENANT/buyer pays to the agency. Conservative
    // on purpose. Two big real-corpus traps are guarded:
    //  1. bare "provision"/"commission" is NEVER a trigger — 59 ES hits were
    //     "provision de gastos/agua/luz" (utility charges) and immoweb had
    //     "european commission" (a landmark) + "monthly commission … heating".
    //     Only agency-scoped forms (maklerprovision, commissione di agenzia,
    //     commission d'agence) count.
    //  2. ES vetoes the explicit "no fee to tenant" statements (22 real hits:
    //     "sin honorarios de agencia para el inquilino", "no se repercute …
    //     honorarios al inquilino", "honorarios incluidos"). Note the veto does
    //     NOT swallow "honorarios NO incluidos en el precio" (fee IS payable).
    flag: 'agencyFeePayable',
    triggers: [
      // ES / CA
      /\bhonorarios\b/,
      /\bgastos\s+de\s+agencia\b/,
      /\bcomision\s+de\s+agencia\b/,
      // EN
      /\bagency\s+fee\b/,
      /\badmin(?:istration)?\s+fee\b/,
      /\b(?:tenancy|letting)\s+fee\b/,
      // DE
      /\bmaklerprovision\b/,
      /\bmakler-?courtage\b/,
      /\bmaklergebuhr\b/,
      // IT
      /\bcommissione\s+(?:di\s+)?agenzia\b/,
      /\bspese\s+di\s+agenzia\b/,
      // FR
      /\bfrais\s+d\s?agence\b/,
      /\bhonoraires\s+(?:d\s?agence|de\s+location)\b/,
      // NL
      /\bmakelaarsloon\b/,
      /\bmakelaarskosten\b/,
    ],
    vetoes: [
      /\bsin\s+honorarios\b/,
      /\bno\s+honorarios\b/,
      /\bhonorarios\s+incluidos\b/,
      /\bsin\s+comision\b/,
      /\bsin\s+gastos\s+de\s+agencia\b/,
      /\bno\s+se\s+repercut\w+[^.]{0,40}\bhonorarios\b/,
      /\bhonorarios\b[^.]{0,40}no\s+se\s+repercut/,
    ],
  },
  {
    // noPets — anchored negatives only, so "se admiten mascotas" (pets ALLOWED,
    // 220 real listings) never matches.
    flag: 'noPets',
    triggers: [
      // ES / CA
      /\bno\s+se\s+(?:admiten|permiten|aceptan)\s+(?:mascotas|animales)\b/,
      /\bno\s+(?:mascotas|animales)\b/,
      /\bsin\s+mascotas\b/,
      /\bprohibid[oa]s?\s+(?:mascotas|animales)\b/,
      /\bno\s+es\s+(?:admeten|accepten)\s+(?:mascotes|animals)\b/,
      /\bsense\s+mascotes\b/,
      // EN
      /\bno\s+pets\b/,
      /\bpets?\s+(?:are\s+)?not\s+(?:allowed|permitted|accepted)\b/,
      /\bno\s+animals\b/,
      // DE
      /\bkeine\s+(?:haus)?tiere\b/,
      /\bhaustiere\s+nicht\s+(?:erlaubt|gestattet)\b/,
      // IT
      /\bno\s+animali\b/,
      /\bnon\s+si\s+accettano\s+animali\b/,
      /\banimali\s+non\s+ammessi\b/,
      // FR
      /\bpas\s+d\s?animaux\b/,
      /\banimaux\s+non\s+(?:admis|acceptes|autorises)\b/,
      // NL
      /\bgeen\s+huisdieren\b/,
      /\bhuisdieren\s+niet\s+toegestaan\b/,
    ],
  },
  {
    // noSmoking — anchored negatives only.
    flag: 'noSmoking',
    triggers: [
      // ES / CA
      /\bno\s+fumadores\b/,
      /\bno\s+se\s+(?:admiten|permite)\s+fumar\b/,
      /\bprohibido\s+fumar\b/,
      /\bno\s+fumar\b/,
      // EN
      /\bnon[\s-]?smok\w*\b/,
      /\bno\s+smoking\b/,
      /\bsmoking\s+not\s+(?:allowed|permitted)\b/,
      // DE
      /\bnichtraucher\w*\b/,
      // IT
      /\bnon\s+fumatori\b/,
      /\bvietato\s+fumare\b/,
      // FR
      /\bnon[\s-]?fumeur\w*\b/,
      /\binterdiction\s+de\s+fumer\b/,
      // NL
      /\bniet\s+roken\b/,
      /\brookvrij\b/,
    ],
  },
  {
    // noCouples — single occupancy / no couples.
    flag: 'noCouples',
    triggers: [
      /\bno\s+(?:se\s+admiten\s+)?parejas\b/,
      /\bno\s+couples\b/,
      /\bcouples?\s+not\s+(?:allowed|accepted|permitted)\b/,
      /\bsingle\s+(?:occupancy|person)\s+only\b/,
    ],
  },
  {
    // noDSS — UK "no housing benefit". Tight patterns so "no benefits included"
    // (no perks) never matches.
    flag: 'noDSS',
    triggers: [
      /\bno\s+dss\b/,
      /\bdss\s+not\s+accepted\b/,
      /\bno\s+housing\s+benefit\b/,
      /\bhousing\s+benefit\s+not\s+accepted\b/,
    ],
  },
];

/**
 * Distinctive stopword/vocabulary tokens per language. Deliberately biased to
 * tokens that separate the confusable pairs (ES↔CA via "amb/aquest/habitatge",
 * ES↔FR/IT via distinct articles) rather than shared ones like "la".
 */
const LANGUAGE_TOKENS: Readonly<Record<DetectedLanguage, readonly string[]>> = {
  es: [
    'el', 'los', 'las', 'con', 'para', 'esta', 'este', 'muy', 'vivienda',
    'dormitorio', 'cocina', 'bano', 'amueblado', 'alquiler', 'zona', 'planta',
  ],
  ca: [
    'amb', 'aquest', 'aquesta', 'aquests', 'aquestes', 'habitatge', 'lloguer',
    'cuina', 'bany', 'situat', 'molt', 'gran', 'planta', 'als', 'pis',
  ],
  en: [
    'the', 'and', 'with', 'this', 'for', 'apartment', 'bedroom', 'kitchen',
    'located', 'available', 'features', 'property', 'very', 'floor',
  ],
  fr: [
    'le', 'les', 'avec', 'pour', 'cette', 'appartement', 'chambre', 'cuisine',
    'situe', 'proche', 'loyer', 'salle', 'sejour', 'tres',
  ],
  nl: [
    'het', 'een', 'met', 'deze', 'voor', 'appartement', 'slaapkamer', 'keuken',
    'gelegen', 'nabij', 'badkamer', 'zeer', 'woning', 'ruime',
  ],
  de: [
    'das', 'die', 'der', 'mit', 'fur', 'diese', 'wohnung', 'schlafzimmer',
    'kuche', 'zimmer', 'gelegen', 'sehr', 'sich', 'grosse',
  ],
  it: [
    'il', 'con', 'per', 'questa', 'appartamento', 'camera', 'cucina', 'situato',
    'vicino', 'molto', 'della', 'soggiorno', 'luminoso', 'piano',
  ],
};

const LANGUAGE_KEYS = Object.keys(LANGUAGE_TOKENS) as DetectedLanguage[];

/**
 * Best-effort deterministic language detection via a bag-of-stopwords vote.
 * Returns `undefined` unless one language both clears a minimum score and beats
 * the runner-up by a clear margin — ambiguous/short text stays unlabeled rather
 * than guessing.
 */
function detectLanguage(normalized: string): DetectedLanguage | undefined {
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length < 12) return undefined;

  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  let best: DetectedLanguage | undefined;
  let bestScore = 0;
  let secondScore = 0;
  for (const lang of LANGUAGE_KEYS) {
    let score = 0;
    for (const word of LANGUAGE_TOKENS[lang]) score += counts.get(word) ?? 0;
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = lang;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (bestScore < 4) return undefined;
  if (bestScore < secondScore * 1.3) return undefined;
  return best;
}

/**
 * Classify a listing's free text into structured restriction/nuance flags.
 * Only flags that fire are present on the result (sparse), plus an optional
 * `detectedLanguage`. Returns an empty object when there is nothing to classify.
 */
export function classifyListingContent(
  description?: string | null,
  title?: string | null,
): ListingFlags {
  const combined = `${title ?? ''} ${description ?? ''}`.trim();
  if (!combined) return {};

  const normalized = normalizeText(combined);
  if (!normalized) return {};

  const flags: ListingFlags = {};
  for (const rule of RULES) {
    if (!rule.triggers.some((re) => re.test(normalized))) continue;
    if (rule.vetoes && rule.vetoes.some((re) => re.test(normalized))) continue;
    flags[rule.flag] = true;
  }

  const detectedLanguage = detectLanguage(normalized);
  if (detectedLanguage) flags.detectedLanguage = detectedLanguage;

  return flags;
}
