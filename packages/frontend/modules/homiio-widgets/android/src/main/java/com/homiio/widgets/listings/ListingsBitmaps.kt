package com.homiio.widgets.listings

import kotlin.math.sqrt

/**
 * How big the card's photograph is allowed to be — the one piece of arithmetic on this
 * widget that decides whether it renders at all.
 *
 * A `RemoteViews` crosses a Binder transaction into the launcher's process, and one that
 * overruns it does not degrade: the widget is BLANK, with nothing in the log to say why.
 * This widget's `RemoteViews` carries a decoded bitmap, so the bound has to be real.
 *
 * Under `SizeMode.Exact` (see [ListingsWidget]) the parcel carries the sizes the LAUNCHER
 * offers rather than a declared set, so there is no table of sizes to add up and the bound
 * cannot come from one. It comes instead from the HARD PIXEL CEILING below: the photograph
 * is decoded at a fixed size that does not depend on the placement at all, so the payload
 * is bounded at any size a launcher can invent — including one no breakpoint declared and
 * one past the provider's own resize ceiling. [WORST_CASE_BITMAP_BYTES] is that bound.
 *
 * This file is pure so all of it is unit tested; the decoding itself is in
 * `ListingsImageRenderer.kt`.
 */

/** ARGB_8888 — the only config worth using here, and four bytes a pixel. */
internal const val BYTES_PER_PIXEL = 4

/**
 * Pixels in the card's background photograph — 60,000, which is 240KB at
 * [BYTES_PER_PIXEL].
 *
 * ## Why this is a pixel COUNT and not a size
 *
 * The background does not depend on the card. It is decoded once at this budget and the
 * launcher centre-crops it to whatever the placement turns out to be (`ContentScale.Crop`),
 * which is what makes ONE bitmap serve every composition — see [WORST_CASE_BITMAP_BYTES]
 * for why that is the difference between a bounded payload and an unbounded one.
 *
 * ## Why 60,000
 *
 * Set so the parcel is inside its budget EVEN IF the instance sharing described in
 * [WORST_CASE_BITMAP_BYTES] does not happen: two compositions each carrying their own copy
 * of a 240KB photograph is 480KB, inside the 512KB `ListingsBitmapTest` allows. A ceiling
 * that depends on an optimisation holding is not a ceiling, and the failure it guards
 * against is a blank widget rather than a slower one.
 *
 * ## What it buys on screen
 *
 * At [BACKGROUND_ASPECT_WIDTH]:[BACKGROUND_ASPECT_HEIGHT] this is 283 × 212 pixels. After
 * the launcher's crop that is roughly 0.75 pixels per dp on the default four-by-three
 * placement — soft, and acceptable precisely because the picture is a backdrop behind
 * [IMAGE_SCRIM_ALPHA] of black rather than the card's subject. Homiio's `medium` image
 * variant is the one fetched (see [chooseImageUrl]) and comfortably exceeds this, so the
 * downscale is always a downscale.
 */
private const val BACKGROUND_MAX_PIXELS = 60_000L

/**
 * The aspect the photograph is decoded at: 4:3.
 *
 * The bitmap is cropped by the launcher rather than by us, so this only decides how much
 * of it survives that crop — a bitmap whose aspect is far from the card's loses the
 * difference, and the pixels it loses are sharpness. 4:3 is the aspect estate photography
 * is overwhelmingly shot and published in, and it is within 10% of the default
 * four-by-three placement.
 */
private const val BACKGROUND_ASPECT_WIDTH = 4
private const val BACKGROUND_ASPECT_HEIGHT = 3

/** A bitmap needs at least this many pixels on an edge to be worth decoding. */
private const val MIN_BITMAP_EDGE_PX = 2

/** The pixel dimensions to decode a bitmap at. */
internal data class ListingBitmapSize(val widthPx: Int, val heightPx: Int) {
    val pixels: Long get() = widthPx.toLong() * heightPx.toLong()
    val bytes: Long get() = pixels * BYTES_PER_PIXEL
}

