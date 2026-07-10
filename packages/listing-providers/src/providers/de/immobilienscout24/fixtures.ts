/**
 * Recorded ImmobilienScout24 fixtures (portal-shaped, hand-authored).
 *
 * Models the mobile API search-list + expose JSON used by the provider so
 * parse → normalize can be tested without hitting api.mobile.immobilienscout24.de.
 */

export const IMMOBILIENSCOUT24_BASE_URL = 'https://www.immobilienscout24.de';
export const IMMOBILIENSCOUT24_MOBILE_API = 'https://api.mobile.immobilienscout24.de';

/** Search-list page 1 fragment with two apartment-rent hits. */
export const IS24_FIXTURE_SEARCH_JSON = `{
  "totalResults": 2,
  "pageSize": 50,
  "pageNumber": 1,
  "numberOfPages": 1,
  "numberOfListings": 2,
  "resultListItems": [
    {
      "type": "EXPOSE_RESULT",
      "item": {
        "id": "160012345",
        "title": "Helle 2-Zimmer-Wohnung in Mitte",
        "realEstateType": "apartmentrent",
        "address": {
          "line": "Torstrasse 1, 10119 Berlin, Mitte",
          "lat": 52.531,
          "lon": 13.401
        },
        "attributes": [
          { "label": "Kaltmiete", "value": "1.250 €" },
          { "label": "Zimmer", "value": "2" },
          { "label": "Wohnfläche", "value": "65 m²" }
        ],
        "realtor": { "companyName": "Mitte Homes GmbH" },
        "isPrivate": false
      }
    },
    {
      "type": "EXPOSE_RESULT",
      "item": {
        "id": "160067890",
        "title": "Dachgeschoss mit Balkon",
        "realEstateType": "apartmentrent",
        "address": {
          "line": "Kastanienallee 10, 10435 Berlin, Prenzlauer Berg",
          "lat": 52.54,
          "lon": 13.41
        },
        "attributes": [
          { "label": "Kaltmiete", "value": "1.480 €" },
          { "label": "Zimmer", "value": "3" },
          { "label": "Wohnfläche", "value": "82 m²" }
        ],
        "realtor": { "companyName": "Prenzlauer Makler" },
        "isPrivate": false
      }
    }
  ]
}`;

/** Expose detail with TOP_ATTRIBUTES, MAP, MEDIA, DESCRIPTION + contact. */
export const IS24_FIXTURE_EXPOSE_JSON = `{
  "header": {
    "id": "160012345",
    "title": "Helle 2-Zimmer-Wohnung in Mitte",
    "realEstateType": "apartmentrent",
    "publicationState": "ACTIVE"
  },
  "sections": [
    {
      "type": "MEDIA",
      "media": [
        {
          "type": "PICTURE",
          "fullImageUrl": "https://pictures.immobilienscout24.de/listings/aa/bb/160012345-1.jpg/ORIG/resize/1500x1000/format/webp/quality/80",
          "caption": "Wohnzimmer"
        },
        {
          "type": "PICTURE",
          "fullImageUrl": "https://pictures.immobilienscout24.de/listings/aa/bb/160012345-2.jpg/ORIG/resize/1500x1000/format/webp/quality/80"
        }
      ]
    },
    {
      "type": "TOP_ATTRIBUTES",
      "attributes": [
        { "label": "Kaltmiete", "text": "1.250 €", "type": "TEXT", "highlighted": true },
        { "label": "Zimmer", "text": "2", "type": "TEXT" },
        { "label": "Wohnfläche", "text": "65 m²", "type": "TEXT" },
        { "label": "Warmmiete", "text": "1.450 €", "type": "TEXT" }
      ]
    },
    { "type": "TITLE", "title": "Helle 2-Zimmer-Wohnung in Mitte" },
    {
      "type": "MAP",
      "title": "Karte",
      "location": { "lat": 52.531, "lng": 13.401 },
      "addressLine1": "Torstrasse 1",
      "addressLine2": "10119 Mitte, Berlin"
    },
    {
      "type": "DESCRIPTION",
      "title": "Objektbeschreibung",
      "text": "Lichtdurchflutete Wohnung mit Balkon und Einbauküche in Berlin-Mitte."
    }
  ],
  "contact": {
    "type": "CONTACT",
    "callButtonState": "active",
    "phoneNumbers": [{ "phoneNumber": "+493012345678", "type": "MOBILE" }],
    "contactData": {
      "agent": {
        "name": "Anna Schmidt",
        "company": "Mitte Homes GmbH"
      }
    }
  }
}`;
