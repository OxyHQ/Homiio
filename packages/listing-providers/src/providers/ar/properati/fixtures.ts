/**
 * Properati Argentina fixtures — JSON-LD + __NEXT_DATA__ (Cloudflare-gated live).
 */

export const PROPERATI_BASE_URL = 'https://www.properati.com.ar';

export const PROPERATI_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      results: [
        {
          id: 'properati-ar-1001',
          url: '/detalle/departamento-alquiler-palermo-properati-ar-1001',
          title: 'Depto alquiler Palermo',
          price: 420000,
          currency: 'ARS',
          operation: 'rent',
          city: 'Capital Federal',
          neighborhood: 'Palermo',
          bedrooms: 2,
          bathrooms: 1,
          surface: 60,
          images: ['https://img.properati.com.ar/fixture-1.jpg'],
          publisher: { name: 'Properati Agency', phone: '+5491122334455' },
        },
      ],
    },
  },
})}</script>
<a href="/detalle/departamento-alquiler-palermo-properati-ar-1001">Depto</a>
</body></html>`;

export const PROPERATI_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Apartment","name":"Depto alquiler Palermo","url":"https://www.properati.com.ar/detalle/departamento-alquiler-palermo-properati-ar-1001","description":"2 ambientes Palermo","offers":{"@type":"Offer","price":420000,"priceCurrency":"ARS","businessFunction":"http://purl.org/goodrelations/v1#LeaseOut"},"address":{"@type":"PostalAddress","streetAddress":"Scalabrini Ortiz 2000","addressLocality":"Capital Federal","addressRegion":"Buenos Aires","addressCountry":"AR"},"numberOfRooms":2,"numberOfBathroomsTotal":1,"floorSize":{"@type":"QuantitativeValue","value":60,"unitCode":"MTK"},"image":["https://img.properati.com.ar/fixture-1.jpg"],"telephone":"+5491122334455"}
</script>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      listing: {
        id: 'properati-ar-1001',
        url: '/detalle/departamento-alquiler-palermo-properati-ar-1001',
        title: 'Depto alquiler Palermo',
        price: 420000,
        currency: 'ARS',
        operation: 'rent',
        city: 'Capital Federal',
        neighborhood: 'Palermo',
        bedrooms: 2,
        bathrooms: 1,
        surface: 60,
        images: ['https://img.properati.com.ar/fixture-1.jpg'],
        publisher: { name: 'Properati Agency', phone: '+5491122334455' },
      },
    },
  },
})}</script>
</head><body><h1>Depto Palermo</h1></body></html>`;
