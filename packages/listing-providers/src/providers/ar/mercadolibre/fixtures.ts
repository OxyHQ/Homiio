/**
 * MercadoLibre Argentina inmuebles — general classifieds, HOUSING ONLY.
 */

export const MERCADOLIBRE_AR_BASE_URL = 'https://inmuebles.mercadolibre.com.ar';

export const MERCADOLIBRE_AR_HOUSING_SLUGS: ReadonlySet<string> = new Set([
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

export const MERCADOLIBRE_AR_FIXTURE_SEARCH_JSON = JSON.stringify({
  results: [
    {
      id: 'MLA-3557653074',
      permalink:
        'https://departamento.mercadolibre.com.ar/MLA-3557653074-alquiler-departamento-2-ambientes-belgrano-_JM',
      title: 'Alquiler departamento 2 ambientes Belgrano',
      price: 650000,
      currency_id: 'ARS',
      category_id: 'MLA1459',
      domain_id: 'MLA-APARTMENTS_FOR_RENT',
      location: {
        city: { name: 'Capital Federal' },
        state: { name: 'Capital Federal' },
        neighborhood: { name: 'Belgrano' },
        address_line: 'Belgrano',
      },
      attributes: [
        { id: 'BEDROOMS', value_name: '2' },
        { id: 'FULL_BATHROOMS', value_name: '1' },
        { id: 'COVERED_AREA', value_name: '55 m²' },
      ],
      thumbnail: 'https://http2.mlstatic.com/fixture-ml-ar-1.jpg',
      seller: { nickname: 'InmoAR', phone: { number: '1155667788' } },
    },
  ],
});

export const MERCADOLIBRE_AR_FIXTURE_NON_HOUSING_JSON = JSON.stringify({
  results: [
    {
      id: 'MLA-999000111',
      permalink: 'https://auto.mercadolibre.com.ar/MLA-999000111-toyota-_JM',
      title: 'Toyota Corolla 2020',
      price: 15000000,
      currency_id: 'ARS',
      category_id: 'MLA1744',
      domain_id: 'CARS_AND_VANS',
      location: { city: { name: 'Capital Federal' } },
    },
  ],
});

export const MERCADOLIBRE_AR_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"name":"Alquiler Departamento 2 Ambientes Belgrano","image":"https://http2.mlstatic.com/fixture-ml-ar-1.jpg","offers":{"price":650000,"availability":"https://schema.org/InStock","url":"https://departamento.mercadolibre.com.ar/MLA-3557653074-alquiler-departamento-2-ambientes-belgrano-_JM","@type":"Offer","priceCurrency":"ARS"},"sku":"MLA3557653074","@context":"https://schema.org","@type":"Product","productID":"MLA3557653074"}
</script>
</head><body>
<script>var seller={"id":"seller_profile","type":"seller_profile","state":"VISIBLE"};</script>
<script>var vip={"domain_id":"MLA-APARTMENTS_FOR_RENT","description_type":"plain_text","city":"Capital Federal","neighborhood":"Belgrano","state":"Capital Federal","whatsapp_available":true};</script>
<script>var specs={"attributes":[{"icon":{"id":"BED","color":"BLACK","size":"XXSMALL"},"label":{"text":"2 dorm.","color":"BLACK"}},{"icon":{"id":"BATHROOM","color":"BLACK","size":"XXSMALL"},"label":{"text":"1 baño","color":"BLACK"}},{"icon":{"id":"SCALE_UP","color":"BLACK","size":"XXSMALL"},"label":{"text":"55 m² totales","color":"BLACK"}}]};</script>
<a href="tel:+5491155667788">Llamar</a>
<div class="ui-pdp-gallery">
<a class="gallery-image__link" href="#"><img src="https://http2.mlstatic.com/D_NQ_NP_621054-MLA109844438740_042026-F-null.webp"/></a>
<a class="gallery-image__link" href="#"><img src="https://http2.mlstatic.com/D_NQ_NP_984582-MLA109844438786_042026-F-null.webp"/></a>
<a class="gallery-image__link" href="#"><img src="https://http2.mlstatic.com/D_NQ_NP_919980-MLA109844438792_042026-F-null.webp"/></a>
</div>
<h1>Alquiler departamento</h1>
</body></html>`;

export const MERCADOLIBRE_AR_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${MERCADOLIBRE_AR_FIXTURE_SEARCH_JSON};</script>
<a href="https://departamento.mercadolibre.com.ar/MLA-3557653074-alquiler-departamento-2-ambientes-belgrano-_JM">Depto</a>
</body></html>`;

/**
 * Real captured cold-HTTP SERP markup (inmuebles.mercadolibre.com.ar, 2026-07).
 * Today's search page ships NO `__PRELOADED_STATE__` — listings are `poly-card`
 * anchors with `&amp;`-encoded tracking fragments, so discover resolves refs via
 * the shared `hrefRe` path (fragment stripped). Proves discover still yields refs
 * against current markup through the HTTP tier.
 */
export const MERCADOLIBRE_AR_FIXTURE_LIVE_SERP_HTML = `<!DOCTYPE html><html><body>
<ol class="ui-search-layout ui-search-layout--grid">
<li class="ui-search-layout__item"><div class="poly-card"><a href="https://departamento.mercadolibre.com.ar/MLA-1877733073-alquiler-departamento-2-ambientes-belgrano-_JM#polycard_client=search-desktop&amp;position=1&amp;type=item&amp;tracking_id=7e131ad0-cfc5-419d-8a43-adfbd45ce24f&amp;sid=search" class="poly-component__title">Alquiler departamento 2 ambientes Belgrano</a></div></li>
<li class="ui-search-layout__item"><div class="poly-card"><a href="https://departamento.mercadolibre.com.ar/MLA-1879142141-alquiler-departamento-3-amb-liniers-capital-federal-_JM#polycard_client=search-desktop&amp;position=2&amp;type=item&amp;sid=search" class="poly-component__title">Alquiler departamento 3 amb Liniers</a></div></li>
<li class="ui-search-layout__item"><div class="poly-card"><a href="https://departamento.mercadolibre.com.ar/MLA-1877732195-alquiler-departamento-2-ambientes-y-medio-congreso-_JM#polycard_client=search-desktop&amp;position=3&amp;type=item&amp;sid=search" class="poly-component__title">Alquiler departamento 2 ambientes Congreso</a></div></li>
<li class="ui-search-layout__item"><div class="poly-card"><a href="https://departamento.mercadolibre.com.ar/MLA-3578126424-departamento-2-ambientes-alquiler-almagro-balcon-_JM#polycard_client=search-desktop&amp;position=4&amp;type=item&amp;sid=search" class="poly-component__title">Departamento 2 ambientes alquiler Almagro</a></div></li>
</ol>
</body></html>`;
