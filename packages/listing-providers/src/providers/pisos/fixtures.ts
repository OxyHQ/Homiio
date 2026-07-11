/**
 * Recorded pisos.com fixtures (portal-shaped, hand-authored).
 *
 * Search pages ship schema.org JSON-LD for each card; detail pages embed a
 * `data-var` JSON blob (rooms/baths/m²/phone plus optional planta / año de
 * construcción / plazas de garaje) plus a tracking JSON object with
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
<div data-var='{"fechaModificacion":"17/06/2026","fechaPrimeraPublicacion":"04/05/2026","telefono":"919376345","caracteristicasInmueble":"ascensor,balcon,soleado","nHabitaciones":"2","nBanios":"2","superficieInmueble":"107","planta":"3","anioConstruccion":"1998","nPlazasGaraje":"1","descuentoAplicado":"8"}'></div>
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

/**
 * Recorded Picanya (Valencia) detail — the LIVE current template that broke prod
 * ingest. Faithful to captured markup: the tracking payload lives in the
 * `id="vtmExtraVars"` `data-var` blob (`precioInmueble`/`precio`/`tipoOperacion`
 * + rooms/m²), there is NO `window.__pisosTrack` and NO `var precio` line, and
 * the ascending-geo breadcrumb carries only province + comarca — the municipality
 * is a `descending-geo` picker with no `<span property="name">`. So both the
 * price (from `vtmExtraVars`) and the city ("Picanya", from the `<title>`) come
 * from the sources the old parser ignored → the "no resolvable price / city"
 * drops. Coords/ids/names are the real captured values.
 */
export const PISOS_FIXTURE_DETAIL_VTMVARS_HTML = `<!doctype html>
<html lang="es"><head>
<title>Apartamento en alquiler en Carrer de la Senyera en Picanya por 1.200 €/mes</title>
<meta property="og:title" content="Apartamento en alquiler en Carrer de la Senyera en Picanya por 1.200 €/mes" />
</head><body>
<input id="hdnIdPiso" name="hdnIdPiso" type="hidden" value="65071648575.100900" />
<h1>Apartamento en alquiler en Carrer de la Senyera</h1>
<nav class="ascending-geo">
<div class="ascending-geo__row" data-zone="P00000000000046" data-ga-geoLevelName='provincia' property="itemListElement" typeof="ListItem">
<a href="/alquiler/apartamentos-valencia/" class="ascending-geo__result" property="item" typeof="WebPage"><span property="name">València</span></a>
</div>
<div class="ascending-geo__row" data-zone="C00000000000184" data-ga-geoLevelName='comarca' property="itemListElement" typeof="ListItem">
<a href="/alquiler/apartamentos-l_horta_oest/" class="ascending-geo__result" property="item" typeof="WebPage"><span property="name">L'Horta Oest</span></a>
</div>
<span id="levelTypeForAnalytics" data-ga-geoLevelName='municipio'></span>
<div class="descending-geo__row" data-zone="M00000000046193" data-lastlevel=True data-ga-tag="">
<span class="descending-geo__result-box descending-geo__result-box--not-link"><span class="descending-geo__result">Picanya</span></span>
</div>
</nav>
<div id="vtmExtraVars" data-var='{"fechaModificacion":"11/07/2026","fechaPrimeraPublicacion":"01/06/2026","telefono":"961234567","caracteristicasInmueble":"ascensor,terraza,amueblado","nHabitaciones":"3","nBanios":"2","superficieInmueble":"90","tipoContenido":"detalle","tipoOperacion":"alquiler","provincia":"P00000000000046","municipio":"M00000000046193","distrito":"","precioInmueble":"1200","precio":"1200","tipoVendedor":"profesional","tipoInmueble":"casas-pisos","subTipoInmueble":"piso-apartamento"}'></div>
<div id="vtmVars" data-var='{"tipoContenido":"detalle","tipoOperacion":"alquiler","precioInmueble":"1200","precio":"1200","subTipoInmueble":"piso-apartamento"}'></div>
<div class="locationmap" data-params="latitude=39.43443131&amp;longitude=-0.432955807&amp;zoom=16&amp;showMarker=True"></div>
<img src="https://fotos.imghs.net/apps-wp/1009/3635303731363438/photo-a.jpg" />
<p class="description">Apartamento amueblado con terraza y ascensor en Picanya.</p>
</body></html>`;

/**
 * Recorded image block from a live Alboraya (Valencia) detail page. pisos serves
 * every photo under several `fotos.imghs.net` size prefixes: the `xl-wp` /
 * `fch-wp` cover renditions and the `appswm-wp` ("apps watermark") rendition
 * carry the burned-in pisos.com watermark, while `apps-wp` and the gallery
 * `fchm-wp` thumbnails are clean. `prof-wp/logos/…` is the agency logo, not a
 * property photo. The URLs, ordering, and duplication mirror the real markup:
 * the watermarked `xl-wp` cover appears first (it is also the `og:image`), the
 * clean `apps-wp` copy of the same photo second, then the clean `fchm-wp`
 * gallery, with watermarked `appswm-wp` duplicates and the agency logo mixed in.
 */
