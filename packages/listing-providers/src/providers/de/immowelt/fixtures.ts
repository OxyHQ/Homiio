/** Immowelt fixtures — SERP card JSON shape (hand-authored). */
export const IMMOWELT_BASE_URL = 'https://www.immowelt.de';

export const IMMOWELT_FIXTURE_CARD_JSON = `{
  "brand": "immowelt",
  "id": "TESTQHMKVQH6",
  "metadata": { "id": "TESTQHMKVQH6", "legacyId": "311aaa07-ac4a-477e-ba23-bb35a3754385" },
  "location": {
    "address": {
      "country": "DEU", "city": "Berlin", "zipCode": "13587",
      "street": "Am Maselakepark 8", "district": "Spandau"
    }
  },
  "hardFacts": {
    "title": "Wohnung zur Miete - Erstbezug",
    "facts": [
      { "type": "numberOfRooms", "splitValue": "3" },
      { "type": "livingSpace", "splitValue": "75,4" },
      { "type": "numberOfFloors", "splitValue": "1" }
    ],
    "price": { "formatted": "1.659 €", "ariaLabel": "1659 €" }
  },
  "gallery": { "images": [
    { "url": "https://mms.immowelt.de/f/1/5/3/example1.jpg" },
    { "url": "https://mms.immowelt.de/a/2/3/4/example2.jpg" }
  ]},
  "provider": {
    "intermediaryCard": { "title": "Stuck Immobilien Consult UG" },
    "contactCard": { "title": "Frau Agnieszka Stuck" },
    "isPrivateOwner": false,
    "publisherType": "AGENCY",
    "phoneNumbers": ["+49301234567"],
    "email": "kontakt@example-immowelt.de"
  },
  "mainDescription": "Moderne 3-Zimmer-Wohnung in Spandau mit Balkon.",
  "tracking": { "price": 1659, "currency": "EUR", "distribution_type": "1", "city": "Berlin", "zip_code": "13587", "legacy_id": "311aaa07-ac4a-477e-ba23-bb35a3754385" },
  "url": "/expose/311aaa07-ac4a-477e-ba23-bb35a3754385",
  "type": "APARTMENT"
}`;

export const IMMOWELT_FIXTURE_SEARCH_HTML = `<!doctype html><html lang="de"><body>
<a href="https://www.immowelt.de/expose/311aaa07-ac4a-477e-ba23-bb35a3754385">A</a>
<a href="https://www.immowelt.de/expose/37ced42c-3552-487c-b121-5df282095fa4">B</a>
</body></html>`;
