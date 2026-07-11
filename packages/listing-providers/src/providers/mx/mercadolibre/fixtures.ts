/**
 * MercadoLibre Mexico inmuebles — general classifieds, HOUSING ONLY.
 */

export const MERCADOLIBRE_MX_BASE_URL = 'https://inmuebles.mercadolibre.com.mx';

export const MERCADOLIBRE_MX_HOUSING_SLUGS: ReadonlySet<string> = new Set([
  'inmuebles',
  'departamentos',
  'casas',
  'monoambientes',
  'ph',
  'habitaciones',
  'terrenos',
  'oficinas',
  'locales',
  'renta',
  'venta',
]);

export const MERCADOLIBRE_MX_FIXTURE_SEARCH_JSON = JSON.stringify({
  results: [
    {
      id: 'MLM-3847653074',
      permalink:
        'https://departamento.mercadolibre.com.mx/MLM-3847653074-renta-departamento-2-recamaras-roma-_JM',
      title: 'Renta departamento 2 recámaras Roma',
      price: 28000,
      currency_id: 'MXN',
      category_id: 'MLM1459',
      domain_id: 'MLM-APARTMENTS_FOR_RENT',
      location: {
        city: { name: 'Ciudad de México' },
        state: { name: 'Ciudad de México' },
        neighborhood: { name: 'Roma Norte' },
        address_line: 'Roma Norte',
      },
      attributes: [
        { id: 'BEDROOMS', value_name: '2' },
        { id: 'FULL_BATHROOMS', value_name: '2' },
        { id: 'COVERED_AREA', value_name: '72 m²' },
      ],
      thumbnail: 'https://http2.mlstatic.com/fixture-ml-mx-1.jpg',
      seller: { nickname: 'InmoMX', phone: { number: '5555667788' } },
    },
  ],
});

export const MERCADOLIBRE_MX_FIXTURE_NON_HOUSING_JSON = JSON.stringify({
  results: [
    {
      id: 'MLM-999000111',
      permalink: 'https://auto.mercadolibre.com.mx/MLM-999000111-nissan-_JM',
      title: 'Nissan Versa 2021',
      price: 250000,
      currency_id: 'MXN',
      category_id: 'MLM1744',
      domain_id: 'CARS_AND_VANS',
      location: { city: { name: 'Ciudad de México' } },
    },
  ],
});

export const MERCADOLIBRE_MX_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"name":"Renta departamento 2 recámaras Roma","image":"https://http2.mlstatic.com/fixture-ml-mx-1.jpg","offers":{"price":28000,"availability":"https://schema.org/InStock","url":"https://departamento.mercadolibre.com.mx/MLM-3847653074-renta-departamento-2-recamaras-roma-_JM","@type":"Offer","priceCurrency":"MXN"},"sku":"MLM3847653074","@context":"https://schema.org","@type":"Product","productID":"MLM3847653074"}
</script>
</head><body>
<script>var seller={"id":"seller_profile","type":"seller_profile","state":"VISIBLE"};</script>
<script>var vip={"domain_id":"MLM-APARTMENTS_FOR_RENT","description_type":"plain_text","city":"Benito Juárez","neighborhood":"Roma Norte","state":"Ciudad de México"};</script>
<script>var specs={"attributes":[{"icon":{"id":"BED","color":"BLACK","size":"XXSMALL"},"label":{"text":"2 rec.","color":"BLACK"}},{"icon":{"id":"BATHROOM","color":"BLACK","size":"XXSMALL"},"label":{"text":"2 baños","color":"BLACK"}},{"icon":{"id":"SCALE_UP","color":"BLACK","size":"XXSMALL"},"label":{"text":"72 m² totales","color":"BLACK"}}]};</script>
<a href="tel:+525555667788">Llamar</a>
<div class="ui-pdp-gallery">
<a class="gallery-image__link" href="#"><img src="https://http2.mlstatic.com/D_NQ_NP_620729-MLM112636094885_062026-F.webp"/></a>
<a class="gallery-image__link" href="#"><img src="https://http2.mlstatic.com/D_NQ_NP_708821-MLM112636094891_062026-F.webp"/></a>
</div>
<h1>Renta departamento</h1>
</body></html>`;

export const MERCADOLIBRE_MX_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${MERCADOLIBRE_MX_FIXTURE_SEARCH_JSON};</script>
<a href="https://departamento.mercadolibre.com.mx/MLM-3847653074-renta-departamento-2-recamaras-roma-_JM">Depto</a>
</body></html>`;
