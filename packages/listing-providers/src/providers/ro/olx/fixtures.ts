/**
 * Recorded OLX.ro imobiliare fixtures (housing category only).
 */

export const OLX_RO_BASE_URL = 'https://www.olx.ro';

/** Housing search page with `/d/oferta/…-ID….html` links. */
export const OLX_RO_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="ro">
<body>
<a href="/d/oferta/apartament-3-camere-68-mp-bloc-nou-IDj4PJt.html">Apartament 3 camere</a>
<a href="/d/oferta/apartament-2-camere-dorobanti-IDkGrDt.html">Apartament 2 camere</a>
<a href="/d/oferta/loc-de-munca-bucatar-IDxxxx1.html">Job (must be ignored by category URLs)</a>
</body>
</html>`;

/** Housing detail `__PRERENDERED_STATE__` (escaped JSON string, portal-shaped). */
export const OLX_RO_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="ro">
<body>
<script>
window.__PRERENDERED_STATE__= "{\\"ad\\":{\\"ad\\":{\\"id\\":281902559,\\"title\\":\\"Apartament 3 camere, 68 mp\\",\\"description\\":\\"Apartament nou in Sectorul 2.\\",\\"url\\":\\"https://www.olx.ro/d/oferta/apartament-3-camere-68-mp-bloc-nou-IDj4PJt.html\\",\\"price\\":{\\"regularPrice\\":{\\"value\\":112500,\\"currencyCode\\":\\"EUR\\"}},\\"params\\":[{\\"key\\":\\"m\\",\\"normalizedValue\\":\\"68\\"},{\\"key\\":\\"rooms\\",\\"normalizedValue\\":\\"3\\"},{\\"key\\":\\"floor\\",\\"normalizedValue\\":\\"fl_1\\"}],\\"photos\\":[\\"https://example.cdn/olx/281902559-1.jpg\\"],\\"location\\":{\\"cityName\\":\\"Bucuresti\\",\\"regionName\\":\\"Bucuresti - Ilfov\\",\\"districtName\\":\\"Sectorul 2\\"},\\"category\\":{\\"id\\":1167,\\"type\\":\\"real_estate\\"},\\"contact\\":{\\"chat\\":true,\\"name\\":\\"Agent Test\\",\\"phone\\":true},\\"user\\":{\\"name\\":\\"Agent Test\\",\\"company_name\\":\\"Ramis Steel Company\\"}}}}";
</script>
</body>
</html>`;

/** Non-housing fixture — normalize must reject. */
export const OLX_RO_FIXTURE_NON_HOUSING_HTML = `<!doctype html>
<html lang="ro">
<body>
<script>
window.__PRERENDERED_STATE__= "{\\"ad\\":{\\"ad\\":{\\"id\\":111,\\"title\\":\\"Masina second hand\\",\\"url\\":\\"https://www.olx.ro/d/oferta/masina-IDcar1.html\\",\\"price\\":{\\"regularPrice\\":{\\"value\\":5000,\\"currencyCode\\":\\"EUR\\"}},\\"category\\":{\\"id\\":5,\\"type\\":\\"automotive\\"},\\"location\\":{\\"cityName\\":\\"Bucuresti\\"}}}}";
</script>
</body>
</html>`;
