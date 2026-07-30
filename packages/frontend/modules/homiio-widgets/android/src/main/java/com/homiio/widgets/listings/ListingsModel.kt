package com.homiio.widgets.listings

import org.json.JSONArray
import org.json.JSONObject

/**
 * The listings widget's DATA RULES — reading `GET /api/properties/search` into the handful
 * of fields a card draws, and back out of the store again.
 *
 * Everything here is pure, so all of it is unit-tested on a plain JVM. It is written
 * against the LIVE endpoint rather than against the type definitions: of twenty
 * consecutive long-term-rent listings, all twenty carried an id, a monthly amount and at
 * least one photograph, every price was in EUR, and the finest-grained place name was the
 * neighbourhood (`Quintana`, `Barri de les Corts`) while `street` merely repeated the city.
 * Those observations are what [choosePlace] and the drop rules below are shaped by.
 */

/** One listing, as the widget draws it. */
internal data class WidgetListing(
    /** Homiio property id — the deep-link target, `/properties/<id>`. */
    val id: String,
    /**
     * Monthly rent, in whole units of [currency]. Never absent: a listing whose price
     * cannot be named is dropped, because the price is the whole reason this card is worth
     * a glance.
     */
    val monthlyAmount: Long,
    /** ISO 4217 code the amount is in, e.g. `EUR`. Formatted by [formatMonthlyPrice]. */
    val currency: String,
    /** Where it is, already chosen and joined by [choosePlace]. May be empty. */
    val place: String,
    /** Bedrooms, or `0` when the listing does not state them — see [ListingSpecs]. */
    val bedrooms: Int,
    /** Bathrooms, or `0` when the listing does not state them. */
    val bathrooms: Int,
    /** Floor area in m², or `0` when the listing does not state it. */
    val squareMetres: Int,
    /**
     * Absolute URL of the listing's photograph, or `null` when it has none.
     *
     * `null` is rare on this feed but not an error: the card falls back to its tonal
     * container, which is a design rather than a failure state.
     */
    val imageUrl: String?,
    /**
     * The portal this listing was ingested from (`fotocasa`, `idealista`, …), or empty for
     * a listing published on Homiio itself.
     *
     * Shown as provenance at the largest size. Homiio aggregates public portals as
     * first-party data and the app labels every external listing with its source; the
     * widget says the same thing rather than presenting a portal's listing as its own.
     */
    val source: String,
)

/**
 * Listings held in the store, and therefore the length of the rotation.
 *
 * The widget shows ONE at a time and turns over, so this is how far the rotation runs
 * rather than how much is drawn at once. One listing at a time is a payload decision as
 * much as a design one: several photographs in the same `RemoteViews` is exactly the shape
 * that overruns the Binder transaction and renders a blank widget (see `ListingsBitmaps`).
 */
internal const val ROTATION_LENGTH = 5

/**
 * How many listings the widget ASKS for — exactly the rotation, with no overfetch.
 *
 * Mention's equivalent card asks for thirty and keeps five, because its feed carries a
 * picture on only about a fifth of its posts and the choice of which five to keep needs
 * something to choose from. Neither half of that reasoning applies here: the search
 * endpoint already sorts `hasImages` first, so the first page is the page with
 * photographs, and every one of twenty consecutive listings parsed successfully.
 *
 * The cost of copying the overfetch anyway would be real. This endpoint returns whole
 * property documents — a ~2,000-character description the card never draws, the full
 * address, the amenity list — at roughly 21KB each, and it sends no `content-encoding`, so
 * a page of thirty would be about 630KB over the wire. Measured, not estimated: 110,857
 * bytes for five and 418,666 for twenty.
 */
internal const val FEED_PAGE_LENGTH = ROTATION_LENGTH

private const val FIELD_DATA = "data"
private const val FIELD_ID = "_id"
private const val FIELD_LONG_TERM_RENT = "longTermRent"
private const val FIELD_MONTHLY_AMOUNT = "monthlyAmount"
private const val FIELD_CURRENCY = "currency"
private const val FIELD_ADDRESS = "address"
private const val FIELD_NEIGHBORHOOD_NAME = "neighborhoodName"
private const val FIELD_STREET = "street"
private const val FIELD_CITY_NAME = "cityName"
private const val FIELD_BEDROOMS = "bedrooms"
private const val FIELD_BATHROOMS = "bathrooms"
private const val FIELD_SQUARE_FOOTAGE = "squareFootage"
private const val FIELD_IMAGES = "images"
private const val FIELD_URLS = "urls"
private const val FIELD_MEDIUM = "medium"
private const val FIELD_SMALL = "small"
private const val FIELD_URL = "url"
private const val FIELD_SOURCE = "source"

