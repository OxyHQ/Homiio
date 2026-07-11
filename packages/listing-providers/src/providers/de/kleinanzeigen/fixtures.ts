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

/** Non-housing detail (cars) — normalize must reject. */
export const KLEINANZEIGEN_FIXTURE_NON_HOUSING_HTML = `<!doctype html>
<html lang="de">
<head>
<meta property="og:title" content="BMW 320i zu verkaufen" />
<meta property="og:url" content="https://www.kleinanzeigen.de/s-anzeige/bmw-320i/1111222333-216-3331" />
</head>
<body><div id="viewad-price">12.000 €</div></body>
</html>`;