/**
 * The card's background photograph — [BACKGROUND_MAX_PIXELS] at 4:3, and the SAME size
 * whatever the placement.
 *
 * That independence is the whole design. A bitmap sized for the card would be a different
 * bitmap in every composition and the parcel would carry one per composition; one sized
 * for nothing in particular is a single instance every composition can share, which is
 * what [WORST_CASE_BITMAP_BYTES] rests on. The launcher makes it fit by cropping rather
 * than by stretching, so nothing is distorted — the price is paid in the pixels the crop
 * discards, not in the shape of the photograph.
 *
 * The height is derived first and the width from the aspect, so the product cannot exceed
 * the budget through rounding.
 */
internal fun cardBackgroundBitmapSize(): ListingBitmapSize {
    val heightPx = sqrt(
        BACKGROUND_MAX_PIXELS.toDouble() * BACKGROUND_ASPECT_HEIGHT / BACKGROUND_ASPECT_WIDTH,
    ).toInt().coerceAtLeast(MIN_BITMAP_EDGE_PX)
    val widthPx = (heightPx.toLong() * BACKGROUND_ASPECT_WIDTH / BACKGROUND_ASPECT_HEIGHT)
        .toInt()
        .coerceAtLeast(MIN_BITMAP_EDGE_PX)
    return ListingBitmapSize(widthPx = widthPx, heightPx = heightPx)
}

/**
 * THE NUMBER TO REPORT: bytes of bitmap in the worst-case `RemoteViews`.
 *
 * ## Why it is ONE photograph rather than one per composition
 *
 * Because the bitmap does not depend on the card. `RemoteViews` keeps ONE bitmap cache for
 * a tree and its sized variants, and `BitmapCache.getBitmapId` looks bitmaps up by
 * IDENTITY, so the same INSTANCE used in two compositions is written to the parcel once.
 * [cardBackgroundBitmapSize] takes no arguments, so every composition asks
 * [ListingsBitmapCache] for the same key and gets the same instance back. That is what
 * makes this figure independent of how many sizes the launcher offers — a number that is
 * not ours to know: `OPTION_APPWIDGET_SIZES` is two on a phone launcher and may be more on
 * a foldable, and a bound that multiplied by it would be a bound on something we cannot
 * see.
 *
 * This card carries exactly one bitmap, unlike the post card it is modelled on, which also
 * decodes an author avatar. There is no second picture to add: a listing's provenance is a
 * portal NAME, drawn as text, and rendering a portal's logo on a Homiio card would be
 * advertising the portal.
 *
 * ## What it is measured against
 *
 * The ceiling that matters is the Binder transaction the `RemoteViews` travels in,
 * conventionally taken as 1MB for the whole transaction, and one that overruns it renders
 * a BLANK widget rather than a smaller picture. `ListingsBitmapTest` holds this to half of
 * that, leaving the other half for the view tree, the strings and everything else in the
 * parcel — and it separately holds the UNSHARED case, two full copies, inside the same
 * budget, so the widget survives even if the sharing above ever stops happening.
 */
internal val WORST_CASE_BITMAP_BYTES: Long = cardBackgroundBitmapSize().bytes

/**
 * The `inSampleSize` to decode a `sourceWidth × sourceHeight` image at so the result still
 * covers [target].
 *
 * `inSampleSize` is the only way to decode a large JPEG without allocating it at full size
 * first — a 2048px photograph is 16MB at ARGB_8888, and the slot it is going into is
 * 60,000 pixels. Powers of two are all `BitmapFactory` honours, which is why the exact
 * size is reached by a scaling draw afterwards rather than here.
 *
 * Doubles the reduction only while BOTH axes stay at or above the target, so the sampled
 * bitmap is never smaller than the slot on either axis — sampling past that would upscale
 * a picture into its own slot and undo the point of decoding at size.
 *
 * Pure, and separated from the decode for that reason: this is the part that can be wrong.
 */
internal fun sampleSizeFor(sourceWidth: Int, sourceHeight: Int, target: ListingBitmapSize): Int {
    if (sourceWidth <= 0 || sourceHeight <= 0) return 1
    var sample = 1
    while (
        sourceWidth / (sample * 2) >= target.widthPx &&
        sourceHeight / (sample * 2) >= target.heightPx
    ) {
        sample *= 2
    }
    return sample
}
