/**
 * Recorded Immowelt fixtures (portal-shaped, hand-authored).
 *
 * Models the LZ-decompressed `classified-serp-init-data` card JSON and a
 * detail-shaped payload so parse → normalize can run without the live portal.
 */

export const IMMOWELT_BASE_URL = 'https://www.immowelt.de';

/** One search-card object as found in `pageProps.classifiedsData`. */
export const IMMOWELT_FIXTURE_CARD_JSON = `{
  "brand": "immowelt",
  "id": "TESTQHMKVQH6",
  "status": "Published",
  "metadata": {
    "id": "TESTQHMKVQH6",
    "legacyId": "311aaa07-ac4a-477e-ba23-bb35a3754385"
  },
  "location": {
    "address": {
      "country": "DEU",
      "city": "Berlin",
      "zipCode": "13587",
      "street": "Am Maselakepark 8",
      "district": "Spandau"
    },
    "isAddressPublished": true
  },
  "hardFacts": {
    "title": "Wohnung zur Miete - Erstbezug",
    "facts": [
      { "type": "numberOfRooms", "splitValue": "3", "label": "Zimmer" },
      { "type": "livingSpace", "splitValue": "75,4", "label": "m²" },
      { "type": "numberOfFloors", "splitValue": "1", "label": "Geschoss" }
    ],
    "price": {
      "value": "1.659 €",
      "formatted": "1.659 €",
      "additionalInformation": "Kaltmiete",
      "ariaLabel": "1659 €"
    }
  },
  "gallery": {
    "images": [
      {
        "url": "https://mms.immowelt.de/f/1/5/3/f153efdc-example.jpg",
        "description": "Aussenansicht"
      },
      {
        "url": "https://mms.immowelt.de/a/2/3/4/abcd1234-example.jpg",
        "description": "Wohnzimmer"
      }
    ]
  },
  "provider": {
    "intermediaryCard": { "title": "Stuck Immobilien Consult UG" },
    "contactCard": { "title": "Frau Agnieszka Stuck" },
    "isPrivateOwner": false,
    "publisherType": "AGENCY",
    "phoneNumbers": ["+49301234567"],
    "email": "kontakt@example-immowelt.de"
  },
  "mainDescription": "Moderne 3-Zimmer-Wohnung in Spandau mit Balkon.",
  "tracking": {
    "price": 1659,
    "currency": "EUR",
    "distribution_type": "1",
    "estate_type": "av_2",
    "city": "Berlin",
    "zip_code": "13587",
    "legacy_id": "311aaa07-ac4a-477e-ba23-bb35a3754385"
  },
  "url": "/expose/311aaa07-ac4a-477e-ba23-bb35a3754385",
  "type": "APARTMENT"
}`;

/** Minimal search HTML wrapping a pre-decompressed card list for unit tests. */
export const IMMOWELT_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="de"><body>
<a href="https://www.immowelt.de/expose/311aaa07-ac4a-477e-ba23-bb35a3754385">Listing</a>
<a href="https://www.immowelt.de/expose/37ced42c-3552-487c-b121-5df282095fa4">Listing 2</a>
<script>
window["__UFRN_FETCHER__"]=JSON.parse("{\\"data\\":{\\"classified-serp-init-data\\":\\"PLACEHOLDER\\"}}");
</script>
</body></html>`;

/**
 * Real detail `classified` payload captured from a live immowelt `/expose` page
 * (Sommerhausen apartment for sale — published address, `Point` coordinates,
 * agency `contactSections`). Source
 * `https://www.immowelt.de/expose/00b915d7-1122-40d0-a68d-916854f75987`, captured
 * 2026-02. Pruned to the `sections` the detail parser reads; every value is
 * verbatim from the live SSR `__UFRN_LIFECYCLE_SERVERREQUEST__` → `app_cldp.data.classified`.
 */
