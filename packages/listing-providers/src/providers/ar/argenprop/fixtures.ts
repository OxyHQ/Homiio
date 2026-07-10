/**
 * Argenprop (AR) fixtures — Navent-shaped payloads (same stack as Zonaprop).
 */

export const ARGENPROP_BASE_URL = 'https://www.argenprop.com';

const LIST_POSTINGS = [
  {
    postingId: '16789012',
    url: '/departamento-en-alquiler-en-belgrano-2-ambientes--16789012',
    title: 'Departamento 2 ambientes Belgrano',
    price: { amount: 380000, currency: 'ARS' },
    operationType: { name: 'Alquiler' },
    realEstateType: { name: 'Departamento' },
    mainFeatures: { CFT100: { value: '2' }, CFT101: { value: '1' }, CFT2: { value: '48' } },
    postingLocation: {
      address: {
        name: 'Cabildo 2500',
        city: { name: 'Capital Federal' },
        state: { name: 'Buenos Aires' },
      },
    },
    pictures: [{ url: 'https://img.argenprop.com/fixture-1.jpg' }],
    publisher: {
      name: 'Argen Inmo',
      phone: '+5491199887766',
      agencyName: 'Argen Inmo',
    },
  },
  {
    postingId: '16789013',
    url: '/casa-en-venta-en-nordelta--16789013',
    title: 'Casa en venta Nordelta',
    price: { amount: 320000, currency: 'USD' },
    operationType: { name: 'Venta' },
    realEstateType: { name: 'Casa' },
    mainFeatures: { CFT100: { value: '4' }, CFT101: { value: '3' }, CFT2: { value: '220' } },
    postingLocation: {
      address: {
        name: 'Av. de los Lagos',
        city: { name: 'Tigre' },
        state: { name: 'Buenos Aires' },
      },
    },
    pictures: [{ url: 'https://img.argenprop.com/fixture-2.jpg' }],
    publisher: { name: 'Particular', phone: '1155667788' },
  },
] as const;

export const ARGENPROP_FIXTURE_SEARCH_JSON = JSON.stringify({ listPostings: LIST_POSTINGS });

export const ARGENPROP_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ listPostings: LIST_POSTINGS })};</script>
<a href="/departamento-en-alquiler-en-belgrano-2-ambientes--16789012">Depto</a>
</body></html>`;

export const ARGENPROP_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"RealEstateListing","name":"Departamento 2 ambientes Belgrano","url":"https://www.argenprop.com/departamento-en-alquiler-en-belgrano-2-ambientes--16789012","description":"2 ambientes luminoso","offers":{"@type":"Offer","price":380000,"priceCurrency":"ARS","businessFunction":"http://purl.org/goodrelations/v1#LeaseOut"},"address":{"@type":"PostalAddress","streetAddress":"Cabildo 2500","addressLocality":"Capital Federal","addressRegion":"Buenos Aires","addressCountry":"AR"},"numberOfRooms":2,"numberOfBathroomsTotal":1,"floorSize":{"@type":"QuantitativeValue","value":48,"unitCode":"MTK"},"image":["https://img.argenprop.com/fixture-1.jpg"],"telephone":"+5491199887766"}
</script>
<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ postingSearch: { listPostings: [LIST_POSTINGS[0]] } })};</script>
</head><body><h1>Departamento Belgrano</h1></body></html>`;
