package com.homiio.widgets.listings

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

/**
 * THE ANONYMITY OF THIS WIDGET, ASSERTED AGAINST A REAL REQUEST.
 *
 * ## Why this test exists at all
 *
 * The widget reads a PUBLIC search and carries no session, and everything downstream is
 * built on that being true: the rotation store has no account stamp, the card has no
 * signed-out state, and nothing is cleared when a user signs out — none of which is needed
 * for content that is identical on every device, and all of which becomes load-bearing the
 * moment a request starts identifying its sender.
 *
 * That was documented in three files and enforced nowhere, which is the weakest possible
 * version of it. This module's own reference implementation has a cautionary example: a doc
 * comment in Mention's widget claimed cached images "arrive lazily as the rotation reaches
 * each post" while nothing in the code ever made them arrive, and the gap survived until a
 * user reported missing avatars. A comment saying "do not add an Authorization header" would
 * age exactly the same way.
 *
 * So the property is checked where it can actually be observed: a real HTTP server, a real
 * request from the real client code, and an assertion about the headers that arrived. Adding
 * a credential to this widget now has to be deliberate enough to delete a failing test.
 *
 * ## Why a socket rather than a mock
 *
 * `ListingsApi` builds its request with `HttpURLConnection`, which adds headers of its own
 * (`Host`, `User-Agent`, `Accept-Encoding`). A test that inspected a hand-built header map
 * would assert what the code MEANT to send; this asserts what a server actually received,
 * which is the thing that matters and the only version that would catch a credential added
 * by a future interceptor rather than at the call site.
 */
class ListingsApiTest {

    private lateinit var server: MockWebServer
    private lateinit var baseUrl: String

    @Before
    fun startServer() {
        // Loopback only, and port 0 so the OS picks a free one — a fixed port would make
        // this test fail when anything else on the machine happened to hold it.
        server = MockWebServer()
        server.start()
        baseUrl = server.url("/").toString()
    }

    @After
    fun stopServer() {
        server.shutdown()
    }

    /**
     * THE ASSERTION THIS FILE EXISTS FOR.
     *
     * `Authorization` is the one that matters and the one a future change would reach for,
     * but the check covers every header that could identify a device or a person: a cookie,
     * a bearer under another name, an API key. If the widget ever needs one of these, it
     * needs the account-correctness contract in `ListingsStore.kt` first, and this test is
     * where that conversation starts.
     */
    @Test
    fun `the request carries nothing that identifies the device or its owner`() {
        fetch()

        val request = server.takeRequest()
        val identifying = listOf(
            "authorization",
            "cookie",
            "proxy-authorization",
            "x-api-key",
            "x-auth-token",
            "x-oxy-user-id",
            "x-device-id",
        )
        identifying.forEach { header ->
            assertNull(
                "the listings widget must send no `$header` — it reads a public search, and " +
                    "the store behind it has no account stamp to make a credentialed one safe",
                request.getHeader(header),
            )
        }
    }

    /**
     * The positive half of the same property, and the reason the test above cannot pass
     * vacuously: the request really was made, really reached the server, and really carried
     * the one header the widget does send.
     *
     * Without this, a change that stopped the fetch happening at all would leave the
     * assertion above green — it would be checking the headers of a request that never was.
     */
    @Test
    fun `the request is a plain GET for JSON and nothing else`() {
        fetch()

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("application/json", request.getHeader("Accept"))
        assertNotNull("the request must have reached the server", request.getHeader("Host"))
    }

    /**
     * The query, asserted where it is actually sent rather than where it is composed.
     *
     * `offering=long_term_rent` is what keeps one mental model on the card, and the absence
     * of a `sortBy` is deliberate — the endpoint's default is already
     * `{ hasImages: -1, createdAt: -1 }`, and naming it here would create a second place for
     * the two to disagree.
     */
    @Test
    fun `the request asks for the rental feed, one rotation deep, with no sort of its own`() {
        fetch()

        val request = server.takeRequest()
        assertEquals("/api/properties/search", request.requestUrl?.encodedPath)
        val query = request.requestUrl?.encodedQuery.orEmpty().split('&').toSet()
        assertEquals(setOf("offering=long_term_rent", "limit=$FEED_PAGE_LENGTH"), query)
    }

    /** A trailing slash on the configured origin must not double up in the path. */
    @Test
    fun `a base url with a trailing slash still produces one slash`() {
        fetch("$baseUrl/")

        assertEquals("/api/properties/search", server.takeRequest().requestUrl?.encodedPath)
    }

    @Test
    fun `a successful response is parsed into the rotation`() {
        val listings = fetch()

        val listing = listings.single()
        assertEquals("6a648fb7b5ffe7efdb4d8f19", listing.id)
        assertEquals(3000L, listing.monthlyAmount)
        assertEquals("Quintana, Madrid", listing.place)
    }

    /**
     * A non-200 is retryable, so it has to arrive as an `IOException` — the refresh worker
     * distinguishes that from a malformed body, which is not worth retrying.
     */
    @Test
    fun `a server error is raised as a retryable failure`() {
        server.enqueue(MockResponse().setResponseCode(503).setBody("{}"))

        val thrown = runCatching { runBlocking { ListingsApi.fetchFrom(baseUrl) } }.exceptionOrNull()

        assertTrue("expected an IOException, got $thrown", thrown is IOException)
        assertTrue(
            "the failure should name the status so a silent widget can be diagnosed",
            thrown?.message?.contains("503") == true,
        )
    }

    private fun fetch(origin: String = baseUrl): List<WidgetListing> {
        server.enqueue(MockResponse().setResponseCode(200).setBody(oneListing))
        return runBlocking { ListingsApi.fetchFrom(origin) }
    }

    /** One listing, in the shape the live endpoint returns. */
    private val oneListing = """
        {"data":[{
          "_id":"6a648fb7b5ffe7efdb4d8f19",
          "longTermRent":{"monthlyAmount":3000,"currency":"EUR"},
          "address":{"neighborhoodName":"Quintana","street":"Madrid","cityName":"Madrid"},
          "bedrooms":3,"bathrooms":3,"squareFootage":175,
          "images":[{"url":"https://api.homiio.com/api/images/file/property/a-medium.webp",
                     "urls":{"medium":"https://api.homiio.com/api/images/file/property/a-medium.webp"}}],
          "source":"fotocasa"
        }]}
    """.trimIndent()
}
