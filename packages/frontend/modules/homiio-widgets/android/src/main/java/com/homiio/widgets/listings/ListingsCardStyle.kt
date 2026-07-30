package com.homiio.widgets.listings

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.text.FontWeight
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider

/**
 * The card's MEASUREMENTS and the rule that decides what fits.
 *
 * Everything in this file is decided without a `Context`, a `Canvas` or a composition,
 * which is the point: per-size decisions are the ones that can be wrong in a way nobody
 * notices until a widget is resized on a real home screen, so they are written as pure
 * functions and unit tested.
 *
 * ## The card, and why it is a stack of one-line blocks
 *
 * A listing has five things to say and each of them is SHORT: the rent, where it is, how
 * big it is, which feed this came from, and which portal it was ingested from. That is the
 * whole difference between this card and the post card it is modelled on — a post carries
 * a paragraph of arbitrary prose, so Mention's widget has to estimate how many characters
 * fit on a line and how many lines fit in the card, and both estimates can be wrong.
 *
 * Here every block is exactly ONE line whose height is known from its font size. So there
 * is deliberately NO character-budget estimator in this file and no `truncateToBudget`:
 * each text block is drawn with `maxLines = 1` and the `TextView` ellipsizes it against a
 * width it has actually measured, in the launcher's own process, which is strictly more
 * accurate than any advance-ratio guess could be. Please do not add one back by analogy.
 *
 * What IS derived, because it genuinely varies, is WHICH blocks a given height can afford
 * — see [visibleBlocks].
 *
 * ## The photograph is the background
 *
 * Full-bleed behind everything at every size, so it costs no layout height and there is no
 * slot to measure. Two consequences, both handled here rather than in the layout:
 *
 *  - A photograph Homiio did not choose sits under the text, so legibility cannot come
 *    from a theme colour. Over a picture the text is [OVER_IMAGE_CONTENT_COLOR] on a baked
 *    scrim of [IMAGE_SCRIM_ALPHA]; a card with no picture keeps the tonal container and
 *    the theme's own `onPrimaryContainer`.
 *  - The bitmap is bounded by pixels rather than by the card — see `ListingsBitmaps.kt`.
 */

/** Which of the three designs a given placement gets. */
internal enum class ListingCardSize {
    SMALL,
    MEDIUM,
    LARGE,
}

/**
 * Cell-grid thresholds, in the launcher's own `70 × cells − 30` dp conversion
 * (developer.android.com/develop/ui/views/appwidgets § "Determine widget sizing"):
 * 2 cells → 110dp, 3 → 180dp, 4 → 250dp, 5 → 320dp.
 */
private val MEDIUM_MIN_HEIGHT = 180.dp
private val LARGE_MIN_HEIGHT = 320.dp
private val LARGE_MIN_WIDTH = 320.dp

/**
 * Which design a placement of this size gets.
 *
 * Height leads, because what the card gains with room is LINES, and lines need vertical
 * space. The large design additionally asks for the width, since its bigger type on a
 * narrow widget would ellipsize the place line it was meant to make more readable.
 *
 * A launcher may hand over a size no breakpoint declared — it deals in whole cells, and a
 * four-cell placement measures 387 × 325dp on a 480dpi phone, past the 320 × 320dp the
 * provider asks for — so the boundaries are inclusive floors rather than equality tests
 * against the declared set.
 */
internal fun listingCardSize(width: Dp, height: Dp): ListingCardSize = when {
    height >= LARGE_MIN_HEIGHT && width >= LARGE_MIN_WIDTH -> ListingCardSize.LARGE
    height >= MEDIUM_MIN_HEIGHT -> ListingCardSize.MEDIUM
    else -> ListingCardSize.SMALL
}

internal object ListingCardDimensions {
    /**
     * Padding inside the card. M3's card content padding is 16dp; the small design falls
     * back to 12dp, because at 110dp wide 32dp of horizontal padding is more than a
     * quarter of the card.
     */
    val PADDING = 16.dp
    val PADDING_SMALL = 12.dp

    /** Gap between the card's stacked blocks. */
    val BLOCK_SPACING = 6.dp

