/**
 * Lamudi Mexico fixtures — schema.org ItemList search + detail JSON-LD.
 */

export const LAMUDI_BASE_URL = 'https://www.lamudi.com.mx';

export const LAMUDI_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"SearchResultsPage","mainEntity":[{"@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"item":{"@type":"Apartment","@id":"https://www.lamudi.com.mx/detalle/41032-73-fixture-rent","url":"https://www.lamudi.com.mx/detalle/41032-73-fixture-rent","name":"Departamento en Renta en Roma Sur","description":"Hermoso departamento. EasyBroker ID: EB-VR8903","numberOfBedrooms":2,"numberOfBathroomsTotal":2,"image":"https://img.lamudi.com.mx/fixture-1.jpg","address":{"@type":"PostalAddress","streetAddress":"Calle Huatusco 19, Roma Sur","addressLocality":"Cuauhtémoc","addressRegion":"Ciudad de México","addressCountry":{"@type":"Country","name":"MX"}},"floorSize":{"@type":"QuantitativeValue","value":"110","unitCode":"MTK"},"geo":{"@type":"GeoCoordinates","latitude":"19.400998","longitude":"-99.169069"},"offers":{"@type":"Offer","priceSpecification":{"@type":"UnitPriceSpecification","price":"40000","priceCurrency":"MXN","unitText":"MONTH"}}}}]}]}]}
</script>
</head><body><a href="/detalle/41032-73-fixture-rent">Depto</a></body></html>`;

export const LAMUDI_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Apartment","@id":"https://www.lamudi.com.mx/detalle/41032-73-fixture-rent","url":"https://www.lamudi.com.mx/detalle/41032-73-fixture-rent","name":"Departamento en Renta en Roma Sur","description":"Hermoso departamento exterior.","numberOfBedrooms":2,"numberOfBathroomsTotal":2,"image":["https://img.lamudi.com.mx/fixture-1.jpg"],"telephone":"+525598765432","address":{"@type":"PostalAddress","streetAddress":"Calle Huatusco 19, Roma Sur","addressLocality":"Cuauhtémoc","addressRegion":"Ciudad de México","addressCountry":{"@type":"Country","name":"MX"}},"floorSize":{"@type":"QuantitativeValue","value":"110","unitCode":"MTK"},"geo":{"@type":"GeoCoordinates","latitude":"19.400998","longitude":"-99.169069"},"offers":{"@type":"Offer","priceSpecification":{"@type":"UnitPriceSpecification","price":"40000","priceCurrency":"MXN","unitText":"MONTH"}}}
</script>
</head><body><a href="tel:+525598765432">Llamar</a><a href="https://wa.me/525598765432">WhatsApp</a></body></html>`;