// Store-only keys. Deliberately short and distinct from the wire names above: what is
// written to disk is the widget's own six fields, not a slice of the response.
private const val STORED_ID = "id"
private const val STORED_AMOUNT = "amount"
private const val STORED_CURRENCY = "currency"
private const val STORED_PLACE = "place"
private const val STORED_BEDROOMS = "bd"
private const val STORED_BATHROOMS = "ba"
private const val STORED_AREA = "m2"
private const val STORED_IMAGE = "image"
private const val STORED_SOURCE = "source"

/**
 * Read `GET /api/properties/search?offering=long_term_rent`.
 *
 * A listing is DROPPED when it has no id or no monthly amount, and for nothing else:
 *
 *  - the ID is the deep-link target, so a card without one is a card that cannot be
 *    opened;
 *  - the PRICE is the card's emphasised element and the reason to glance at it. A listing
 *    card showing a place and a floor area but no rent would be asking the reader to open
 *    the app to learn the one thing they wanted.
 *
 * Everything else is optional and collapses cleanly: no photograph means the tonal
 * container, no place or specs means those lines are simply not drawn.
 *
 * Throws [org.json.JSONException] when the body is not the documented shape; the caller
 * answers for that by keeping whatever it already had.
 */
internal fun parseListingsResponse(body: String, limit: Int = ROTATION_LENGTH): List<WidgetListing> {
    val items = JSONObject(body).getJSONArray(FIELD_DATA)
    return buildList(items.length()) {
        for (index in 0 until items.length()) {
            if (size >= limit) break
            val property = items.optJSONObject(index) ?: continue
            add(readListing(property) ?: continue)
        }
    }
}

private fun readListing(property: JSONObject): WidgetListing? {
    val id = property.optString(FIELD_ID).trim()
    if (id.isEmpty()) return null

    val rent = property.optJSONObject(FIELD_LONG_TERM_RENT) ?: return null
    // `optLong` cannot distinguish an absent key from a zero, and a listing advertised at
    // zero rent is not a price this card should print — so both are dropped by the same
    // check rather than by two.
    val amount = rent.optLong(FIELD_MONTHLY_AMOUNT)
    if (amount <= 0L) return null
    val currency = rent.optString(FIELD_CURRENCY).trim()

    val address = property.optJSONObject(FIELD_ADDRESS)

    return WidgetListing(
        id = id,
        monthlyAmount = amount,
        currency = currency,
        place = choosePlace(
            neighbourhood = address?.optString(FIELD_NEIGHBORHOOD_NAME).orEmpty(),
            street = address?.optString(FIELD_STREET).orEmpty(),
            city = address?.optString(FIELD_CITY_NAME).orEmpty(),
        ),
        bedrooms = property.optInt(FIELD_BEDROOMS).coerceAtLeast(0),
        bathrooms = property.optInt(FIELD_BATHROOMS).coerceAtLeast(0),
        squareMetres = property.optInt(FIELD_SQUARE_FOOTAGE).coerceAtLeast(0),
        imageUrl = chooseImageUrl(property.optJSONArray(FIELD_IMAGES)),
        source = property.optString(FIELD_SOURCE).trim(),
    )
}

/**
 * The place line: the finest-grained locality the listing states, then the city.
 *
 * Taken from what the endpoint actually returns rather than from what the schema allows.
 * On every ingested listing sampled, `neighborhoodName` held the useful part (`Quintana`,
 * `Goya`, `Barri de les Corts`) while `street` held nothing but the city name again —
 * portals rarely publish a street for a rental, and the ingest fills the field with what
 * it has. So:
 *
 *  - the NEIGHBOURHOOD leads where there is one, because "Quintana, Madrid" tells a reader
 *    something "Madrid, Madrid" does not;
 *  - the STREET is the fallback for a listing that genuinely has one;
 *  - and whichever of those two is chosen is DROPPED when it merely repeats the city, which
 *    is the case this rule exists for.
 *
 * Comparison is case- and whitespace-insensitive because the two fields are populated by
 * different code paths and agree only in substance.
 */
internal fun choosePlace(neighbourhood: String, street: String, city: String): String {
    val locality = neighbourhood.trim().ifEmpty { street.trim() }
    val cityName = city.trim()
    if (locality.isEmpty()) return cityName
    if (cityName.isEmpty()) return locality
    if (locality.equals(cityName, ignoreCase = true)) return cityName
    return "$locality, $cityName"
}

/**
 * The card's photograph: the primary image at the variant sized for a widget.
 *
 * `medium` before `small` before the bare `url`. Homiio's image pipeline re-hosts every
 * ingested picture and publishes four variants, and `medium` is the one whose pixels
 * comfortably cover the card's background budget (`cardBackgroundBitmapSize`, 283 × 212)
 * without paying for the original JPEG. `small` is the fallback for an older document that
 * has fewer variants, and `url` — which is itself the medium variant on current documents
 * — is the last resort.
 *
 * The FIRST entry, not a search for `isPrimary`: the ingest writes the images in `order`
 * and the app's own carousel leads with entry zero, so the widget shows the same
 * photograph the app does. Reading `isPrimary` instead would put the widget on a different
 * picture from the listing it links to whenever the two disagreed.
 */
