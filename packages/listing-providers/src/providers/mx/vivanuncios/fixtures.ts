/**
 * Vivanuncios Mexico fixtures — general classifieds, HOUSING ONLY.
 *
 * Discover must hit `s-departamentos-en-renta` / `s-casas-en-renta` category
 * URLs only — never site-wide crawl. Car/non-housing fixtures exist so parsers
 * can prove rejection.
 */

export const VIVANUNCIOS_BASE_URL = 'https://www.vivanuncios.com.mx';

/**
 * Allowlisted path slugs for discover + detail URL guards.
 * Search categories are the discover surface; `a-*` tokens cover detail pages.
 */
export const VIVANUNCIOS_HOUSING_SLUGS: ReadonlySet<string> = new Set([
  's-departamentos-en-renta',
  's-casas-en-renta',
  's-departamentos-en-venta',
  's-casas-en-venta',
  'a-renta-departamento',
  'a-renta-casa',
  'a-venta-departamento',
  'a-venta-casa',
]);

/** Housing search SERP with JSON-LD ItemList + detail hrefs. */
export const VIVANUNCIOS_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"item":{"@type":"Apartment","@id":"https://www.vivanuncios.com.mx/a-renta-departamento/ciudad-de-mexico/depto-roma-sur/1847293847","url":"https://www.vivanuncios.com.mx/a-renta-departamento/ciudad-de-mexico/depto-roma-sur/1847293847","name":"Departamento en renta Roma Sur","offers":{"@type":"Offer","price":22000,"priceCurrency":"MXN"},"address":{"@type":"PostalAddress","addressLocality":"Ciudad de México","addressCountry":"MX"},"numberOfBedrooms":2,"numberOfBathroomsTotal":1,"floorSize":{"@type":"QuantitativeValue","value":85},"image":"https://img.vivanuncios.com.mx/fixture-1.jpg"}}]}
</script>
</head><body>
<a href="/a-renta-departamento/ciudad-de-mexico/depto-roma-sur/1847293847">Depto Roma</a>
<a href="/a-renta-casa/ciudad-de-mexico/casa-condesa/1847293848">Casa Condesa</a>
<a href="/a-autos/ciudad-de-mexico/vw-jetta/999000111">Auto (must be ignored)</a>
</body></html>`;

/** Housing detail JSON-LD with contact signals. */
export const VIVANUNCIOS_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Apartment","@id":"https://www.vivanuncios.com.mx/a-renta-departamento/ciudad-de-mexico/depto-roma-sur/1847293847","url":"https://www.vivanuncios.com.mx/a-renta-departamento/ciudad-de-mexico/depto-roma-sur/1847293847","name":"Departamento en renta Roma Sur","description":"Bonito departamento exterior en Roma Sur.","offers":{"@type":"Offer","price":22000,"priceCurrency":"MXN"},"address":{"@type":"PostalAddress","streetAddress":"Calle Huatusco 19","addressLocality":"Ciudad de México","addressRegion":"CDMX","addressCountry":"MX"},"numberOfBedrooms":2,"numberOfBathroomsTotal":1,"floorSize":{"@type":"QuantitativeValue","value":85},"image":["https://img.vivanuncios.com.mx/fixture-1.jpg"],"telephone":"+525512345678","category":"Departamentos en renta"}
</script>
</head><body>
<a href="tel:+525512345678">Llamar</a>
<a href="https://wa.me/525512345678">WhatsApp</a>
</body></html>`;

/** Non-housing (car) detail — normalize / parse must reject. */
export const VIVANUNCIOS_FIXTURE_CAR_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","@id":"https://www.vivanuncios.com.mx/a-autos/ciudad-de-mexico/vw-jetta/999000111","url":"https://www.vivanuncios.com.mx/a-autos/ciudad-de-mexico/vw-jetta/999000111","name":"VW Jetta 2018","description":"Auto usado","offers":{"@type":"Offer","price":185000,"priceCurrency":"MXN"},"address":{"@type":"PostalAddress","addressLocality":"Ciudad de México","addressCountry":"MX"},"category":"Autos","telephone":"+525598765432"}
</script>
</head><body><a href="/a-autos/ciudad-de-mexico/vw-jetta/999000111">VW Jetta</a></body></html>`;
