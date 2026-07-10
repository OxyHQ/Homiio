export const PROPERATI_EC_BASE_URL = 'https://www.properati.com.ec';
export const PROPERATI_EC_FIXTURE_SEARCH_JSON = JSON.stringify({
  data: [{
    id: 'ec-prop-1001',
    url: 'https://www.properati.com.ec/detalle/departamento-alquiler-quito-ec-prop-1001',
    title: 'Departamento alquiler Quito',
    price: 380,
    currency: 'USD',
    operation: 'rent',
    rooms: 2,
    bathrooms: 1,
    surface: 68,
    place: { name: 'Quito', parent: { name: 'Pichincha' } },
    images: ['https://img.properati.com/fixture-1.jpg'],
    contact: { phone: '+593991112233', agency: 'Properati Agent' },
  }],
});
export const PROPERATI_EC_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Apartment","name":"Departamento alquiler Quito","url":"https://www.properati.com.ec/detalle/departamento-alquiler-quito-ec-prop-1001","offers":{"@type":"Offer","price":380,"priceCurrency":"USD","businessFunction":"http://purl.org/goodrelations/v1#LeaseOut"},"address":{"@type":"PostalAddress","addressLocality":"Quito","addressRegion":"Pichincha","addressCountry":"EC"},"numberOfRooms":2,"numberOfBathroomsTotal":1,"floorSize":{"@type":"QuantitativeValue","value":68},"image":["https://img.properati.com/fixture-1.jpg"]}
</script>
</head><body></body></html>`;
