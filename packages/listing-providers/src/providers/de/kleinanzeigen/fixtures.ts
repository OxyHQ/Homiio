/**
 * Recorded Kleinanzeigen fixtures (housing-only, hand-authored).
 *
 * Kleinanzeigen is a general classifieds portal — fixtures model the
 * immobilien category (c203 Wohnung mieten) only. Non-housing categories must
 * be rejected by the parser/normalize path.
 */

export const KLEINANZEIGEN_BASE_URL = 'https://www.kleinanzeigen.de';

/** Housing category ids allowed for discover/normalize. */
export const KLEINANZEIGEN_HOUSING_CATEGORY_IDS: ReadonlySet<string> = new Set([
  '203', // Wohnung mieten
  '205', // Haus mieten
  '207', // Haus kaufen
  '208', // Wohnung kaufen
  '199', // WG-Zimmer (room rentals — housing)
]);

export const KLEINANZEIGEN_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="de"><body>
<article>
  <a href="/s-anzeige/helle-2-zimmer-wohnung-in-mitte/3367000001-203-3331">Helle 2-Zimmer</a>
  <a href="/s-anzeige/dachgeschoss-prenzlauer-berg/3367000002-203-3331">Dachgeschoss</a>
  <a href="/s-anzeige/bmw-320i-zu-verkaufen/1111222333-216-3331">Car (must be ignored by housing filter on normalize)</a>
</article>
</body></html>`;

export const KLEINANZEIGEN_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="de">
<head>
<meta property="og:title" content="Helle 2-Zimmer-Wohnung in Mitte" />
<meta property="og:description" content="Schöne Wohnung mit Balkon in Berlin-Mitte." />
<meta property="og:url" content="https://www.kleinanzeigen.de/s-anzeige/helle-2-zimmer-wohnung-in-mitte/3367000001-203-3331" />
<meta property="og:image" content="https://img.kleinanzeigen.de/api/v1/prod-ads/images/aa/example-1?rule=$_59.JPG" />
<meta property="og:latitude" content="52.531" />
<meta property="og:longitude" content="13.401" />
<meta property="og:locality" content="Mitte" />
<meta property="og:region" content="Berlin" />
<meta property="og:type" content="product" />
<title>Helle 2-Zimmer-Wohnung in Mitte | Wohnung mieten</title>
</head>
<body>
<div class="galleryimage-large">
  <img id="viewad-image" class="galleryimage-element current" data-imgsrc="https://img.kleinanzeigen.de/api/v1/prod-ads/images/aa/example-1?rule=$_57.AUTO" />
  <img id="viewad-image" class="galleryimage-element" data-imgsrc="https://img.kleinanzeigen.de/api/v1/prod-ads/images/bb/example-2?rule=$_57.AUTO" />
  <img id="viewad-image" class="galleryimage-element" data-imgsrc="https://img.kleinanzeigen.de/api/v1/prod-ads/images/cc/example-3?rule=$_59.AUTO" />
</div>
<div class="boxedarticle--price" id="viewad-price">1.250 €</div>
<ul>
  <li class="addetailslist--detail">Wohnfläche<span class="addetailslist--detail--value">65 m²</span></li>
  <li class="addetailslist--detail">Zimmer<span class="addetailslist--detail--value">2</span></li>
  <li class="addetailslist--detail">Etage<span class="addetailslist--detail--value">3</span></li>
</ul>
<a id="viewad-contact-phone" href="tel:+493098765432">+49 30 98765432</a>
<a href="https://wa.me/493098765432">WhatsApp</a>
<span class="userprofile-poster">Privat</span>
</body>
</html>`;

/**
 * Current kleinanzeigen immobilien detail markup (captured 2026-07): the
 * "Ausstattung" feature tags render as `<li class="checktag">`, structured rows
 * (`Badezimmer`, `Baujahr`) sit in the `addetailslist`, and a commercial poster
 * exposes an agency name in the `userprofile-vip` span (phone stays AJAX-gated).
 * Proves amenities + bathrooms + yearBuilt + agency-contact extraction.
 */
export const KLEINANZEIGEN_FIXTURE_DETAIL_ENRICHED_HTML = `<!doctype html>
<html lang="de">
<head>
<meta property="og:title" content="Modernes Apartment im vielseitigen Stadtquartier" />
<meta property="og:description" content="Neubau-Erstbezug mit Balkon und Einbauküche in Berlin-Spandau." />
<meta property="og:url" content="https://www.kleinanzeigen.de/s-anzeige/modernes-apartment/3382686830-203-3436" />
<meta property="og:image" content="https://img.kleinanzeigen.de/api/v1/prod-ads/images/aa/enriched-1?rule=$_59.JPG" />
<meta property="og:latitude" content="52.535" />
<meta property="og:longitude" content="13.200" />
<meta property="og:locality" content="Spandau" />
<meta property="og:region" content="Berlin" />
<meta property="og:type" content="product" />
<title>Modernes Apartment | Wohnung mieten</title>
</head>
<body>
<div class="galleryimage-large">
  <img id="viewad-image" data-imgsrc="https://img.kleinanzeigen.de/api/v1/prod-ads/images/aa/enriched-1?rule=$_57.AUTO" />
  <img id="viewad-image" data-imgsrc="https://img.kleinanzeigen.de/api/v1/prod-ads/images/bb/enriched-2?rule=$_57.AUTO" />
</div>
<div class="boxedarticle--price" id="viewad-price">890 €</div>
<ul class="addetailslist">
  <li class="addetailslist--detail">Wohnfläche<span class="addetailslist--detail--value" >38,16 m²</span></li>
  <li class="addetailslist--detail">Zimmer<span class="addetailslist--detail--value" >1</span></li>
  <li class="addetailslist--detail">Schlafzimmer<span class="addetailslist--detail--value" >1</span></li>
  <li class="addetailslist--detail">Badezimmer<span class="addetailslist--detail--value" >1</span></li>
  <li class="addetailslist--detail">Etage<span class="addetailslist--detail--value" >1</span></li>
  <li class="addetailslist--detail">Baujahr<span class="addetailslist--detail--value" >2019</span></li>
  <li class="addetailslist--detail">Wohnungstyp<span class="addetailslist--detail--value" >Etagenwohnung</span></li>
</ul>
<ul class="checktaglist">
  <li class="checktag">Balkon</li>
  <li class="checktag">Einbauküche</li>
  <li class="checktag">Stufenloser Zugang</li>
  <li class="checktag">Fußbodenheizung</li>
  <li class="checktag">Neubau</li>
  <li class="checktag">Aufzug</li>
</ul>
<a class="bizteaser--logo" aria-label="Logo von Müller Merkle Immobilien GmbH" href="/pro/mueller-merkle-immobilien-gmbh"></a>
<i class="iconlist-icon-big"><span class="badge user-profile-vip-badge">MM</span></i>
<span class="text-body-regular-strong text-force-linebreak userprofile-vip">Müller Merkle Immobilien - Michelle Steiger</span>
</body>
</html>`;

/** Non-housing detail (cars) — normalize must reject. */
export const KLEINANZEIGEN_FIXTURE_NON_HOUSING_HTML = `<!doctype html>
<html lang="de">
<head>
<meta property="og:title" content="BMW 320i zu verkaufen" />
<meta property="og:url" content="https://www.kleinanzeigen.de/s-anzeige/bmw-320i/1111222333-216-3331" />
</head>
<body><div id="viewad-price">12.000 €</div></body>
</html>`;
