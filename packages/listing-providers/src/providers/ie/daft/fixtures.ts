/** Recorded Daft.ie fixtures for unit tests (portal-shaped, hand-authored). */

export const DAFT_BASE_URL = 'https://www.daft.ie';

export const DAFT_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="en">
<head><title>Property to Rent in Dublin | Daft.ie</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "listings": {
        "0": {
          "listing": {
            "id": 6157730,
            "title": "Liberties House, The Liberties, Dublin 8",
            "category": "Rent",
            "price": "€1,850 per month",
            "numBedrooms": "1 bed",
            "propertyType": "Apartment",
            "seoFriendlyPath": "/for-rent/liberties-house-the-liberties-dublin-8/6157730",
            "point": { "type": "Point", "coordinates": [-6.277, 53.343] },
            "seller": {
              "name": "Test Agent",
              "branch": "Daft Test Agency",
              "sellerType": "BRANDED_AGENT"
            },
            "media": {
              "images": [
                { "size720x480": "https://media.daft.ie/example/listing-6157730.jpg" }
              ]
            }
          }
        },
        "1": {
          "listing": {
            "id": 7001001,
            "title": "Apartment for Sale, Dublin 4",
            "category": "Sale",
            "price": "€425,000",
            "numBedrooms": "2 bed",
            "propertyType": "Apartment",
            "seoFriendlyPath": "/for-sale/apartment-dublin-4/7001001",
            "point": { "type": "Point", "coordinates": [-6.23, 53.33] },
            "media": {
              "images": [
                { "size720x480": "https://media.daft.ie/example/listing-7001001.jpg" }
              ]
            }
          }
        }
      }
    }
  }
}
</script>
</body>
</html>`;

export const DAFT_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="en">
<head><title>Liberties House | Daft.ie</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "listing": {
        "id": 6157730,
        "title": "Liberties House, The Liberties, Dublin 8",
        "category": "Rent",
        "price": "€1,850 per month",
        "numBedrooms": "1 bed",
        "propertyType": "Apartment",
        "description": "Bright one-bedroom apartment in Dublin 8.",
        "seoFriendlyPath": "/for-rent/liberties-house-the-liberties-dublin-8/6157730",
        "point": { "type": "Point", "coordinates": [-6.277, 53.343] },
        "seller": {
          "name": "Test Agent",
          "branch": "Daft Test Agency",
          "sellerType": "BRANDED_AGENT"
        },
        "media": {
          "images": [
            { "size1440x960": "https://media.daft.ie/example/listing-6157730-large.jpg" }
          ]
        }
      }
    }
  }
}
</script>
</body>
</html>`;
