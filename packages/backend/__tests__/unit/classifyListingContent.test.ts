/**
 * Free-text listing classifier. Every positive fixture is a (lightly trimmed)
 * REAL description pulled from prod (pisos/fotocasa/habitaclia/immoweb/rightmove,
 * ES/CA/EN/FR/NL) or a canonical phrase for a language the live corpus does not
 * yet cover (DE/IT). Every negative fixture is a real false-positive trap the
 * rules are written to survive.
 */

import { classifyListingContent, type ListingFlags } from '../../services/ingestion/classifyListingContent';

/** True iff the classifier set exactly this one boolean flag (order-independent). */
function flag(text: string): ListingFlags {
  return classifyListingContent(text);
}

describe('classifyListingContent', () => {
  it('returns an empty object for empty / whitespace / nullish input', () => {
    expect(classifyListingContent(undefined)).toEqual({});
    expect(classifyListingContent(null)).toEqual({});
    expect(classifyListingContent('')).toEqual({});
    expect(classifyListingContent('   \n  ')).toEqual({});
  });

  describe('studentsOnly', () => {
    it.each([
      // ES — real prod hits (exclusivity marker present)
      ['se alquila piso exclusivo para estudiantes a 5 minutos de las universidades', 'ES'],
      ['disponible de agosto 2026 solo estudiantes tiene 3 dormitorios', 'ES'],
      ['piso en alquiler en lleida exclusivo para estudiantes se ofrece vivienda amplia', 'ES'],
      ['unicamente estudiantes, curso 2026/2027', 'ES'],
      ['se alquilan habitaciones amuebladas en residencia de estudiantes', 'ES'],
      // EN — immoweb
      ['brand-new student residence with only 12 rooms available', 'EN'],
      ['this flat is for students only, close to campus', 'EN'],
      // DE / IT / FR / NL — canonical
      ['schone wohnung, nur fur studenten in der innenstadt', 'DE'],
      ['appartamento in centro, solo studenti', 'IT'],
      ['bel appartement reserve aux etudiants, proche du campus', 'FR'],
      ['mooi appartement, alleen voor studenten, dicht bij de universiteit', 'NL'],
    ])('flags "%s" (%s)', (text) => {
      expect(flag(text).studentsOnly).toBe(true);
    });

    it.each([
      // Open to multiple audiences — 47 real "para estudiantes O …" listings.
      'perfecto para estudiantes o jovenes profesionales que buscan compartir',
      'ofrece el entorno ideal para estudiantes, profesionales o familias',
      'ideal for students, young professionals, or singles located in the center',
      'especialmente para estudiantes o trabajadores, disponibilidad inmediata',
      // Suitability, not restriction
      'ideal para estudiantes por su cercania a la universidad',
    ])('does NOT flag open/suitability phrasing "%s"', (text) => {
      expect(flag(text).studentsOnly).toBeUndefined();
    });
  });

  describe('roomNotFullUnit', () => {
    it.each([
      // ES / CA — real prod
      ['se alquilan 2 habitaciones en piso compartido, el piso son 3 habitaciones', 'ES'],
      ['se alquilan habitaciones en un apartamento amueblado de 3 dormitorios', 'ES'],
      ['esta habitacion en un piso compartido de 6 habitaciones en el coll', 'ES'],
      ['alquila esta fantastica habitacion en piso compartido en la calle pedroches', 'ES'],
      ['se alquila coqueta habitacion en el centro historico', 'ES'],
      // EN — immoweb
      ['5 rooms for rent in a student apartment located in the center of gembloux', 'EN'],
      ['a bright room in a shared flat near the station', 'EN'],
      ['spacious house share available now, all bills included', 'EN'],
      // DE / IT / FR / NL — canonical
      ['helles wg-zimmer in einer 3er wohngemeinschaft zu vermieten', 'DE'],
      ['posto letto in stanza doppia, appartamento condiviso vicino al centro', 'IT'],
      ['chambre en colocation dans un bel appartement renove', 'FR'],
      ['kamer te huur in een gedeeld appartement in het centrum', 'NL'],
    ])('flags "%s" (%s)', (text) => {
      expect(flag(text).roomNotFullUnit).toBe(true);
    });

    it.each([
      // Whole flat rented (bedroom COUNT, not a room let)
      'se alquila amplio piso con 4 habitaciones y 2 banos totalmente reformado',
      'se alquila estupendo piso de 3 habitaciones con ascensor',
      'el piso tiene 3 habitaciones, una de ellas tipo suite',
      // "para compartir" = whole flat marketed as shareable — 110 real hits
      'piso perfecto para compartir con tus companeros de estudio o trabajo',
      'amigos que quieran compartir piso y disfrutar de un barrio con servicios',
      'oportunidad perfecta para compartir piso con amigos',
      // Explicit whole-unit disclaimers — 3 real prod listings (the OPPOSITE of
      // a room let); the negated rent-verb must be vetoed.
      'se integra a un grupo cerrado, no se alquila por habitaciones sueltas',
      'contrato universitario, maximo once meses. no se alquila por habitaciones, sino de forma completa',
      'solo estudiantes. no se alquilan habitaciones por separado.',
    ])('does NOT flag whole-flat / share-suitable phrasing "%s"', (text) => {
      expect(flag(text).roomNotFullUnit).toBeUndefined();
    });
  });

  describe('temporaryOnly', () => {
    it.each([
      // ES — real prod
      ['alquiler de temporada fantastico apartamento en primera linea', 'ES'],
      ['se alquila temporada de septiembre a junio, curso academico', 'ES'],
      ['alquiler temporal: casita de pescadores para los meses de verano', 'ES'],
      ['apartamento vacacional, disponible por meses', 'ES'],
      // EN
      ['stylish short let apartment, minimum one month stay', 'EN'],
      ['holiday let in the city centre, fully serviced', 'EN'],
      // DE / IT / FR / NL — canonical
      ['moblierte wohnung auf zeit, zwischenmiete bis august', 'DE'],
      ['affitto breve, contratto temporaneo uso transitorio', 'IT'],
      ['location saisonniere, bail mobilite de trois mois', 'FR'],
      ['tijdelijk appartement voor kort verblijf in het centrum', 'NL'],
    ])('flags "%s" (%s)', (text) => {
      expect(flag(text).temporaryOnly).toBe(true);
    });

    it.each([
      // Permanent lease, no seasonal wording
      'alquiler de larga duracion, vivienda habitual reformada con ascensor',
      'piso disponible todo el ano para residencia habitual',
      // Guarded: "cuatro/todas las temporadas" (climate / name), not a lease term
      'aire acondicionado frio calor para todas las temporadas del ano',
      'urbanizacion las cuatro temporadas con piscina comunitaria',
    ])('does NOT flag permanent / guarded phrasing "%s"', (text) => {
      expect(flag(text).temporaryOnly).toBeUndefined();
    });
  });

  describe('genderRestricted', () => {
    it.each([
      ['quedan dos habitaciones, solo chicas, no llegues tarde', 'ES'],
      ['habitaciones para estudiantes solo chicas zona pardaleras', 'ES'],
      ['solo chicos trabajadores, ambiente tranquilo', 'ES'],
      ['double room in a house share, women only please', 'EN'],
      ['schones zimmer, nur frauen', 'DE'],
      ['stanza luminosa, solo ragazze', 'IT'],
      ['chambre agreable, femmes uniquement', 'FR'],
    ])('flags "%s" (%s)', (text) => {
      expect(flag(text).genderRestricted).toBe(true);
    });

    it.each([
      'piso ideal para chicas y chicos que quieran compartir',
      'apartamento para dos personas en el centro',
      'habitacion para una sola persona con bano privado',
    ])('does NOT flag non-restrictive phrasing "%s"', (text) => {
      expect(flag(text).genderRestricted).toBeUndefined();
    });
  });

  describe('workersOnly', () => {
    it.each([
      ['importante ser trabajador con nomina, se pide solvencia', 'ES'],
      ['ingresos demostrables mediante nomina y contrato de trabajo', 'ES'],
      ['solo trabajadores con contrato indefinido', 'ES'],
      ['requerimos ultima nomina y vida laboral', 'ES'],
      ['working professionals only, references required', 'EN'],
      ['proof of income and employment required', 'EN'],
      ['nur fur berufstatige, einkommensnachweis erforderlich', 'DE'],
      ['solo lavoratori con busta paga', 'IT'],
      ['fiche de paie et contrat de travail exiges', 'FR'],
    ])('flags "%s" (%s)', (text) => {
      expect(flag(text).workersOnly).toBe(true);
    });

    it.each([
      'piso luminoso reformado con cocina nueva y armarios empotrados',
      'apartment with a modern kitchen and two bedrooms',
    ])('does NOT flag listings without an employment/income requirement "%s"', (text) => {
      expect(flag(text).workersOnly).toBeUndefined();
    });
  });

  describe('agencyFeePayable', () => {
    it.each([
      ['honorarios no incluidos en el precio, se pagan aparte', 'ES'],
      ['nuestros honorarios son de una mensualidad', 'ES'],
      ['fianza de dos meses y un mes de honorarios de agencia', 'ES'],
      ['contact us for a viewing, agency fee applies', 'EN'],
      ['zzgl. maklerprovision von einer monatsmiete', 'DE'],
      ['richiesta commissione di agenzia pari a una mensilita', 'IT'],
      ['loyer 800 euros plus frais d agence a charge du locataire', 'FR'],
    ])('flags "%s" (%s)', (text) => {
      expect(flag(text).agencyFeePayable).toBe(true);
    });

    it.each([
      // "no fee to tenant" — 22 real vetoed hits
      'alquiler de vivienda habitual, sin honorarios de agencia para el inquilino',
      'no se repercute ningun tipo de honorarios al inquilino',
      'honorarios incluidos, sin gastos adicionales',
      // "provision" = utility charges, NOT a Maklerprovision — 59 real hits
      'provision de 150 euros por calefaccion, agua y luz',
      '150 euros de provision mensual de agua, luz y gas',
      // bare "commission" is a landmark / a monthly charge, never a trigger
      'the european commission is 4 km away from the apartment',
      'monthly commission 175 euro per month including heating and water',
    ])('does NOT flag vetoed / non-agency phrasing "%s"', (text) => {
      expect(flag(text).agencyFeePayable).toBeUndefined();
    });
  });

  describe('noPets', () => {
    it.each([
      ['con ascensor, no se admiten mascotas y se pide solvencia', 'ES'],
      ['comunidad incluida. no animales.', 'ES'],
      ['bright apartment, sorry no pets', 'EN'],
      ['schone wohnung, keine haustiere', 'DE'],
      ['appartamento arredato, animali non ammessi', 'IT'],
      ['bel appartement, pas d animaux', 'FR'],
      ['ruim appartement, geen huisdieren', 'NL'],
    ])('flags "%s" (%s)', (text) => {
      expect(flag(text).noPets).toBe(true);
    });

    it.each([
      // Pets ALLOWED — 220 real listings say this; must never flag
      'apartamento amplio, se admiten mascotas sin problema',
      'pet friendly building, pets are welcome',
      'zona tranquila con parque para pasear a tu mascota',
    ])('does NOT flag pet-friendly phrasing "%s"', (text) => {
      expect(flag(text).noPets).toBeUndefined();
    });
  });

  describe('noSmoking', () => {
    it.each([
      ['personas cuidadosas, no fumadores', 'ES'],
      ['this apartment is allergy-free and non-smoking', 'EN'],
      ['gemutliche wohnung fur nichtraucher', 'DE'],
      ['appartamento per non fumatori', 'IT'],
    ])('flags "%s" (%s)', (text) => {
      expect(flag(text).noSmoking).toBe(true);
    });

    it('does NOT flag a listing that merely mentions a terrace', () => {
      expect(flag('gran terraza exterior donde disfrutar del sol').noSmoking).toBeUndefined();
    });
  });

  describe('noCouples', () => {
    it.each([
      ['sorry but no couples/room shares or pets', 'EN'],
      ['habitacion individual, no parejas', 'ES'],
      ['single occupancy only, quiet professional preferred', 'EN'],
    ])('flags "%s" (%s)', (text) => {
      expect(flag(text).noCouples).toBe(true);
    });

    it('does NOT flag a listing ideal for couples', () => {
      expect(flag('acogedor apartamento ideal para parejas').noCouples).toBeUndefined();
    });
  });

  describe('noDSS', () => {
    it.each([
      ['professional tenants only, no dss', 'EN'],
      ['sorry, no housing benefit accepted', 'EN'],
    ])('flags "%s" (%s)', (text) => {
      expect(flag(text).noDSS).toBe(true);
    });

    it('does NOT flag "great benefits nearby"', () => {
      expect(flag('lots of great benefits nearby including shops and transport').noDSS).toBeUndefined();
    });
  });

  describe('combinations, accents and title', () => {
    it('sets multiple flags from one description', () => {
      const flags = flag(
        'se alquilan habitaciones en piso compartido, exclusivamente para estudiantes, solo chicas. no se admiten mascotas.',
      );
      expect(flags.roomNotFullUnit).toBe(true);
      expect(flags.studentsOnly).toBe(true);
      expect(flags.genderRestricted).toBe(true);
      expect(flags.noPets).toBe(true);
    });

    it('matches regardless of accents / casing / line breaks', () => {
      const flags = classifyListingContent('No se ADMITEN\nMáscotas.\nSólo estudiantes.');
      expect(flags.noPets).toBe(true);
      expect(flags.studentsOnly).toBe(true);
    });

    it('also reads the optional title argument', () => {
      const flags = classifyListingContent('bright and modern', 'Room for rent in shared flat');
      expect(flags.roomNotFullUnit).toBe(true);
    });
  });

  describe('detectedLanguage', () => {
    it.each([
      [
        'es',
        'se alquila esta preciosa vivienda con dos dormitorios, cocina amueblada y bano completo en una zona muy tranquila cerca del centro comercial',
      ],
      [
        'en',
        'this bright apartment features two bedrooms and a modern kitchen, located very close to the station with all the amenities the property offers',
      ],
      [
        'fr',
        'ce bel appartement avec deux chambres et une cuisine equipee est situe tres proche du centre, la salle de bain est renovee et le loyer est raisonnable',
      ],
      [
        'nl',
        'dit ruime appartement met twee slaapkamers en een keuken is zeer gunstig gelegen nabij het centrum, de woning heeft ook een mooie badkamer',
      ],
      [
        'de',
        'diese schone wohnung mit zwei schlafzimmern und einer kuche liegt sehr zentral gelegen, das zimmer ist hell und die grosse terrasse gehort dazu',
      ],
      [
        'it',
        'questa luminosa appartamento con camera e cucina si trova molto vicino al centro, il soggiorno e ampio e della zona molto tranquilla al piano terra',
      ],
      [
        'ca',
        'aquest habitatge amb dues habitacions i cuina equipada esta situat molt a prop del centre, el pis es gran i lloguer amb bany reformat als afores',
      ],
    ])('detects %s', (lang, text) => {
      expect(classifyListingContent(text).detectedLanguage).toBe(lang);
    });

    it('leaves short / ambiguous text unlabeled', () => {
      expect(classifyListingContent('piso centro').detectedLanguage).toBeUndefined();
      expect(classifyListingContent('123 456 789 000 111 222 333 444 555 666 777').detectedLanguage).toBeUndefined();
    });
  });
});
