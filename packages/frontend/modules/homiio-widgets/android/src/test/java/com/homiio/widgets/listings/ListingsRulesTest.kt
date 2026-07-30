package com.homiio.widgets.listings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** When the widget goes to the network, and when it merely turns a page. */
class ListingsRulesTest {

    private val now = 1_800_000_000_000L

    private fun rotationOf(listingCount: Int, fetchedAtMs: Long) = ListingRotation(
        listings = List(listingCount) {
            WidgetListing(
                id = "id-$it",
                monthlyAmount = 1200,
                currency = "EUR",
                place = "Gràcia, Barcelona",
                bedrooms = 2,
                bathrooms = 1,
                squareMetres = 62,
                imageUrl = null,
                source = "fotocasa",
            )
        },
        index = 0,
        fetchedAtMs = fetchedAtMs,
    )

    /**
     * The first run always fetches, whatever the clock says. Without this a widget placed
     * on a device whose stored timestamp happened to look fresh would sit on its empty
     * state waiting out an interval it never started.
     */
    @Test
    fun `an empty rotation always fetches`() {
        assertTrue(shouldFetchRotation(rotationOf(0, fetchedAtMs = now), now))
    }

    @Test
    fun `a rotation fetched within the interval only turns over`() {
        assertFalse(shouldFetchRotation(rotationOf(5, now - FETCH_INTERVAL_MS + 1), now))
    }

    @Test
    fun `a rotation older than the interval fetches`() {
        assertTrue(shouldFetchRotation(rotationOf(5, now - FETCH_INTERVAL_MS), now))
        assertTrue(shouldFetchRotation(rotationOf(5, now - FETCH_INTERVAL_MS * 10), now))
    }

    /**
     * `fetchedAtMs` is wall-clock, so a device whose time is corrected BACKWARDS — a
     * timezone change, an NTP sync, a user setting the date — produces a timestamp in the
     * future. Compared with a plain subtraction that reads as negative age, which is
     * "fresh" forever: the widget would never fetch again until it was removed and
     * replaced.
     */
    @Test
    fun `a timestamp from the future is treated as staleness, not freshness`() {
        assertTrue(shouldFetchRotation(rotationOf(5, now + FETCH_INTERVAL_MS * 2), now))
    }

    /**
     * The two halves of the turn decision are independent, and getting the second one
     * backwards ends the chain permanently: nothing else moves this rotation, so a link
     * that declined to queue a successor while the screen was off would leave the widget on
     * one listing until the next `onUpdate`, which on a quiet device can be days.
     */
    @Test
    fun `the rotation turns only while the screen is on, but always re-arms`() {
        assertEquals(AutoAdvanceTick(advance = true, rearm = true), autoAdvanceTick(screenInteractive = true))
        assertEquals(AutoAdvanceTick(advance = false, rearm = true), autoAdvanceTick(screenInteractive = false))
    }

    /**
     * The store's raw values arrive as nullable preferences, and all three absences land in
     * a composition the launcher is waiting on.
     */
    @Test
    fun `a partly written store still yields a drawable rotation`() {
        val empty = rotationFor(storedListings = null, storedIndex = null, storedFetchedAtMs = null)
        assertTrue(empty.listings.isEmpty())
        assertEquals(0, empty.index)
        assertEquals(0L, empty.fetchedAtMs)
        // And therefore fetches, rather than waiting out an interval measured from zero.
        assertTrue(shouldFetchRotation(empty, now))
    }
}
