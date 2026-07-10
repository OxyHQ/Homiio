/**
 * Zonaprop (AR) fixtures — Navent-shaped search JSON + detail HTML.
 */

export const ZONAPROP_BASE_URL = 'https://www.zonaprop.com.ar';

const LIST_POSTINGS = [
  {
    postingId: '52001122',
    url: '/propiedades/clasificado/alquilercasa-depto-2-amb-palermo-52001122.html',
    title: 'Departamento 2 ambientes Palermo',
    price: { amount: 450000, currency: 'ARS' },
    operationType: { name: 'Alquiler' },
    realEstateType: { name: 'Departamento' },
    mainFeatures: { CFT100: { value: '2' }, CFT101: { value: '1' }, CFT2: { value: '55' } },
    postingLocation: {
      address: {
        name: 'Honduras 4800',
        city: { name: 'Capital Federal' },
        state: { name: 'Buenos Aires' },
      },
    },
    pictures: [{ urlSoft360Overwrite: 'https://img.zonaprop.com.ar/fixture-1.jpg' }],
    publisher: { name: 'Inmo Palermo', phone: '+5491112345678', whatsapp: '5491112345678' },
  },
  {
    postingId: '52001123',
    url: '/propiedades/clasificado/ventadepartamento-depto-venta-recoleta-52001123.html',
    title: 'Departamento en venta Recoleta',
    price: { amount: 185000, currency: 'USD' },
    operationType: { name: 'Venta' },
    realEstateType: { name: 'Departamento' },
    mainFeatures: { CFT100: { value: '3' }, CFT101: { value: '2' }, CFT2: { value: '95' } },
    postingLocation: {
      address: {
        name: 'Av. Callao 1200',
        city: { name: 'Capital Federal' },
        state: { name: 'Buenos Aires' },
      },
    },
    pictures: [{ urlSoft360Overwrite: 'https://img.zonaprop.com.ar/fixture-2.jpg' }],
    publisher: { name: 'Particular', phone: '1144556677' },
  },
] as const;

export const ZONAPROP_FIXTURE_SEARCH_JSON = JSON.stringify({ listPostings: LIST_POSTINGS });

export const ZONAPROP_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ listPostings: LIST_POSTINGS })};</script>
<a href="/propiedades/clasificado/alquilercasa-depto-2-amb-palermo-52001122.html">Depto</a>
</body></html>`;

export const ZONAPROP_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"RealEstateListing","name":"Departamento 2 ambientes Palermo","url":"https://www.zonaprop.com.ar/propiedades/clasificado/alquilercasa-depto-2-amb-palermo-52001122.html","description":"Luminoso 2 ambientes","offers":{"@type":"Offer","price":450000,"priceCurrency":"ARS","businessFunction":"http://purl.org/goodrelations/v1#LeaseOut"},"address":{"@type":"PostalAddress","streetAddress":"Honduras 4800","addressLocality":"Capital Federal","addressRegion":"Buenos Aires","addressCountry":"AR"},"geo":{"@type":"GeoCoordinates","latitude":-34.58,"longitude":-58.42},"numberOfRooms":2,"numberOfBathroomsTotal":1,"floorSize":{"@type":"QuantitativeValue","value":55,"unitCode":"MTK"},"image":["https://img.zonaprop.com.ar/fixture-1.jpg"],"telephone":"+5491112345678"}
</script>
<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ postingSearch: { listPostings: [LIST_POSTINGS[0]] } })};</script>
</head><body><h1>Departamento 2 ambientes Palermo</h1></body></html>`;
