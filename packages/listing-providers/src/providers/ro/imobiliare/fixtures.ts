/**
 * Recorded Imobiliare.ro fixtures (portal-shaped Inertia data-page + JSON-LD).
 */

export const IMOBILIARE_RO_BASE_URL = 'https://www.imobiliare.ro';

export const IMOBILIARE_RO_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="ro">
<body>
<div id="app" data-page="{&quot;component&quot;:&quot;Search&quot;,&quot;props&quot;:{&quot;searchMeta&quot;:{&quot;currentPage&quot;:1,&quot;lastPage&quot;:10,&quot;totalCount&quot;:2},&quot;sections&quot;:[{&quot;type&quot;:&quot;results-list&quot;,&quot;data&quot;:{&quot;listings&quot;:[{&quot;id&quot;:201582656,&quot;url&quot;:&quot;/oferta/apartament-de-vanzare-pipera-3-camere-201582656&quot;,&quot;title&quot;:&quot;Apartament 3 camere Pipera&quot;,&quot;address&quot;:&quot;Bd. Pipera nr.1D-11, Pipera, Sector 1&quot;,&quot;location&quot;:&quot;Pipera, Sector 1&quot;,&quot;price&quot;:&quot;228.690 €&quot;,&quot;offerType&quot;:&quot;sell&quot;,&quot;agencyName&quot;:&quot;BECALI IMOBILIARE&quot;,&quot;canShowPhone&quot;:true},{&quot;id&quot;:201582657,&quot;url&quot;:&quot;/oferta/apartament-de-inchiriat-floreasca-2-camere-201582657&quot;,&quot;title&quot;:&quot;Apartament 2 camere Floreasca&quot;,&quot;address&quot;:&quot;Floreasca, Sector 2&quot;,&quot;location&quot;:&quot;Floreasca, Sector 2&quot;,&quot;price&quot;:&quot;850 €&quot;,&quot;offerType&quot;:&quot;rent&quot;,&quot;agencyName&quot;:&quot;Agency Test&quot;,&quot;canShowPhone&quot;:true}]}}]},&quot;url&quot;:&quot;/vanzare-apartamente/bucuresti&quot;}"></div>
</body>
</html>`;

export const IMOBILIARE_RO_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="ro">
<head>
<title>Apartament 3 camere Pipera | Imobiliare.ro</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Product",
      "name": "Apartament 3 camere Pipera",
      "description": "Apartament decomandat cu gradina in Pipera.",
      "image": [
        { "@id": "https://example.cdn/imo/201582656-1.jpg" },
        { "@id": "https://example.cdn/imo/201582656-2.jpg" }
      ],
      "@id": "https://www.imobiliare.ro/#/schema/Product/oferta/apartament-de-vanzare-pipera-3-camere-201582656"
    },
    {
      "@type": "RealEstateListing",
      "url": "https://www.imobiliare.ro/oferta/apartament-de-vanzare-pipera-3-camere-201582656",
      "name": "Apartament 3 camere Pipera",
      "description": "De vanzare: apartament cu 3 camere, 91.3 mp.",
      "mainEntity": {
        "@id": "https://www.imobiliare.ro/#/schema/Product/oferta/apartament-de-vanzare-pipera-3-camere-201582656"
      }
    },
    {
      "@type": "Offer",
      "url": "https://www.imobiliare.ro/oferta/apartament-de-vanzare-pipera-3-camere-201582656",
      "businessFunction": "http://purl.org/goodrelations/v1#Sell",
      "priceSpecification": {
        "@type": "PriceSpecification",
        "price": 228690,
        "priceCurrency": "EUR"
      },
      "@id": "https://www.imobiliare.ro/#/schema/Offer/listing-201582656"
    },
    {
      "@type": "Accommodation",
      "floorLevel": "1",
      "floorSize": "91.4",
      "numberOfBathroomsTotal": 2,
      "numberOfBedrooms": 3,
      "address": { "@id": "https://www.imobiliare.ro/#/schema/Address/listing-201582656" },
      "@id": "https://www.imobiliare.ro/#/schema/Accommodation/listing-201582656"
    },
    {
      "@type": "PostalAddress",
      "streetAddress": "Bd. Pipera nr.1D-11",
      "addressLocality": "Pipera",
      "addressRegion": "Sector 1",
      "addressCountry": "RO",
      "@id": "https://www.imobiliare.ro/#/schema/Address/listing-201582656"
    }
  ]
}
</script>
<script>
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({"listing_id":201582656,"listing_title":"Apartament 3 camere Pipera","listing_price":"228690.00","listing_currency":"EUR","listing_location_title":"Pipera"});
</script>
</body>
</html>`;
