/**
 * Recorded Zoopla fixtures (portal-shaped). Live Zoopla is Cloudflare-gated;
 * fixtures exercise parse → normalize without network.
 */

export const ZOOPLA_BASE_URL = 'https://www.zoopla.co.uk';

export const ZOOPLA_FIXTURE_SEARCH_HTML = `<!doctype html>
<html>
<body>
<a href="https://www.zoopla.co.uk/to-rent/details/68451234/">2 bed flat</a>
<a href="https://www.zoopla.co.uk/to-rent/details/68451235/">Garage</a>
</body>
</html>`;

export const ZOOPLA_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="en-GB">
<head><title>2 bed flat to rent</title>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"listingDetails":{
  "listingId":"68451234",
  "listingStatus":"rent",
  "propertyType":"Flat",
  "title":"2 bed flat to rent",
  "summary":"Bright flat near the station.",
  "description":"A bright two bedroom flat.",
  "numBedrooms":2,
  "numBathrooms":1,
  "pricing":{"price":2200},
  "displayAddress":"Camden High Street, London, NW1",
  "location":{"latitude":51.539,"longitude":-0.142},
  "images":[{"url":"https://lid.zoocdn.com/645/430/example.jpg"}],
  "branch":{"name":"Zoopla Test Agency","telephone":"020 7946 0958","email":"agency@example.com"}
}}}}
</script>
</head>
<body></body>
</html>`;
