package com.homiio.widgets.listings

import android.content.Context
import com.homiio.widgets.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * The widget's one request: `GET /api/properties/search?offering=long_term_rent`.
 *
 * ## No credential, by design
 *
 * There is no `Authorization` header here and no session behind it. This is the same
 * public search the app serves to a signed-out visitor, which is what makes the widget
 * safe on a shoulder-surfable surface and what lets it work on a phone where nobody has
 * signed in yet. See the contract at the top of `ListingsStore.kt` for what would have to
 * change alongside it if that ever stops being true.
 *
 * ## The query, and why each part of it is there
 *
 * `offering=long_term_rent` narrows to the rental feed, which is the platform's own
 * default (`DEFAULT_PRICE_FIELD` on the backend resolves a bare price range to the monthly
 * amount). It also keeps ONE mental model on the card: a rotation that alternated between
 * "€1,200/mo" and "€649,000" would make a reader re-read the price every turn to work out
 * which kind of number it is.
 *
 * There is deliberately no `sortBy`. The endpoint's default is already
 * `{ hasImages: -1, createdAt: -1 }` — newest first, with listings that have photographs
 * ranked ahead of those that do not — which is exactly what a photo-led card wants, and
 * naming it explicitly would only create a second place for the two to disagree.
 */
internal object ListingsApi {

    private val CONNECT_TIMEOUT_MS = TimeUnit.SECONDS.toMillis(10).toInt()
    private val READ_TIMEOUT_MS = TimeUnit.SECONDS.toMillis(20).toInt()

    /**
     * Fetch the rotation.
     *
     * Throws [IOException] for what a later attempt could get past (no network, a timeout,
     * a 5xx) and [org.json.JSONException] for a body that is not the documented shape. The
     * caller distinguishes the two: the first is worth retrying, the second is not.
     */
    suspend fun fetch(context: Context): List<WidgetListing> = withContext(Dispatchers.IO) {
        val base = context.getString(R.string.homiio_widget_api_base_url).trimEnd('/')
        val url = URL("$base/api/properties/search?offering=long_term_rent&limit=$FEED_PAGE_LENGTH")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            setRequestProperty("Accept", "application/json")
        }
        try {
            val status = connection.responseCode
            if (status != HttpURLConnection.HTTP_OK) {
                throw IOException("GET /api/properties/search responded $status")
            }
            parseListingsResponse(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }
}