    /**
     * Homiio's mark on the eyebrow row, at the aspect the logo path is drawn in
     * (388.03 : 512). Both axes are set explicitly because Glance measures an `Image` by
     * its modifier rather than by the drawable's intrinsic size, so giving it only one
     * would let it square itself and distort the mark.
     */
    val BRAND_MARK_HEIGHT = 20.dp
    val BRAND_MARK_WIDTH = 15.dp

    /** Gap between the eyebrow words and the mark at the other end of the row. */
    val BRAND_SPACING = 6.dp
}

/** Padding inside a card of this design. */
internal fun cardPadding(size: ListingCardSize): Dp = if (size == ListingCardSize.SMALL) {
    ListingCardDimensions.PADDING_SMALL
} else {
    ListingCardDimensions.PADDING
}

/**
 * How much black is baked over the photograph before any text is drawn on it — 55%.
 *
 * DERIVED FROM A CONTRAST FLOOR, not chosen by eye, because the picture is arbitrary: a
 * listing photograph can be, and often is, a white-walled room that is pure white exactly
 * where the price sits. Take the worst case — a white pixel — put `a` of black over it,
 * and white text on the result has a WCAG contrast ratio of `1.05 / (L + 0.05)` where `L`
 * is the sRGB-linearised luminance of `1 − a`. At 0.50 that is 3.98:1, which clears AA for
 * large text only; at 0.55 it is 4.75:1, which clears the 4.5:1 AA floor for text of ANY
 * size — and the smallest type on this card is an 11sp provenance line.
 *
 * A FLAT scrim rather than the usual bottom-weighted gradient, and for a structural reason
 * rather than a stylistic one: the bitmap is decoded at a size that has nothing to do with
 * the placement and the launcher centre-crops it to whatever the card turns out to be (see
 * [cardBackgroundBitmapSize]), so on a wide card the launcher throws away the top and
 * bottom of the bitmap — exactly the bands a gradient would have put its protection in. A
 * flat scrim survives any crop, so the contrast floor above holds at every placement.
 */
internal const val IMAGE_SCRIM_ALPHA = 0.55f

/**
 * The text colour over a photograph: plain white, and DELIBERATELY NOT A THEME COLOUR.
 *
 * Everywhere else this module takes its colours from `GlanceTheme`, which on API 31+
 * follows the user's wallpaper — and that is exactly why it cannot be used here. Material
 * You is free to hand this card a light `onPrimaryContainer`, which is correct on the
 * tonal container it was picked for and unreadable over a photograph. The pairing that
 * makes the card legible is a fixed light foreground on [IMAGE_SCRIM_ALPHA], and the
 * contrast figure quoted there is computed for white specifically.
 *
 * A card with NO photograph keeps the theme colour — see `ListingsCard`. Please do not
 * "fix" this back.
 */
internal val OVER_IMAGE_CONTENT_COLOR: ColorProvider = ColorProvider(Color.White)

/**
 * Roboto's line box as a multiple of its font size.
 *
 * 1.2 is the platform default for a `TextView` with no explicit line spacing, which is
 * what Glance emits. Used only to convert a font size into the height one line occupies.
 */
private const val LINE_HEIGHT_RATIO = 1.2f

/**
 * Height the HOST keeps for itself, which `LocalSize` does not report.
 *
 * There is no API that tells us: Mention's widget module measured a 28dp avatar coming out
 * 24.3dp on a real launcher at density 3 — a square bitmap in a square `size()` modifier,
 * 4dp shorter than it asked for, because the column had less room than `LocalSize.height`
 * and clipped its last child.
 *
 * 8dp rather than the 4 observed there: that measurement is one launcher at one density,
 * `includeFontPadding` adds a little on top of each line box, and the cost of
 * over-reserving is a few pixels of slack while the cost of under-reserving is the last
 * block sliced in half. Subtracted once, here, so every derivation shares one answer.
 */
private const val HOST_CONTENT_INSET_DP = 8f

/** The height the card can actually lay out in, as opposed to the one it was told. */
private fun usableCardHeightDp(cardHeight: Dp): Float = cardHeight.value - HOST_CONTENT_INSET_DP

