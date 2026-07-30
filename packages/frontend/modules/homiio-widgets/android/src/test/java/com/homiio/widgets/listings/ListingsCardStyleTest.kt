package com.homiio.widgets.listings

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The per-size decisions — the ones that are wrong silently until someone resizes a widget
 * on a real home screen.
 */
class ListingsCardStyleTest {

    /**
     * Every placement a launcher can hand out inside the range the provider declares, plus
     * two past its ceiling. The launcher deals in whole CELLS, so it routinely produces
     * sizes no breakpoint named — a four-cell placement measures 387 × 325dp on a 480dpi
     * phone — which is why the sweep goes past 320dp rather than stopping there.
     */
    private val realPlacements: List<Pair<Dp, Dp>> = listOf(
        110.dp to 110.dp,
        180.dp to 110.dp,
        250.dp to 110.dp,
        250.dp to 180.dp,
        250.dp to 250.dp,
        320.dp to 180.dp,
        320.dp to 320.dp,
        387.dp to 325.dp,
        520.dp to 480.dp,
    )

    /** Every font scale Android's own Display settings can produce, and then some. */
    private val fontScales = listOf(0.85f, 1.0f, 1.15f, 1.3f, 1.5f, 2.0f)

    @Test
    fun `the design is chosen by height first, and large also asks for width`() {
        assertEquals(ListingCardSize.SMALL, listingCardSize(250.dp, 110.dp))
        assertEquals(ListingCardSize.MEDIUM, listingCardSize(250.dp, 180.dp))
        assertEquals(ListingCardSize.LARGE, listingCardSize(320.dp, 320.dp))
        // Tall but narrow stays MEDIUM: the large design's bigger type would ellipsize the
        // place line it exists to make more readable.
        assertEquals(ListingCardSize.MEDIUM, listingCardSize(250.dp, 320.dp))
        // Boundaries are inclusive FLOORS, so a height a hair under one falls to the
        // smaller design rather than rounding up into a layout it cannot afford...
        assertEquals(ListingCardSize.SMALL, listingCardSize(250.dp, 179.9f.dp))
        // ...and a size no breakpoint declared still resolves, which matters because the
        // launcher deals in whole cells and routinely produces one.
        assertEquals(ListingCardSize.MEDIUM, listingCardSize(251.dp, 200.dp))
        assertEquals(ListingCardSize.LARGE, listingCardSize(387.dp, 325.dp))
    }

    /**
     * THE INVARIANT `visibleBlocks` exists to keep: what it chose fits in the card.
     *
     * A block that does not fit is not invisible — the column clips it, and the reader sees
     * a line of text sliced through the middle. Only the price is allowed to overflow,
     * because a listing card that cannot name its rent has nothing left worth glancing at.
     */
    @Test
    fun `the chosen blocks always fit inside the card`() {
        for ((width, height) in realPlacements) {
            for (scale in fontScales) {
                val design = listingCardSize(width, height)
                val blocks = visibleBlocks(design, height, scale)
                val used = blocksHeightDp(design, blocks, scale)
                val available = contentHeightDp(design, height)

                // The price alone may exceed the card at extreme font scales; everything
                // this function CHOSE must fit alongside it.
                if (blocks.place || blocks.specs || blocks.eyebrow || blocks.source) {
                    assertTrue(
                        "$design ${width}x$height at scale $scale chose $blocks needing " +
                            "${used}dp of ${available}dp",
                        used <= available,
                    )
                }
            }
        }
    }

    /**
     * The blocks are a PREFIX of the priority order, never a filter. A card that names the
     * portal it came from but not what it is would be incoherent, and an 11sp provenance
     * line does sometimes fit where a 20dp eyebrow row does not — so this is a rule the
     * arithmetic could plausibly break.
     */
    @Test
    fun `blocks are dropped in priority order with no gaps`() {
        for ((width, height) in realPlacements) {
            for (scale in fontScales) {
                val design = listingCardSize(width, height)
                val blocks = visibleBlocks(design, height, scale)
                val order = listOf(blocks.place, blocks.specs, blocks.eyebrow, blocks.source)

                val firstAbsent = order.indexOfFirst { !it }
                if (firstAbsent >= 0) {
                    assertTrue(
                        "$design ${width}x$height at scale $scale chose $blocks, which is not a prefix",
                        order.drop(firstAbsent).none { it },
                    )
                }
            }
        }
    }