internal fun chooseImageUrl(images: JSONArray?): String? {
    val first = images?.optJSONObject(0) ?: return null
    val variants = first.optJSONObject(FIELD_URLS)
    return sequenceOf(
        variants?.optString(FIELD_MEDIUM),
        variants?.optString(FIELD_SMALL),
        first.optString(FIELD_URL),
    ).map { it.orEmpty().trim() }.firstOrNull { it.isNotEmpty() }
}

/**
 * Store shape for the rotation.
 *
 * Re-encoded rather than storing the response: this is what survives a process death and a
 * reboot, and the response is two orders of magnitude larger than the nine fields a card
 * draws — 110KB for five listings against roughly a kilobyte once re-encoded. Storing the
 * DECIDED place and image also means the two content rules above run once per fetch
 * instead of on every redraw.
 */
internal fun encodeListings(listings: List<WidgetListing>): String {
    val array = JSONArray()
    listings.forEach { listing ->
        array.put(
            JSONObject()
                .put(STORED_ID, listing.id)
                .put(STORED_AMOUNT, listing.monthlyAmount)
                .put(STORED_CURRENCY, listing.currency)
                .put(STORED_PLACE, listing.place)
                .put(STORED_BEDROOMS, listing.bedrooms)
                .put(STORED_BATHROOMS, listing.bathrooms)
                .put(STORED_AREA, listing.squareMetres)
                // Written as an EMPTY STRING rather than as a JSON null, and read back
                // through `ifEmpty { null }`. `JSONObject.put` with a null value removes
                // the key instead of storing one, and `optString` has its own opinion
                // about `JSONObject.NULL` — writing "" is the one encoding whose round
                // trip does not depend on either.
                .put(STORED_IMAGE, listing.imageUrl.orEmpty())
                .put(STORED_SOURCE, listing.source),
        )
    }
    return array.toString()
}

/**
 * Read back what [encodeListings] wrote.
 *
 * An unreadable blob — an older encoding, a truncated write — decodes to EMPTY rather than
 * throwing. The widget then shows its first-run state and the next refresh replaces it,
 * which is a better outcome than an exception inside a composition the launcher is waiting
 * on.
 *
 * The same two fields that can drop a listing at parse time drop it here, so a store
 * written by a future build with a laxer rule still cannot produce a card with no price.
 */
internal fun decodeListings(stored: String?): List<WidgetListing> {
    if (stored.isNullOrEmpty()) return emptyList()
    val array = runCatching { JSONArray(stored) }.getOrNull() ?: return emptyList()
    return buildList(array.length()) {
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val id = item.optString(STORED_ID)
            val amount = item.optLong(STORED_AMOUNT)
            if (id.isEmpty() || amount <= 0L) continue
            add(
                WidgetListing(
                    id = id,
                    monthlyAmount = amount,
                    currency = item.optString(STORED_CURRENCY),
                    place = item.optString(STORED_PLACE),
                    bedrooms = item.optInt(STORED_BEDROOMS),
                    bathrooms = item.optInt(STORED_BATHROOMS),
                    squareMetres = item.optInt(STORED_AREA),
                    imageUrl = item.optString(STORED_IMAGE).ifEmpty { null },
                    source = item.optString(STORED_SOURCE),
                ),
            )
        }
    }
}

/**
 * Which listing the card shows, given the stored rotation position.
 *
 * The modulo is what makes the stored index safe to advance forever and safe to read after
 * the rotation has SHRUNK — a fetch that returned three listings where the last one
 * returned five leaves an index pointing past the end, and a widget must not crash on the
 * home screen over an off-by-one. Returns `null` only for an empty rotation, which is the
 * first-run state.
 */
internal fun listingAt(listings: List<WidgetListing>, index: Int): WidgetListing? {
    if (listings.isEmpty()) return null
    return listings[normalizeRotationIndex(index, listings.size)]
}

/**
 * The stored index brought into `0 until size`.
 *
 * `rem` alone is not enough: Kotlin's `%` keeps the sign of the left operand, so a negative
 * index — an `Int` that has wrapped after years of advancing, or a corrupted preference —
 * would produce a negative position and an index-out-of-bounds.
 */
internal fun normalizeRotationIndex(index: Int, size: Int): Int {
    if (size <= 0) return 0
    val remainder = index % size
    return if (remainder < 0) remainder + size else remainder
}

/**
 * The next rotation position.
 *
 * Normalised BEFORE the increment, so the stored value stays inside `0 until size` forever
 * and can never approach `Int.MAX_VALUE` — a widget that has been on a home screen for
 * years advances this every thirty seconds.
 */
internal fun nextRotationIndex(index: Int, size: Int): Int {
    if (size <= 0) return 0
    return (normalizeRotationIndex(index, size) + 1) % size
}
