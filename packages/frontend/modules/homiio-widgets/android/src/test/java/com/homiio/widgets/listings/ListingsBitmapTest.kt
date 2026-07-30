package com.homiio.widgets.listings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The bitmap budget — the one number on this widget whose being wrong renders a BLANK
 * card, with nothing in the log to say why.
 */
class ListingsBitmapTest {

    /**
     * Half of the conventional 1MB Binder transaction, leaving the other half for the view
     * tree, the strings and everything else in the parcel.
     */
    private val budgetBytes = 512L * 1024

    /**
     * The assertion that ties the ceiling to the budget. It is written against
     * [WORST_CASE_BITMAP_BYTES] rather than against a copied number so that raising
     * `BACKGROUND_MAX_PIXELS` cannot quietly outgrow it.
     */
    @Test
    fun `the worst case parcel stays inside its budget`() {
        assertTrue(
            "worst case is $WORST_CASE_BITMAP_BYTES bytes against a $budgetBytes budget",
            WORST_CASE_BITMAP_BYTES <= budgetBytes,
        )
    }

    /**
     * The budget must hold even if the instance sharing it rests on stops happening.
     *
     * `RemoteViews` deduplicates bitmaps by identity, and every composition of one update
     * asks `ListingsBitmapCache` for the same key — but a ceiling that depends on an
     * optimisation holding is not a ceiling. Two full copies is what a launcher offering
     * two sizes would carry if the cache were ever bypassed.
     */
    @Test
    fun `two unshared copies still fit`() {
        assertTrue(
            "two copies is ${WORST_CASE_BITMAP_BYTES * 2} bytes against a $budgetBytes budget",
            WORST_CASE_BITMAP_BYTES * 2 <= budgetBytes,
        )
    }

    @Test
    fun `the background is decoded at a fixed size that does not depend on the placement`() {
        val first = cardBackgroundBitmapSize()
        val second = cardBackgroundBitmapSize()

        // Equality of VALUE is what the cache key relies on; the size taking no arguments
        // is what makes every composition produce the same key.
        assertEquals(first, second)
        assertEquals(first.bytes, WORST_CASE_BITMAP_BYTES)
    }

    @Test
    fun `the background keeps its four by three aspect`() {
        val size = cardBackgroundBitmapSize()
        val aspect = size.widthPx.toFloat() / size.heightPx.toFloat()

        assertEquals(4f / 3f, aspect, 0.02f)
    }

    /**
     * Sampling stops while BOTH axes still cover the slot. Going one power further would
     * decode a picture smaller than the space it is drawn into and then upscale it, which
     * undoes the point of decoding at size.
     */
    @Test
    fun `sampling never reduces past the slot`() {
        val target = ListingBitmapSize(widthPx = 283, heightPx = 212)

        assertEquals(1, sampleSizeFor(300, 220, target))
        assertEquals(2, sampleSizeFor(600, 440, target))
        assertEquals(4, sampleSizeFor(2048, 1536, target))
        // One axis short of the target stops the reduction, even though the other could go
        // further — sampling is uniform, so the short axis is the binding one.
        assertEquals(1, sampleSizeFor(2048, 300, target))
    }

    @Test
    fun `a source with no dimensions is not sampled`() {
        val target = ListingBitmapSize(widthPx = 283, heightPx = 212)

        assertEquals(1, sampleSizeFor(0, 0, target))
        assertEquals(1, sampleSizeFor(-1, 100, target))
    }
}
