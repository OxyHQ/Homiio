/**
 * Metrocuadrado (Colombia) fixtures — Navent-shaped search JSON + detail HTML.
 */

export const METROCUADRADO_BASE_URL = 'https://www.metrocuadrado.com';

const LIST_POSTINGS = [
  {
    postingId: '83001122',
    url: '/propiedades/clasificado/arriendoapartamento-apartamento-2-hab-chapinero-83001122.html',
    title: 'Apartamento 2 habitaciones Chapinero',
    price: { amount: 2800000, currency: 'COP' },
    operationType: { name: 'Arriendo' },
    realEstateType: { name: 'Apartamento' },
    mainFeatures: { CFT100: { value: '2' }, CFT101: { value: '2' }, CFT2: { value: '68' } },
    postingLocation: {
      address: {
        name: 'Calle 59 # 7-30',
        city: { name: 'Bogotá D.C.' },
        state: { name: 'Cundinamarca' },
      },
    },
    pictures: [{ urlSoft360Overwrite: 'https://img.metrocuadrado.com/fixture-1.jpg' }],
    publisher: { name: 'Inmobiliaria Chapinero', phone: '+576012345678', whatsapp: '576012345678' },
  },
  {
    postingId: '83001123',
    url: '/propiedades/clasificado/ventaapartamento-apartamento-venta-el-poblado-83001123.html',
    title: 'Apartamento en venta El Poblado',
    price: { amount: 520000000, currency: 'COP' },
    operationType: { name: 'Venta' },
    realEstateType: { name: 'Apartamento' },
    mainFeatures: { CFT100: { value: '3' }, CFT101: { value: '2' }, CFT2: { value: '92' } },
    postingLocation: {
      address: {
        name: 'Carrera 43A # 5-50',
        city: { name: 'Medellín' },
        state: { name: 'Antioquia' },
      },
    },
    pictures: [{ urlSoft360Overwrite: 'https://img.metrocuadrado.com/fixture-2.jpg' }],
    publisher: { name: 'Agencia El Poblado', phone: '6047654321' },
  },
] as const;

export const METROCUADRADO_FIXTURE_SEARCH_JSON = JSON.stringify({ listPostings: LIST_POSTINGS });

export const METROCUADRADO_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ listPostings: LIST_POSTINGS })};</script>
<a href="/propiedades/clasificado/arriendoapartamento-apartamento-2-hab-chapinero-83001122.html">Apto</a>
</body></html>`;

export const METROCUADRADO_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"RealEstateListing","name":"Apartamento 2 habitaciones Chapinero","url":"https://www.metrocuadrado.com/propiedades/clasificado/arriendoapartamento-apartamento-2-hab-chapinero-83001122.html","description":"Apartamento luminoso en Chapinero","offers":{"@type":"Offer","price":2800000,"priceCurrency":"COP","businessFunction":"http://purl.org/goodrelations/v1#LeaseOut"},"address":{"@type":"PostalAddress","streetAddress":"Calle 59 # 7-30","addressLocality":"Bogotá D.C.","addressRegion":"Cundinamarca","addressCountry":"CO"},"geo":{"@type":"GeoCoordinates","latitude":4.648,"longitude":-74.063},"numberOfRooms":2,"numberOfBathroomsTotal":2,"floorSize":{"@type":"QuantitativeValue","value":68,"unitCode":"MTK"},"image":["https://img.metrocuadrado.com/fixture-1.jpg"],"telephone":"+576012345678"}
</script>
<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ postingSearch: { listPostings: [LIST_POSTINGS[0]] } })};</script>
</head><body><h1>Apartamento 2 habitaciones Chapinero</h1></body></html>`;
