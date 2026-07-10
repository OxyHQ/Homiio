/**
 * Recorded Zoopla fixtures (portal-shaped). Live Zoopla is Cloudflare-gated;
 * fixtures exercise parse → normalize without network.
 */
export declare const ZOOPLA_BASE_URL = "https://www.zoopla.co.uk";
export declare const ZOOPLA_FIXTURE_SEARCH_HTML = "<!doctype html>\n<html>\n<body>\n<a href=\"https://www.zoopla.co.uk/to-rent/details/68451234/\">2 bed flat</a>\n<a href=\"https://www.zoopla.co.uk/to-rent/details/68451235/\">Garage</a>\n</body>\n</html>";
export declare const ZOOPLA_FIXTURE_DETAIL_HTML = "<!doctype html>\n<html lang=\"en-GB\">\n<head><title>2 bed flat to rent</title>\n<script id=\"__NEXT_DATA__\" type=\"application/json\">\n{\"props\":{\"pageProps\":{\"listingDetails\":{\n  \"listingId\":\"68451234\",\n  \"listingStatus\":\"rent\",\n  \"propertyType\":\"Flat\",\n  \"title\":\"2 bed flat to rent\",\n  \"summary\":\"Bright flat near the station.\",\n  \"description\":\"A bright two bedroom flat.\",\n  \"numBedrooms\":2,\n  \"numBathrooms\":1,\n  \"pricing\":{\"price\":2200},\n  \"displayAddress\":\"Camden High Street, London, NW1\",\n  \"location\":{\"latitude\":51.539,\"longitude\":-0.142},\n  \"images\":[{\"url\":\"https://lid.zoocdn.com/645/430/example.jpg\"}],\n  \"branch\":{\"name\":\"Zoopla Test Agency\",\"telephone\":\"020 7946 0958\",\"email\":\"agency@example.com\"}\n}}}}\n</script>\n</head>\n<body></body>\n</html>";