export const IMMOWELT_FIXTURE_DETAIL_CLASSIFIED_JSON = `{
  "brand": "immowelt",
  "id": "26J3FH6EXPSN",
  "metadata": { "legacyId": "00b915d7-1122-40d0-a68d-916854f75987" },
  "tracking": {
    "av_items": [
      {
        "id": "26J3FH6EXPSN",
        "price": 499000,
        "estate_type": "av_2",
        "distribution_type": "2",
        "country": "Germany",
        "city": "Sommerhausen",
        "region": "Bavaria",
        "currency": "EUR",
        "zip_code": "97286",
        "legacy_id": "00b915d7-1122-40d0-a68d-916854f75987"
      }
    ]
  },
  "sections": {
    "location": {
      "address": {
        "country": "DEU",
        "city": "Sommerhausen",
        "zipCode": "97286",
        "street": "Ochsenfurter Straße 10"
      },
      "isAddressPublished": true,
      "geometry": {
        "type": "Point",
        "coordinates": [10.024897575378418, 49.70295715332031]
      }
    },
    "price": {
      "base": {
        "type": "SALE",
        "main": { "value": { "main": { "value": "499.000 €", "ariaLabel": "499000 €" } } }
      }
    },
    "hardFacts": {
      "title": "Wohnung zum Kauf",
      "facts": [
        { "type": "numberOfRooms", "value": "3 Zimmer", "splitValue": "3", "label": "Zimmer" },
        { "type": "livingSpace", "value": "79,8 m²", "splitValue": "79,8", "label": "m²" },
        { "type": "availability", "value": "frei ab 31.10.2027", "splitValue": "frei", "label": "ab 31.10.2027" }
      ],
      "price": { "ariaLabel": "499000 €" }
    },
    "gallery": {
      "images": [
        { "url": "https://mms.immowelt.de/f/8/4/f/f84f9760-d2d3-451b-bb40-527bec0ed50a.png?ci_seal=4b3dd8a592410d8af24b74c446954c7f531a5045" },
        { "url": "https://mms.immowelt.de/6/5/a/f/65afb998-877b-46ef-9d26-70ce7032c4ce.png?ci_seal=cdcee6465a473b0e760806ea26613fa71673e426" }
      ]
    },
    "mainDescription": {
      "headline": "Zwischen Main und Wein - Wohnen und Leben in Sommerhausen",
      "description": "Auf dem optimal geschnittenen und nach Süden ausgerichteten Grundstück entsteht ein Haus mit 11 Wohnungen im besonders nachhaltigen und förderfähigen „Effizienzhaus 40“ Standard der Kreditanstalt für Wiederaufbau."
    }
  },
  "contactSections": {
    "static": { "phoneNumbers": ["0931-35901968", "01637848779"] },
    "contactCard": {
      "title": "Spanheimer Wohnbau GmbH",
      "subtitle": "Herr Ralf Spanheimer",
      "phoneNumbers": ["0931-35901968", "01637848779"],
      "isPrivateOwner": false
    },
    "provider": {
      "intermediaryCard": { "title": "Spanheimer Wohnbau GmbH" },
      "contactCard": { "title": "Herr Ralf Spanheimer" },
      "isPrivateOwner": false,
      "publisherType": "AGENCY"
    }
  }
}`;

/**
 * Address-hidden real variant (Chamerau plot). `isAddressPublished:false`, no
 * street, and a `MultiPolygon` district boundary instead of a `Point` — proves
 * coords are skipped when the portal exposes no exact point. Source
 * `https://www.immowelt.de/expose/0006bab0-7f77-4be5-b15f-fefc5a01ec6b`.
 */
export const IMMOWELT_FIXTURE_DETAIL_HIDDEN_CLASSIFIED_JSON = `{
  "metadata": { "legacyId": "0006bab0-7f77-4be5-b15f-fefc5a01ec6b" },
  "tracking": {
    "av_items": [
      {
        "id": "248QVVHQQZGG",
        "price": 363000,
        "estate_type": "av_9",
        "distribution_type": "2",
        "city": "Chamerau",
        "region": "Bavaria",
        "currency": "EUR",
        "zip_code": "93466"
      }
    ]
  },
  "sections": {
    "location": {
      "address": { "country": "DEU", "city": "Chamerau", "zipCode": "93466" },
      "isAddressPublished": false,
      "geometry": { "type": "MultiPolygon", "coordinates": [[12.74011, 49.20713], [12.72537, 49.20116]] }
    },
    "price": { "base": { "type": "SALE" } },
    "hardFacts": {
      "title": "Grundstück zum Kauf",
      "facts": [
        { "type": "plotSpace", "value": "3.823 m² Grundstück", "splitValue": "3.823", "label": "m² Grundstück" }
      ]
    },
    "gallery": {
      "images": [
        { "url": "https://mms.immowelt.de/1/3/e/0/13e02204-f7cf-49ec-9207-50ff6fd905cb.jpg?ci_seal=d86df0a77b90651040b04458de012ddc647cc6ba" }
      ]
    },
    "mainDescription": { "headline": "Gewerbegrundstück in Top Lage sofort Verfügbar" }
  }
}`;

