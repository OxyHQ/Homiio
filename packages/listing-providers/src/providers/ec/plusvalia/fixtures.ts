export const PLUSVALIA_BASE_URL = 'https://www.plusvalia.com';

const LIST_POSTINGS = [
  {
    postingId: '11002233',
    url: '/propiedades/clasificado/alquilercasa-casa-en-alquiler-cumbaya-11002233.html',
    title: 'Casa en alquiler Cumbayá',
    price: { amount: 1200, currency: 'USD' },
    operationType: { name: 'Alquiler' },
    realEstateType: { name: 'Casa' },
    mainFeatures: { CFT100: { value: '3' }, CFT101: { value: '2' }, CFT2: { value: '180' } },
    postingLocation: {
      address: { name: 'Calle Los Álamos', city: { name: 'Quito' }, state: { name: 'Pichincha' } },
    },
    pictures: [{ urlSoft360Overwrite: 'https://img.plusvalia.com/fixture-1.jpg' }],
    publisher: { name: 'Inmo Quito', phone: '+59399887766', whatsapp: '59399887766' },
  },
  {
    postingId: '11002234',
    url: '/propiedades/clasificado/ventadepartamento-depto-norte-11002234.html',
    title: 'Departamento en venta Norte',
    price: { amount: 145000, currency: 'USD' },
    operationType: { name: 'Venta' },
    realEstateType: { name: 'Departamento' },
    mainFeatures: { CFT100: { value: '2' }, CFT101: { value: '1' }, CFT2: { value: '85' } },
    postingLocation: {
      address: { name: 'Av. República', city: { name: 'Quito' }, state: { name: 'Pichincha' } },
    },
    pictures: [{ urlSoft360Overwrite: 'https://img.plusvalia.com/fixture-2.jpg' }],
    publisher: { name: 'Particular', phone: '0991234567' },
  },
] as const;

export const PLUSVALIA_FIXTURE_SEARCH_JSON = JSON.stringify({ listPostings: LIST_POSTINGS });

export const PLUSVALIA_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ listPostings: LIST_POSTINGS })};</script>
</body></html>`;

export const PLUSVALIA_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"RealEstateListing","name":"Casa en alquiler Cumbayá","url":"https://www.plusvalia.com/propiedades/clasificado/alquilercasa-casa-en-alquiler-cumbaya-11002233.html","description":"Hermosa casa","offers":{"@type":"Offer","price":1200,"priceCurrency":"USD","businessFunction":"http://purl.org/goodrelations/v1#LeaseOut"},"address":{"@type":"PostalAddress","streetAddress":"Calle Los Álamos","addressLocality":"Quito","addressRegion":"Pichincha","addressCountry":"EC"},"numberOfRooms":3,"numberOfBathroomsTotal":2,"floorSize":{"@type":"QuantitativeValue","value":180},"image":["https://img.plusvalia.com/fixture-1.jpg"],"telephone":"+59399887766"}
</script>
<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ postingSearch: { listPostings: [LIST_POSTINGS[0]] } })};</script>
</head><body></body></html>`;