/** Font size the rent draws at, in sp. M3 Headline Small, up to Headline Medium. */
private fun priceFontSizeSp(size: ListingCardSize): Float = when (size) {
    ListingCardSize.SMALL -> 20f
    ListingCardSize.MEDIUM -> 24f
    ListingCardSize.LARGE -> 28f
}

/** The place line: M3 Title Small, up to Title Medium. */
private fun placeFontSizeSp(size: ListingCardSize): Float = when (size) {
    ListingCardSize.SMALL -> 13f
    ListingCardSize.MEDIUM -> 14f
    ListingCardSize.LARGE -> 16f
}

/** Bedrooms, bathrooms and floor area: quieter than the place above them. */
private fun specsFontSizeSp(size: ListingCardSize): Float = when (size) {
    ListingCardSize.SMALL -> 12f
    ListingCardSize.MEDIUM -> 13f
    ListingCardSize.LARGE -> 14f
}

/** The eyebrow, at one size: it is chrome, and growing it would make it compete. */
private const val EYEBROW_FONT_SIZE_SP = 12f

/** The provenance line — the quietest thing on the card. M3's smallest label role. */
private const val SOURCE_FONT_SIZE_SP = 11f

/** Height of one line at [fontSizeSp], at the reader's font-size setting. */
private fun lineHeightDp(fontSizeSp: Float, fontScale: Float): Float {
    val effectiveScale = if (fontScale > 0f) fontScale else 1f
    return fontSizeSp * effectiveScale * LINE_HEIGHT_RATIO
}

/**
 * Which blocks this card draws, besides the price.
 *
 * The price is not in here because it is never dropped: a listing card that cannot name
 * its rent has nothing left worth glancing at, so at the smallest placement the card
 * becomes a photograph with a price on it and that is the honest floor. Every other block
 * is a candidate.
 */
internal data class ListingCardBlocks(
    val eyebrow: Boolean,
    val place: Boolean,
    val specs: Boolean,
    val source: Boolean,
)

/**
 * What a card of this height can afford, DERIVED rather than tabulated.
 *
 * A table of "these blocks at this breakpoint" is the thing that goes wrong here, and it
 * goes wrong silently: it is calibrated once against one placement, and thereafter it
 * promises the smallest card a line it has no room for — the `TextView` is handed a block
 * that does not fit and the column clips it, so the reader sees a line of text sliced
 * through the middle, or a price with its descenders cut off. Deriving the answer from the
 * height the launcher actually gave the card cannot promise a block that does not fit.
 *
 * The blocks are considered in DESCENDING importance and the first one that does not fit
 * ENDS the list — a prefix, not a filter. A filter would be a little more efficient with
 * the pixels (an 11sp provenance line sometimes fits where a 12sp eyebrow did not) and it
 * would look broken: a card that names the portal it came from but not what it is is
 * incoherent in a way that saving 6dp does not justify.
 *
 * [fontScale] matters in both directions. A reader at 1.3 gets taller lines and therefore
 * fewer of them, which is the honest answer rather than a clipped one; a reader at 0.85
 * gets more.
 */
internal fun visibleBlocks(
    size: ListingCardSize,
    cardHeight: Dp,
    fontScale: Float,
): ListingCardBlocks {
    var remaining = usableCardHeightDp(cardHeight) -
        cardPadding(size).value * 2 -
        lineHeightDp(priceFontSizeSp(size), fontScale)

    val spacing = ListingCardDimensions.BLOCK_SPACING.value
    var stillFitting = true

    // Each block brings the gap that separates it from the one above, so the cost charged
    // is the line plus one spacing — never the line alone, which is how a stack of blocks
    // that each "fit" individually ends up taller than the card.
    fun afford(blockHeightDp: Float): Boolean {
        if (!stillFitting) return false
        val cost = blockHeightDp + spacing
        if (cost > remaining) {
            stillFitting = false
            return false
        }
        remaining -= cost
        return true
    }

    val place = afford(lineHeightDp(placeFontSizeSp(size), fontScale))
    val specs = afford(lineHeightDp(specsFontSizeSp(size), fontScale))
    // The eyebrow row is as tall as the taller of its two children — the mark is 20dp and
    // the words are 12sp, so which one leads depends on the reader's font scale.
    val eyebrow = afford(
        maxOf(
            ListingCardDimensions.BRAND_MARK_HEIGHT.value,
            lineHeightDp(EYEBROW_FONT_SIZE_SP, fontScale),
        ),
    )
    val source = afford(lineHeightDp(SOURCE_FONT_SIZE_SP, fontScale))

    return ListingCardBlocks(eyebrow = eyebrow, place = place, specs = specs, source = source)
}