/**
 * Real detail `classified` payload captured from a live immowelt `/expose` page
 * (Fürth apartment FOR RENT — published address, `Point` coords, agency contact).
 * Source `https://www.immowelt.de/expose/00827e82-d512-4043-a489-249a44268293`,
 * captured 2025-12. Every value under `sections`/`contactSections` is verbatim
 * from the live SSR `__UFRN_LIFECYCLE_SERVERREQUEST__` → `app_cldp.data.classified`;
 * the gallery is trimmed to the first four of the listing's 13 photos. This
 * exercises the fields the old parser dropped: the real `sections.gallery.images`
 * URLs, `sections.energy.features` (`yearOfConstruction`), and the
 * `sections.features` amenity/flag rows.
 */
export const IMMOWELT_FIXTURE_DETAIL_RENTAL_CLASSIFIED_JSON = `{
  "brand": "immowelt",
  "id": "23WN8BJNR3PG",
  "metadata": { "legacyId": "00827e82-d512-4043-a489-249a44268293" },
  "tracking": {
    "av_items": [
      {
        "id": "23WN8BJNR3PG",
        "price": 930,
        "estate_type": "av_2",
        "distribution_type": "1",
        "country": "Germany",
        "city": "Fürth",
        "region": "Bavaria",
        "currency": "EUR",
        "zip_code": "90766",
        "legacy_id": "00827e82-d512-4043-a489-249a44268293"
      }
    ]
  },
  "sections": {
    "location": {
      "address": {
        "country": "DEU",
        "city": "Fürth",
        "zipCode": "90766",
        "street": "Würzburger Straße 25",
        "district": "Weststadt"
      },
      "isAddressPublished": true,
      "geometry": { "type": "Point", "coordinates": [10.97590160369873, 49.47981643676758] }
    },
    "price": {
      "base": {
        "type": "RENT",
        "main": { "value": { "main": { "value": "930 €", "ariaLabel": "930 €" } } }
      }
    },
    "hardFacts": {
      "title": "Wohnung zur Miete",
      "facts": [
        { "type": "numberOfRooms", "value": "2 Zimmer", "splitValue": "2", "label": "Zimmer" },
        { "type": "livingSpace", "value": "64,2 m²", "splitValue": "64,2", "label": "m²" },
        { "type": "numberOfFloors", "value": "1. Geschoss", "splitValue": "1.", "label": "Geschoss" }
      ],
      "price": { "ariaLabel": "930 €" }
    },
    "energy": {
      "features": [
        { "type": "yearOfConstruction", "label": "Baujahr", "value": "2019" },
        { "type": "state", "label": "Zustand der Immobilie", "value": "Neubau" },
        { "type": "heatingSystem", "label": "Heizungsart", "value": "Zentralheizung: Fußbodenheizung" },
        { "type": "energySource", "label": "Energieträger", "value": "Gas" }
      ]
    },
    "gallery": {
      "images": [
        { "key": "5664600d-8ada-437d-8880-d78f63c1077a", "url": "https://mms.immowelt.de/5/6/6/4/5664600d-8ada-437d-8880-d78f63c1077a.jpg?ci_seal=66a168730412798957ffcd4d9772400c4580059f" },
        { "key": "aad95f0d-6c7c-458a-9174-32d80d465dad", "url": "https://mms.immowelt.de/a/a/d/9/aad95f0d-6c7c-458a-9174-32d80d465dad.jpg?ci_seal=aee57f775534d372d06fa6b120169f0834bbdeb6" },
        { "key": "70127c38-3493-46d7-b98a-36d3b60ac65e", "url": "https://mms.immowelt.de/7/0/1/2/70127c38-3493-46d7-b98a-36d3b60ac65e.png?ci_seal=f8c3d36e59d5abf952cf39b8a42f05bc1b3e26c9" },
        { "key": "fd6cbc13-d959-4fb4-ab32-bba863b93034", "url": "https://mms.immowelt.de/f/d/6/c/fd6cbc13-d959-4fb4-ab32-bba863b93034.png?ci_seal=0cf7e4be5e4049756dbe9107d36219ba306dfe72" }
      ]
    },
    "features": {
      "preview": [
        { "icon": "availability", "value": "Bezug: ab 01.02.2026 " },
        { "icon": "floors", "value": "1. Geschoss" },
        { "icon": "kitchen", "value": "Einbauküche, offene Küche" },
        { "icon": "elevator", "value": "Personenaufzug" },
        { "icon": "cellar", "value": "Kelleranteil" },
        { "icon": "parking-lots", "value": "Tiefgarage" },
        { "icon": "toilet-amenities", "value": "Gäste-WC" },
        { "icon": "balcony", "value": "Balkon" }
      ],
      "details": {
        "categories": [
          {
            "title": "Allgemeine Informationen",
            "elements": [
              { "icon": "availability", "value": "Bezug: ab 01.02.2026 " },
              { "icon": "floors", "value": "1. Geschoss" }
            ]
          },
          {
            "title": "Barrierefreiheit",
            "elements": [ { "icon": "elevator", "value": "Personenaufzug" } ]
          },
          {
            "title": "Innenbereich",
            "elements": [
              { "icon": "kitchen", "value": "Einbauküche, offene Küche" },
              { "icon": "bathroom-amenities", "value": "Badezimmer: Badewanne, Bad mit Dusche" },
              { "icon": "toilet-amenities", "value": "Gäste-WC" },
              { "icon": "cellar", "value": "Kelleranteil" },
              { "icon": "floor-covering", "value": "Bodenbelag: Fliesen" }
            ]
          },
          {
            "title": "Außenbereich",
            "elements": [
              { "icon": "balcony", "value": "Balkon" },
              { "icon": "parking-lots", "value": "Tiefgarage" }
            ]
          }
        ]
      }
    },
    "mainDescription": { "headline": "2-Zi.-Whg mit Einbauküche" }
  },
  "contactSections": {
    "static": { "phoneNumbers": ["0911 93425 738"] },
    "contactCard": {
      "title": "Schultheiß Projektentwicklung AG",
      "subtitle": "Herr Matteo Mölders",
      "phoneNumbers": ["0911 93425 738"],
      "isPrivateOwner": false
    },
    "provider": {
      "intermediaryCard": { "title": "Schultheiß Projektentwicklung AG" },
      "contactCard": { "title": "Herr Matteo Mölders" },
      "isPrivateOwner": false,
      "publisherType": "AGENCY"
    }
  }
}`;

