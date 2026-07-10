/**
 * Inmuebles24 (MX) fixtures — Navent-shaped search JSON + detail HTML.
 */

export const INMUEBLES24_BASE_URL = 'https://www.inmuebles24.com';

const LIST_POSTINGS = [
  {
    postingId: '63741829',
    url: '/propiedades/departamento-en-renta-en-polanco-3-recamaras-63741829.html',
    title: 'Departamento en renta en Polanco',
    price: { amount: 45000, currency: 'MXN' },
    operationType: { name: 'Renta' },
    realEstateType: { name: 'Departamento' },
    mainFeatures: { CFT100: { value: '3' }, CFT101: { value: '2' }, CFT2: { value: '148' } },
    postingLocation: {
      address: {
        name: 'Polanco V Sección',
        city: { name: 'Ciudad de México' },
        state: { name: 'Ciudad de México' },
      },
    },
    pictures: [{ urlSoft360Overwrite: 'https://img.inmuebles24.com/fixture-1.jpg' }],
    publisher: { name: 'ERA México', phone: '+525512345678', whatsapp: '525512345678' },
  },
  {
    postingId: '63741830',
    url: '/propiedades/casa-en-venta-en-satelite-63741830.html',
    title: 'Casa en venta Satélite',
    price: { amount: 8500000, currency: 'MXN' },
    operationType: { name: 'Venta' },
    realEstateType: { name: 'Casa' },
    mainFeatures: { CFT100: { value: '4' }, CFT101: { value: '3' }, CFT2: { value: '220' } },
    postingLocation: {
      address: {
        name: 'Cd. Satélite',
        city: { name: 'Naucalpan' },
        state: { name: 'Estado de México' },
      },
    },
    pictures: [{ urlSoft360Overwrite: 'https://img.inmuebles24.com/fixture-2.jpg' }],
    publisher: { name: 'Particular', phone: '5511223344' },
  },
] as const;

export const INMUEBLES24_FIXTURE_SEARCH_JSON = JSON.stringify({ listPostings: LIST_POSTINGS });

export const INMUEBLES24_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ listPostings: LIST_POSTINGS })};</script>
<a href="/propiedades/departamento-en-renta-en-polanco-3-recamaras-63741829.html">Depto</a>
</body></html>`;

export const INMUEBLES24_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"RealEstateListing","name":"Departamento en renta en Polanco","url":"https://www.inmuebles24.com/propiedades/departamento-en-renta-en-polanco-3-recamaras-63741829.html","description":"Amplio departamento","offers":{"@type":"Offer","price":45000,"priceCurrency":"MXN","businessFunction":"http://purl.org/goodrelations/v1#LeaseOut"},"address":{"@type":"PostalAddress","streetAddress":"Polanco V Sección","addressLocality":"Ciudad de México","addressRegion":"Ciudad de México","addressCountry":"MX"},"geo":{"@type":"GeoCoordinates","latitude":19.43,"longitude":-99.19},"numberOfRooms":3,"numberOfBathroomsTotal":2,"floorSize":{"@type":"QuantitativeValue","value":148,"unitCode":"MTK"},"image":["https://img.inmuebles24.com/fixture-1.jpg"],"telephone":"+525512345678"}
</script>
<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ postingSearch: { listPostings: [LIST_POSTINGS[0]] } })};</script>
</head><body><h1>Departamento en renta en Polanco</h1></body></html>`;
