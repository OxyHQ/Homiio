package com.homiio.widgets.listings

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The parsing and store rules, on a plain JVM.
 *
 * The fixture below is a REDUCTION of a real `GET /api/properties/search` response, not an
 * invention: the field names, the nesting (`longTermRent.monthlyAmount`,
 * `address.neighborhoodName`, `images[].urls.medium`) and the values are taken from the
 * live endpoint, which is what makes these tests evidence about the contract rather than
 * about themselves.
 */
class ListingsModelTest {

    private fun listingJson(
        id: String = "6a648fb7b5ffe7efdb4d8f19",
        amount: Any? = 3000,
        currency: String = "EUR",
        neighbourhood: String = "Quintana",
        street: String = "Madrid",
        city: String = "Madrid",
        bedrooms: Int = 3,
        bathrooms: Int = 3,
        squareFootage: Int = 175,
        withImages: Boolean = true,
        source: String = "fotocasa",
    ): JSONObject = JSONObject().apply {
        put("_id", id)
        if (amount != null) {
            put("longTermRent", JSONObject().put("monthlyAmount", amount).put("currency", currency))
        }
        put(
            "address",
            JSONObject()
                .put("neighborhoodName", neighbourhood)
                .put("street", street)
                .put("cityName", city),
        )
        put("bedrooms", bedrooms)
        put("bathrooms", bathrooms)
        put("squareFootage", squareFootage)
        put("source", source)
        if (withImages) {
            put(
                "images",
                JSONArray().put(
                    JSONObject()
                        .put("url", "https://api.homiio.com/api/images/file/property/a-medium.webp")
                        .put(
                            "urls",
                            JSONObject()
                                .put("original", "https://api.homiio.com/api/images/file/property/a-original.jpeg")
                                .put("small", "https://api.homiio.com/api/images/file/property/a-small.webp")
                                .put("medium", "https://api.homiio.com/api/images/file/property/a-medium.webp"),
                        ),
                ),
            )
        }
    }

    private fun responseOf(vararg listings: JSONObject): String =
        JSONObject().put("data", JSONArray().apply { listings.forEach { put(it) } }).toString()

    @Test
    fun `reads the fields the card draws from a real response shape`() {
        val parsed = parseListingsResponse(responseOf(listingJson()))

        assertEquals(1, parsed.size)
        val listing = parsed.single()
        assertEquals("6a648fb7b5ffe7efdb4d8f19", listing.id)
        assertEquals(3000L, listing.monthlyAmount)
        assertEquals("EUR", listing.currency)
        assertEquals("Quintana, Madrid", listing.place)
        assertEquals(3, listing.bedrooms)
        assertEquals(3, listing.bathrooms)
        assertEquals(175, listing.squareMetres)
        assertEquals(
            "https://api.homiio.com/api/images/file/property/a-medium.webp",
            listing.imageUrl,
        )
        assertEquals("fotocasa", listing.source)
    }

    @Test
    fun `drops a listing with no id`() {
        assertTrue(parseListingsResponse(responseOf(listingJson(id = ""))).isEmpty())
    }

    /**
     * The price rule, in all three shapes it arrives in. A card that cannot name the rent
     * is asking the reader to open the app for the one thing they wanted to know.
     */
    @Test
    fun `drops a listing with no usable price`() {
        assertTrue(parseListingsResponse(responseOf(listingJson(amount = null))).isEmpty())
        assertTrue(parseListingsResponse(responseOf(listingJson(amount = 0))).isEmpty())
        assertTrue(parseListingsResponse(responseOf(listingJson(amount = -100))).isEmpty())
    }

    @Test
    fun `keeps a listing that is only missing optional parts`() {
        val parsed = parseListingsResponse(
            responseOf(
                listingJson(
                    neighbourhood = "",
                    street = "",
                    city = "",
                    bedrooms = 0,
                    bathrooms = 0,
                    squareFootage = 0,
                    withImages = false,
                    source = "",
                ),
            ),
        )

        val listing = parsed.single()
        assertEquals("", listing.place)
        assertEquals(0, listing.bedrooms)
        assertNull(listing.imageUrl)
        assertEquals("", listing.source)
    }