/**
 * Wrap a captured `classified` payload in the exact on-page SSR form immowelt
 * serves detail data in: a `window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse("…")`
 * script whose argument is the double-encoded blob (`JSON.stringify` twice — the
 * inner JSON string, then string-escaped for the JS literal). A preceding
 * `__UFRN_FETCHER__` `JSON.parse(...)` script mirrors the live page so the
 * extractor must target the lifecycle key rather than the first blob.
 */
function immoweltDetailFixtureHtml(classifiedJson: string): string {
  const lifecycle = { app_cldp: { data: { classified: JSON.parse(classifiedJson) as unknown } } };
  const scriptArg = JSON.stringify(JSON.stringify(lifecycle));
  return (
    '<!doctype html><html lang="de"><head><title>immowelt.de</title></head><body>' +
    '<script>window["__UFRN_FETCHER__"]=JSON.parse("{\\"data\\":{},\\"errors\\":{}}");</script>' +
    '<script id="__UFRN_LIFECYCLE_SERVERREQUEST__">' +
    `window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse(${scriptArg});</script>` +
    '</body></html>'
  );
}

/** Detail HTML for the published-address Sommerhausen listing (Point coords). */
export const IMMOWELT_FIXTURE_DETAIL_HTML = immoweltDetailFixtureHtml(
  IMMOWELT_FIXTURE_DETAIL_CLASSIFIED_JSON,
);

/** Detail HTML for the address-hidden Chamerau plot (MultiPolygon, no coords). */
export const IMMOWELT_FIXTURE_DETAIL_HIDDEN_HTML = immoweltDetailFixtureHtml(
  IMMOWELT_FIXTURE_DETAIL_HIDDEN_CLASSIFIED_JSON,
);

/** Detail HTML for the Fürth rental (real gallery, amenities, `yearOfConstruction`). */
export const IMMOWELT_FIXTURE_DETAIL_RENTAL_HTML = immoweltDetailFixtureHtml(
  IMMOWELT_FIXTURE_DETAIL_RENTAL_CLASSIFIED_JSON,
);

/** Canonical `/expose/{uuid}` URL of the published-address detail fixture. */
export const IMMOWELT_FIXTURE_DETAIL_URL =
  'https://www.immowelt.de/expose/00b915d7-1122-40d0-a68d-916854f75987';

/** Canonical `/expose/{uuid}` URL of the Fürth rental detail fixture. */
export const IMMOWELT_FIXTURE_DETAIL_RENTAL_URL =
  'https://www.immowelt.de/expose/00827e82-d512-4043-a489-249a44268293';
