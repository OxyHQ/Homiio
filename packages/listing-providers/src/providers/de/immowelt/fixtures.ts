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
