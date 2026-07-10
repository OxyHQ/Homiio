/** Recorded ImmobilienScout24 fixtures (portal-shaped, hand-authored). */
export const IMMOBILIENSCOUT24_BASE_URL = 'https://www.immobilienscout24.de';
export const IMMOBILIENSCOUT24_MOBILE_API = 'https://api.mobile.immobilienscout24.de';

export const IS24_FIXTURE_SEARCH_JSON = `{
  "totalResults": 2,
  "resultListItems": [
    { "type": "EXPOSE_RESULT", "item": { "id": "160012345", "title": "Helle 2-Zimmer", "realEstateType": "apartmentrent" } },
    { "type": "EXPOSE_RESULT", "item": { "id": "160067890", "title": "Dachgeschoss", "realEstateType": "apartmentrent" } }
  ]
}`;

export const IS24_FIXTURE_EXPOSE_JSON = `{
  "header": { "id": "160012345", "title": "Helle 2-Zimmer-Wohnung in Mitte", "realEstateType": "apartmentrent" },
  "sections": [
    { "type": "MEDIA", "media": [
      { "type": "PICTURE", "fullImageUrl": "https://pictures.immobilienscout24.de/listings/aa/bb/1.jpg/ORIG/resize/1500x1000/format/webp/quality/80" },
      { "type": "PICTURE", "fullImageUrl": "https://pictures.immobilienscout24.de/listings/aa/bb/2.jpg/ORIG/resize/1500x1000/format/webp/quality/80" }
    ]},
    { "type": "TOP_ATTRIBUTES", "attributes": [
      { "label": "Kaltmiete", "text": "1.250 €", "type": "TEXT" },
      { "label": "Zimmer", "text": "2", "type": "TEXT" },
      { "label": "Wohnfläche", "text": "65 m²", "type": "TEXT" }
    ]},
    { "type": "TITLE", "title": "Helle 2-Zimmer-Wohnung in Mitte" },
    { "type": "MAP", "location": { "lat": 52.531, "lng": 13.401 }, "addressLine1": "Torstrasse 1", "addressLine2": "10119 Mitte, Berlin" },
    { "type": "DESCRIPTION", "text": "Lichtdurchflutete Wohnung mit Balkon in Berlin-Mitte." }
  ],
  "contact": {
    "phoneNumbers": [{ "phoneNumber": "+493012345678" }],
    "contactData": { "agent": { "name": "Anna Schmidt", "company": "Mitte Homes GmbH" } }
  }
}`;