export const PISOS_FIXTURE_DETAIL_IMAGES_HTML = `<!doctype html>
<html lang="es"><head><title>Piso en alquiler en Avinguda Mare Nostrum</title>
<meta property="og:image" content="https://fotos.imghs.net/xl-wp/1064/3230323630363137/d1e479cd-09f2-4e87-b0ea-5a232c242428.jpg" />
</head><body>
<input id="hdnIdPiso" name="hdnIdPiso" type="hidden" value="65023401382.106400" />
<h1>Piso en alquiler en Avinguda Mare Nostrum</h1>
<div class="ascending-geo__row" data-zone="P00000000000046" data-ga-geoLevelName='provincia' property="itemListElement" typeof="ListItem">
<a href="/alquiler/piso-valencia/" class="ascending-geo__result" property="item" typeof="WebPage"><span property="name">València</span></a>
</div>
<div class="ascending-geo__row" data-zone="M00000000046013" data-ga-geoLevelName='municipio' property="itemListElement" typeof="ListItem">
<a href="/alquiler/piso-alboraya/" class="ascending-geo__result" property="item" typeof="WebPage"><span property="name">Alboraia - Alboraya</span></a>
</div>
<div data-var='{"telefono":"960365571","caracteristicasInmueble":"ascensor,balcon,terraza","nHabitaciones":"2","nBanios":"1","superficieInmueble":"80"}'></div>
<div class="locationmap" data-params="latitude=39.4915&amp;longitude=-0.325534&amp;zoom=17&amp;showMarker=True"></div>
<script>var precio = 1400;</script>
<div class="gallery">
<img src="https://fotos.imghs.net/xl-wp/1064/3230323630363137/d1e479cd-09f2-4e87-b0ea-5a232c242428.jpg" />
<img src="https://fotos.imghs.net/apps-wp/1064/3230323630363137/d1e479cd-09f2-4e87-b0ea-5a232c242428.jpg" />
<img src="https://fotos.imghs.net/fch-wp/1064/3230323630363137/d1e479cd-09f2-4e87-b0ea-5a232c242428.jpg" />
<img src="https://fotos.imghs.net/fchm-wp/1064/3230323630363137/8cb66161-4444-4287-a7cc-efaa714ea86e.jpg" />
<img src="https://fotos.imghs.net/fchm-wp/1064/3230323630363137/5ef76e58-1754-4ad6-9c48-ad35fcbcc5a2.jpg" />
<img src="https://fotos.imghs.net/fchm-wp/1064/3230323630363137/634ed073-0c83-4d9f-8e6a-8c7c46102b06.jpg" />
<img src="https://fotos.imghs.net/appswm-wp/1064/3230323630363137/d1e479cd-09f2-4e87-b0ea-5a232c242428.jpg" />
<img src="https://fotos.imghs.net/appswm-wp/1064/3230323630363137/8cb66161-4444-4287-a7cc-efaa714ea86e.jpg" />
<img src="https://fotos.imghs.net/prof-wp/logos/Logo_518562_20200728111844.jpg" />
<img src="https://fotos.imghs.net/fchm-wp/1064/3230323630363137/8cb66161-4444-4287-a7cc-efaa714ea86e.jpg" />
<img src="https://fotos.imghs.net/apps-wp/1064/3230323630363137/d1e479cd-09f2-4e87-b0ea-5a232c242428.jpg" />
</div>
<p class="description">Piso reformado con terraza y vistas al mar en Alboraya.</p>
</body></html>`;

/** Clean gallery the parser must keep from {@link PISOS_FIXTURE_DETAIL_IMAGES_HTML}. */
export const PISOS_FIXTURE_DETAIL_IMAGES_EXPECTED = [
  'https://fotos.imghs.net/apps-wp/1064/3230323630363137/d1e479cd-09f2-4e87-b0ea-5a232c242428.jpg',
  'https://fotos.imghs.net/fchm-wp/1064/3230323630363137/8cb66161-4444-4287-a7cc-efaa714ea86e.jpg',
  'https://fotos.imghs.net/fchm-wp/1064/3230323630363137/5ef76e58-1754-4ad6-9c48-ad35fcbcc5a2.jpg',
  'https://fotos.imghs.net/fchm-wp/1064/3230323630363137/634ed073-0c83-4d9f-8e6a-8c7c46102b06.jpg',
] as const;

/** Recorded contact AJAX body from `/WebsiteUserInfo/GetNormalizedPhone`. */
export const PISOS_FIXTURE_CONTACT_JSON = `{"phone":"919376345","normalizedPhone":"+34919376345"}`;
