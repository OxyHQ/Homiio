/**
 * Recorded OpenRent fixtures (portal-shaped).
 */

export const OPENRENT_BASE_URL = 'https://www.openrent.co.uk';

export const OPENRENT_FIXTURE_SEARCH_HTML = `<!doctype html>
<html>
<body>
<a href="/property-to-rent/london/1-bed-flat-london-wc2n/2865841">Flat</a>
<a href="/property-to-rent/london/studio-flat-craven-street-wc2n/2870098">Studio</a>
<a href="/landlords-advertise-property-for-rent-on-rightmove-and-zoopla">ads</a>
</body>
</html>`;

/**
 * Recorded from a live OpenRent detail page, condensed to the load-bearing
 * structure: the rent/beds `<title>`, the `text-secondary-emphasis` summary
 * strip (bedrooms + bathrooms), the `lightbox_item` gallery with
 * PROTOCOL-RELATIVE `//imagescdn.openrent.co.uk/listings/<set>/…` photos (the
 * property's own set THEN a "similar properties" set that must be excluded), the
 * `#descriptionText` copy carrying a free-text floor area (`721sq ft`) and the
 * `tel:`/`mailto:` contact. og:image is intentionally absent so the gallery is
 * the only image source.
 */
export const OPENRENT_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="en-GB">
<head>
<title>London - 1 Bed Flat, London, WC2N - To Rent Now for &#xA3;2,750.00 p/m</title>
<link rel="canonical" href="https://www.openrent.co.uk/property-to-rent/london/1-bed-flat-london-wc2n/2865841"/>
</head>
<body>
<h1>1 Bed Flat, London, WC2N</h1>
<ul class="property-stats">
<li><span class="text-secondary-emphasis">1 <span class="d-none d-md-inline">bedrooms</span></span></li>
<li><span class="text-secondary-emphasis">1 <span class="d-none d-md-inline">bathrooms</span></span></li>
<li><span class="text-secondary-emphasis">1 <span class="d-none d-md-inline">tenant max.</span></span></li>
</ul>
<div data-lightbox-gallery data-lightbox-children=".lightbox_item">
<div class="swiper">
<a href="//imagescdn.openrent.co.uk/listings/2493409/o_1j5ggi22phduo1aab0geueid0.JPG" class="lightbox_item"><img src="//imagescdn.openrent.co.uk/listings/2493409/o_1j5ggi22phduo1aab0geueid0.JPG" class="img-fluid w-100" alt=""/></a>
<a href="//imagescdn.openrent.co.uk/listings/2493409/o_1j5eq9icn1unn11i3n3ptpi4uf1.JPG" class="lightbox_item"><img loading=lazy src="//imagescdn.openrent.co.uk/listings/2493409/o_1j5eq9icn1unn11i3n3ptpi4uf1.JPG" class="img-fluid w-100" alt=""/></a>
<a href="//imagescdn.openrent.co.uk/listings/2493409/o_1j5eq9hp21h9gc41p381jcc1l7u0.JPG" class="lightbox_item"><img loading=lazy src="//imagescdn.openrent.co.uk/listings/2493409/o_1j5eq9hp21h9gc41p381jcc1l7u0.JPG" class="img-fluid w-100" alt=""/></a>
</div>
</div>
<div id="descriptionText" class="description-text position-relative overflow-hidden">
<p>A modern and contemporary one bedroom flat with lovely views from its own private balcony. 721sq ft. Located in the heart of the West End, moments from Charing Cross.</p>
</div>
<section class="similar-properties"><div data-lightbox-gallery>
<a href="//imagescdn.openrent.co.uk/listings/2434489/o_1inrcjgq0o53kah1tg4l0c19kic.JPG" class="lightbox_item"><img loading=lazy src="//imagescdn.openrent.co.uk/listings/2434489/o_1inrcjgq0o53kah1tg4l0c19kic.JPG" class="img-fluid" alt=""/></a>
<a href="//imagescdn.openrent.co.uk/listings/2434489/o_1inrcjh5b1abc12de34fg5hi6jk7.JPG" class="lightbox_item"><img loading=lazy src="//imagescdn.openrent.co.uk/listings/2434489/o_1inrcjh5b1abc12de34fg5hi6jk7.JPG" class="img-fluid" alt=""/></a>
</div></section>
<a href="tel:02071234567">Call</a>
<a href="mailto:landlord@example.com">Email</a>
</body>
</html>`;