    @Test
    fun `never returns more than the limit asked for`() {
        val body = responseOf(*Array(10) { listingJson(id = "id-$it") })

        assertEquals(ROTATION_LENGTH, parseListingsResponse(body).size)
        assertEquals(2, parseListingsResponse(body, limit = 2).size)
    }

    @Test
    fun `a dropped listing does not consume a place in the rotation`() {
        val body = responseOf(
            listingJson(id = "keep-1"),
            listingJson(id = "", amount = 1200),
            listingJson(id = "keep-2"),
        )

        assertEquals(listOf("keep-1", "keep-2"), parseListingsResponse(body).map { it.id })
    }

    @Test
    fun `place prefers the neighbourhood and never repeats the city`() {
        assertEquals("Quintana, Madrid", choosePlace("Quintana", "Madrid", "Madrid"))
        assertEquals("Barri de les Corts, Barcelona", choosePlace("Barri de les Corts", "Barcelona", "Barcelona"))
        // No neighbourhood, and the street is the city again — the shape most ingested
        // listings actually arrive in.
        assertEquals("Madrid", choosePlace("", "Madrid", "Madrid"))
        // A genuine street survives.
        assertEquals("Carrer de Sants, Barcelona", choosePlace("", "Carrer de Sants", "Barcelona"))
        // Case and padding differ between the two fields; they still mean the same place.
        assertEquals("Madrid", choosePlace("", "  madrid ", "Madrid"))
        assertEquals("Gràcia", choosePlace("Gràcia", "", ""))
        assertEquals("", choosePlace("", "", ""))
    }

    @Test
    fun `image prefers the medium variant and falls back in order`() {
        val full = JSONArray().put(
            JSONObject().put("url", "bare").put(
                "urls",
                JSONObject().put("small", "small").put("medium", "medium"),
            ),
        )
        assertEquals("medium", chooseImageUrl(full))

        val smallOnly = JSONArray().put(
            JSONObject().put("url", "bare").put("urls", JSONObject().put("small", "small")),
        )
        assertEquals("small", chooseImageUrl(smallOnly))

        val bareOnly = JSONArray().put(JSONObject().put("url", "bare"))
        assertEquals("bare", chooseImageUrl(bareOnly))

        assertNull(chooseImageUrl(JSONArray()))
        assertNull(chooseImageUrl(null))
    }

    @Test
    fun `the store round trip preserves everything the card draws`() {
        val listings = parseListingsResponse(
            responseOf(listingJson(), listingJson(id = "second", withImages = false, source = "")),
        )

        assertEquals(listings, decodeListings(encodeListings(listings)))
    }

    /**
     * A corrupted or older blob has to degrade to the first-run state rather than throw:
     * this decode runs inside a composition the launcher is waiting on.
     */
    @Test
    fun `an unreadable store decodes to an empty rotation`() {
        assertTrue(decodeListings(null).isEmpty())
        assertTrue(decodeListings("").isEmpty())
        assertTrue(decodeListings("not json at all").isEmpty())
        assertTrue(decodeListings("""[{"id":"","amount":1200}]""").isEmpty())
        assertTrue(decodeListings("""[{"id":"x","amount":0}]""").isEmpty())
    }

    @Test
    fun `a rotation index outside the list is brought back into range`() {
        val listings = parseListingsResponse(responseOf(listingJson(id = "a"), listingJson(id = "b")))

        assertEquals("a", listingAt(listings, 0)?.id)
        assertEquals("b", listingAt(listings, 1)?.id)
        // The rotation shrank under a stored index that outlived it.
        assertEquals("a", listingAt(listings, 2)?.id)
        // A negative index — a wrapped Int, or a corrupted preference — must not index
        // out of bounds.
        assertEquals("b", listingAt(listings, -1)?.id)
        assertNull(listingAt(emptyList(), 3))
    }

    @Test
    fun `advancing stays inside the rotation forever`() {
        assertEquals(1, nextRotationIndex(0, 3))
        assertEquals(0, nextRotationIndex(2, 3))
        // Normalised BEFORE the increment, so a stored value that has drifted far past the
        // end comes straight back rather than climbing towards Int.MAX_VALUE.
        assertEquals(0, nextRotationIndex(Int.MAX_VALUE - 1, 1))
        assertEquals(0, nextRotationIndex(5, 0))
        assertEquals(2, normalizeRotationIndex(-1, 3))
    }
}
