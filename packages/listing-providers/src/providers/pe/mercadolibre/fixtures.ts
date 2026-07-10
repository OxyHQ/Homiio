/**
 * MercadoLibre Peru inmuebles — general classifieds, HOUSING ONLY.
 */

export const MERCADOLIBRE_PE_BASE_URL = 'https://inmuebles.mercadolibre.com.pe';

export const MERCADOLIBRE_PE_HOUSING_SLUGS: ReadonlySet<string> = new Set([
  'inmuebles',
  'departamentos',
  'casas',
  'monoambientes',
  'ph',
  'habitaciones',
  'terrenos',
  'oficinas',
  'locales',
  'alquiler',
  'venta',
]);

export const MERCADOLIBRE_PE_FIXTURE_SEARCH_JSON = JSON.stringify({
  results: [
    {
      id: 'MPE-3847653074',
      permalink:
        'https://departamento.mercadolibre.com.pe/MPE-3847653074-alquiler-departamento-2-dormitorios-miraflores-_JM',
      title: 'Alquiler departamento 2 dormitorios Miraflores',
      price: 3200,
      currency_id: 'PEN',
      category_id: 'MPE1459',
      domain_id: 'MPE-APARTMENTS_FOR_RENT',
      location: {
        city: { name: 'Lima' },
        state: { name: 'Lima' },
        neighborhood: { name: 'Miraflores' },
        address_line: 'Miraflores',
      },
      attributes: [
        { id: 'BEDROOMS', value_name: '2' },
        { id: 'FULL_BATHROOMS', value_name: '2' },
        { id: 'COVERED_AREA', value_name: '75 m²' },
      ],
      thumbnail: 'https://http2.mlstatic.com/fixture-ml-pe-1.jpg',
      seller: { nickname: 'InmoPE', phone: { number: '51987654321' } },
    },
  ],
});

export const MERCADOLIBRE_PE_FIXTURE_NON_HOUSING_JSON = JSON.stringify({
  results: [
    {
      id: 'MPE-999000111',
      permalink: 'https://auto.mercadolibre.com.pe/MPE-999000111-toyota-_JM',
      title: 'Toyota Corolla 2019',
      price: 65000,
      currency_id: 'PEN',
      category_id: 'MPE1744',
      domain_id: 'CARS_AND_VANS',
      location: { city: { name: 'Lima' } },
    },
  ],
});

export const MERCADOLIBRE_PE_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"name":"Alquiler departamento 2 dormitorios Miraflores","image":"https://http2.mlstatic.com/fixture-ml-pe-1.jpg","offers":{"price":3200,"availability":"https://schema.org/InStock","url":"https://departamento.mercadolibre.com.pe/MPE-3847653074-alquiler-departamento-2-dormitorios-miraflores-_JM","@type":"Offer","priceCurrency":"PEN"},"sku":"MPE3847653074","@context":"https://schema.org","@type":"Product","productID":"MPE3847653074"}
</script>
</head><body>
<script>var x={"domain_id":"MPE-APARTMENTS_FOR_RENT","city":"Lima","neighborhood":"Miraflores","state":"Lima"};</script>
<a href="tel:+51987654321">Llamar</a>
<h1>Alquiler departamento</h1>
</body></html>`;

export const MERCADOLIBRE_PE_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${MERCADOLIBRE_PE_FIXTURE_SEARCH_JSON};</script>
<a href="https://departamento.mercadolibre.com.pe/MPE-3847653074-alquiler-departamento-2-dormitorios-miraflores-_JM">Depto</a>
</body></html>`;