/**
 * Total height the chosen blocks occupy, price included.
 *
 * Exists so a test can assert the invariant [visibleBlocks] is really making — that what
 * it chose fits inside the card, with only the mandatory price allowed to overflow. It is
 * NOT used to lay anything out: the layout gives the price and the spacer the room and
 * lets each one-line block measure itself, so there is no second copy of this sum that
 * could disagree with the first.
 */
internal fun blocksHeightDp(
    size: ListingCardSize,
    blocks: ListingCardBlocks,
    fontScale: Float,
): Float {
    val spacing = ListingCardDimensions.BLOCK_SPACING.value
    var total = lineHeightDp(priceFontSizeSp(size), fontScale)
    if (blocks.place) total += lineHeightDp(placeFontSizeSp(size), fontScale) + spacing
    if (blocks.specs) total += lineHeightDp(specsFontSizeSp(size), fontScale) + spacing
    if (blocks.eyebrow) {
        total += maxOf(
            ListingCardDimensions.BRAND_MARK_HEIGHT.value,
            lineHeightDp(EYEBROW_FONT_SIZE_SP, fontScale),
        ) + spacing
    }
    if (blocks.source) total += lineHeightDp(SOURCE_FONT_SIZE_SP, fontScale) + spacing
    return total
}

/** The room a card of this height leaves for blocks, after the host's inset and padding. */
internal fun contentHeightDp(size: ListingCardSize, cardHeight: Dp): Float =
    usableCardHeightDp(cardHeight) - cardPadding(size).value * 2

/**
 * The type scale, as Material 3 roles.
 *
 * Colour is a parameter rather than baked in because the same card is drawn on a tonal
 * container in one state and over a photograph in another, and those want opposite
 * foregrounds — see [OVER_IMAGE_CONTENT_COLOR].
 */
internal object ListingCardTextStyles {
    /** The eyebrow: M3 Label Medium, Medium weight. */
    fun eyebrow(color: ColorProvider) = TextStyle(
        color = color,
        fontWeight = FontWeight.Medium,
        fontSize = EYEBROW_FONT_SIZE_SP.sp,
    )

    /**
     * The rent — the emphasised element, and the reason Material 3 Expressive reads on a
     * surface that cannot animate: emphasis here is type size and weight, not motion.
     */
    fun price(color: ColorProvider, size: ListingCardSize) = TextStyle(
        color = color,
        fontWeight = FontWeight.Bold,
        fontSize = priceFontSizeSp(size).sp,
    )

    /** Where it is: M3 Title Small. */
    fun place(color: ColorProvider, size: ListingCardSize) = TextStyle(
        color = color,
        fontWeight = FontWeight.Medium,
        fontSize = placeFontSizeSp(size).sp,
    )

    /** Bedrooms, bathrooms, floor area: M3 Body Small. */
    fun specs(color: ColorProvider, size: ListingCardSize) = TextStyle(
        color = color,
        fontWeight = FontWeight.Normal,
        fontSize = specsFontSizeSp(size).sp,
    )

    /** The portal it came from: the quietest role on the card. */
    fun source(color: ColorProvider) = TextStyle(
        color = color,
        fontWeight = FontWeight.Normal,
        fontSize = SOURCE_FONT_SIZE_SP.sp,
    )

    /** The first-run message; M3 Title Medium, as Glance's own `NoDataContent` uses. */
    fun emptyMessage(color: ColorProvider) = TextStyle(
        color = color,
        fontWeight = FontWeight.Medium,
        fontSize = 16.sp,
    )
}
