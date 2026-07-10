/**
 * Propiedades.com (MX) fixtures — schema.org JSON-LD.
 * Portal often Akamai-blocked from datacenter IPs; keep provider OFF until probed.
 */

export const PROPIEDADES_BASE_URL = 'https://www.propiedades.com';

export const PROPIEDADES_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"item":{"@type":"Apartment","@id":"https://www.propiedades.com/inmueble/12345678","url":"https://www.propiedades.com/inmueble/12345678","name":"Depto renta Condesa","offers":{"@type":"Offer","price":28000,"priceCurrency":"MXN"},"address":{"@type":"PostalAddress","addressLocality":"Ciudad de México","addressCountry":"MX"},"numberOfBedrooms":2,"numberOfBathroomsTotal":1,"floorSize":{"@type":"QuantitativeValue","value":75},"image":"https://img.propiedades.com/fixture.jpg","telephone":"5599887766"}}]}
</script>
</head><body><a href="/inmueble/12345678">Depto</a></body></html>`;

export const PROPIEDADES_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Apartment","url":"https://www.propiedades.com/inmueble/12345678","name":"Depto renta Condesa","description":"Bonito departamento","offers":{"@type":"Offer","price":28000,"priceCurrency":"MXN"},"address":{"@type":"PostalAddress","streetAddress":"Amsterdam 100","addressLocality":"Ciudad de México","addressRegion":"CDMX","addressCountry":"MX"},"numberOfBedrooms":2,"numberOfBathroomsTotal":1,"floorSize":{"@type":"QuantitativeValue","value":75},"image":["https://img.propiedades.com/fixture.jpg"],"telephone":"5599887766"}
</script>
</head><body><a href="tel:5599887766">Llamar</a></body></html>`;
