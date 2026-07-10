/**
 * Recorded pisos.com fixtures (portal-shaped, hand-authored).
 *
 * Search pages ship schema.org JSON-LD for each card; detail pages embed a
 * `data-var` JSON blob (rooms/baths/m²/phone) plus a tracking JSON object with
 * price/operation. Image URLs point at example CDN hosts and are re-hosted at
 * ingest — never hotlinked at runtime.
 */

export const PISOS_BASE_URL = 'https://www.pisos.com';

/** Search-results page with three JSON-LD residence cards. */
export const PISOS_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="es"><head><title>Pisos en alquiler en Madrid</title></head><body>
<script type="application/ld+json">
{"@context":"https://schema.org/","@type":"SingleFamilyResidence","@id":"20026385030.992099","image":"https://fotos.imghs.net/example/1.jpg","name":"Piso en calle Mayor, 45","description":"Piso en calle Mayor, 45","url":"/alquilar/piso-sol_barrio28012-20026385030_992099/","address":{"@type":"PostalAddress","addressLocality":"Madrid Capital","addressRegion":"Madrid","addressCountry":{"@type":"Country","name":"ES"}},"geo":{"@type":"GeoCoordinates","latitude":"40.4159","longitude":"-3.7084"}}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org/","@type":"Apartment","@id":"65072508446.519513","image":"https://fotos.imghs.net/example/2.jpg","name":"Piso en calle de Ponzano","url":"/alquilar/piso-chamberi_almagro28010-65072508446_519513/","address":{"@type":"PostalAddress","addressLocality":"Madrid Capital","addressRegion":"Madrid","addressCountry":{"@type":"Country","name":"ES"}},"geo":{"@type":"GeoCoordinates","latitude":"40.433","longitude":"-3.698"}}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org/","@type":"House","@id":"61688075258.280500","image":"https://fotos.imghs.net/example/3.jpg","name":"Chalet en Prado","url":"/alquilar/chalet-prado-61688075258_280500/","address":{"@type":"PostalAddress","addressLocality":"Pozuelo de Alarcón","addressRegion":"Madrid","addressCountry":{"@type":"Country","name":"ES"}}}
</script>
</body></html>`;

/** Detail page with embedded JSON blobs (price + contact phone) + location map coords. */
export const PISOS_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="es"><head><title>Piso en alquiler en Calle Mayor, 45</title></head><body>
<input id="hdnIdPiso" name="hdnIdPiso" type="hidden" value="20026385030.992099" />
<h1>Piso en alquiler en Calle Mayor, 45, cerca de Calle de Ciudad Rodrigo</h1>
<div class="ascending-geo__row" data-zone="P00000000000028" data-ga-geoLevelName='provincia' property="itemListElement" typeof="ListItem">
<a href="/alquiler/piso-madrid/" class="ascending-geo__result" property="item" typeof="WebPage"><span property="name">Madrid</span></a>
</div>
<div class="ascending-geo__row" data-zone="M00000000028079" data-ga-geoLevelName='municipio' property="itemListElement" typeof="ListItem">
<a href="/alquiler/piso-madrid_capital/" class="ascending-geo__result" property="item" typeof="WebPage"><span property="name">Madrid Capital</span></a>
</div>
<div data-var='{"fechaModificacion":"17/06/2026","fechaPrimeraPublicacion":"04/05/2026","telefono":"919376345","caracteristicasInmueble":"ascensor,balcon,soleado","nHabitaciones":"2","nBanios":"2","superficieInmueble":"107","descuentoAplicado":"8"}'></div>
<div class="locationmap" data-params="latitude=40.41593545782718&amp;longitude=-3.7083892232908435&amp;zoom=17&amp;showMarker=True"></div>
<script>
window.__pisosTrack = {"tipoContenido":"detalle","tipoOperacion":"alquiler","seccion":"alquiler","idioma":"ES","subseccion1":"casas-pisos","tipoContenidoA":"detalle-casas-pisos","provincia":"P00000000000028","municipio":"M00000000028079","distrito":"G00000002807901","precioInmueble":"2550","precio":"2550","tipoVendedor":"profesional","referenciaInmueble":"","marca":"196080","tipoInmueble":"casas-pisos","subTipoInmueble":"piso-apartamento"};
var precio = 2550;
</script>
<img src="https://fotos.imghs.net/example/20026385030/1.jpg" />
<img src="https://fotos.imghs.net/example/20026385030/2.jpg" />
<p class="description">Piso luminoso junto a Ópera, 107 m², 2 habitaciones.</p>
</body></html>`;

/** Valladolid detail — no JSON-LD; coords only on the location map widget. */
export const PISOS_FIXTURE_DETAIL_VALLADOLID_HTML = `<!doctype html>
<html lang="es"><head><title>Piso en alquiler en Universidad</title></head><body>
<input id="hdnIdPiso" name="hdnIdPiso" type="hidden" value="65009504308.106400" />
<h1>Piso en alquiler en Universidad</h1>
<div class="ascending-geo__row" data-zone="P00000000000047" data-ga-geoLevelName='provincia' property="itemListElement" typeof="ListItem">
<a href="/alquiler/piso-valladolid/" class="ascending-geo__result" property="item" typeof="WebPage"><span property="name">Valladolid</span></a>
</div>
<div class="ascending-geo__row" data-zone="M00000000047186" data-ga-geoLevelName='municipio' property="itemListElement" typeof="ListItem">
<a href="/alquiler/piso-valladolid_capital/" class="ascending-geo__result" property="item" typeof="WebPage"><span property="name">Valladolid Capital</span></a>
</div>
<div data-var='{"telefono":"883872390","nHabitaciones":"1","nBanios":"1","superficieInmueble":"45"}'></div>
<div class="locationmap" data-params="latitude=41.6531628&amp;longitude=-4.7216201&amp;zoom=16&amp;showMarker=False"></div>
<script>var precio = 650;</script>
<p class="description">Loft con encanto en el casco histórico de valladolid.</p>
</body></html>`;

/** Recorded contact AJAX body from `/WebsiteUserInfo/GetNormalizedPhone`. */
export const PISOS_FIXTURE_CONTACT_JSON = `{"phone":"919376345","normalizedPhone":"+34919376345"}`;