    /** A card only ever gains blocks as it grows. */
    @Test
    fun `a taller card never shows less`() {
        var previous = visibleBlocks(ListingCardSize.SMALL, 72.dp, 1f)
        var height = 72
        while (height <= 320) {
            val design = listingCardSize(250.dp, height.dp)
            val blocks = visibleBlocks(design, height.dp, 1f)
            // Compared within one design: a breakpoint change raises every font size at
            // once, which can legitimately cost a block.
            if (design == ListingCardSize.SMALL) {
                assertTrue(
                    "at ${height}dp $blocks lost a block that ${height - 1}dp had ($previous)",
                    !previous.place || blocks.place,
                )
                assertTrue(
                    "at ${height}dp $blocks lost a block that ${height - 1}dp had ($previous)",
                    !previous.specs || blocks.specs,
                )
                previous = blocks
            }
            height += 1
        }
    }

    /**
     * The default placement is what the launcher offers first, and it is the size worth
     * meeting the widget as — everything the card has to say has to fit there at the
     * default font scale, or the default is the wrong default.
     */
    @Test
    fun `the default four by three placement shows the whole card`() {
        val blocks = visibleBlocks(ListingCardSize.MEDIUM, 180.dp, 1f)

        assertTrue(blocks.place)
        assertTrue(blocks.specs)
        assertTrue(blocks.eyebrow)
    }

    /**
     * THE DECLARED RESIZE FLOOR, tied to the arithmetic by reading the resource itself.
     *
     * A rent with no location attached is not a listing, it is a number — so the smallest
     * size a user can drag this widget to has to fit a price AND a place. That is the
     * derivation `dimens.xml` records, and this is what stops it from being a comment: the
     * floor is READ OUT OF THE FILE, so lowering it without re-deriving fails here instead
     * of shipping a card that shows a price over an unnamed home.
     *
     * It caught exactly that on the first run, when the floor was one cell (72dp) and the
     * place line did not fit under it.
     */
    @Test
    fun `the declared resize floor still fits a price and a place`() {
        val floor = declaredDimenDp("homiio_listings_widget_min_resize_height")
        val blocks = visibleBlocks(listingCardSize(110.dp, floor.dp), floor.dp, 1f)

        assertTrue("at the declared floor of ${floor}dp the card cannot name the place", blocks.place)
    }

    /**
     * Read a `<dimen>` out of the module's own `values/dimens.xml`.
     *
     * A unit test has no `Resources`, and hard-coding the number here would make the test
     * agree with itself rather than with what ships. Gradle runs unit tests with the module
     * directory as the working directory, so the file is a relative path away.
     *
     * Every failure to FIND the value throws rather than returning a default, which is the
     * point: a test that silently fell back to a hard-coded floor when the path broke would
     * keep passing while guarding nothing.
     */
    private fun declaredDimenDp(name: String): Float {
        val file = File("src/main/res/values/dimens.xml")
        check(file.isFile) { "expected ${file.absolutePath} to exist; is the working directory the module root?" }
        val match = Regex("""<dimen name="$name">([0-9.]+)dp</dimen>""").find(file.readText())
        checkNotNull(match) { "no <dimen name=\"$name\"> in ${file.absolutePath}" }
        return match.groupValues[1].toFloat()
    }

    /**
     * A reader on a large font setting gets fewer blocks, never clipped ones.
     *
     * Asserted as a SUBSET rather than by naming which block goes: which one that is
     * depends on the type scale, and pinning it would make this test fail on a legitimate
     * type change while saying nothing about the property that matters.
     */
    @Test
    fun `a larger font scale costs blocks rather than clipping them`() {
        val comfortable = visibleBlocks(ListingCardSize.MEDIUM, 180.dp, 1f)
        val enlarged = visibleBlocks(ListingCardSize.MEDIUM, 180.dp, 2f)

        assertTrue(comfortable.place && comfortable.specs && comfortable.eyebrow)
        assertTrue("enlarged $enlarged gained a block over $comfortable", !enlarged.place || comfortable.place)
        assertTrue("enlarged $enlarged gained a block over $comfortable", !enlarged.specs || comfortable.specs)
        assertTrue("enlarged $enlarged gained a block over $comfortable", !enlarged.eyebrow || comfortable.eyebrow)
        assertTrue("enlarged $enlarged gained a block over $comfortable", !enlarged.source || comfortable.source)
        // And it does genuinely cost something at double scale, so this is not vacuous.
        assertFalse("doubling the font scale should have cost the eyebrow", enlarged.eyebrow)
    }

    /** A zero or negative scale is a corrupt configuration, not a reason to divide by it. */
    @Test
    fun `a nonsense font scale is treated as the default`() {
        assertEquals(
            visibleBlocks(ListingCardSize.MEDIUM, 180.dp, 1f),
            visibleBlocks(ListingCardSize.MEDIUM, 180.dp, 0f),
        )
    }
}
