package com.homiio.widgets.listings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Price, provenance and the strings assembled from optional parts.
 *
 * The currency assertions are deliberately about STRUCTURE rather than about an exact
 * string. `NumberFormat` is backed by CLDR on a JVM and by ICU on a device, and the two
 * agree on the things that matter here — grouping, symbol placement, fraction digits — but
 * not necessarily on which space character sits between a number and its symbol. Pinning
 * the exact byte sequence would make this test a report on the JDK's CLDR revision rather
 * than on the code, and it would pass here while the device did something else.
 */
class ListingsFormatTest {

    /**
     * THE decision in `formatMonthlyPrice`: no fraction digits. `NumberFormat`'s currency
     * instance defaults to the currency's own precision, which would spend four characters
     * of the card's largest type on `.00`.
     */
    @Test
    fun `a monthly rent never carries fraction digits`() {
        val english = formatMonthlyPrice(1200, "EUR", Locale.US)
        assertFalse("expected no decimals in $english", english.contains("."))
        assertTrue("expected grouped thousands in $english", english.contains("1,200"))

        val spanish = formatMonthlyPrice(1200, "EUR", Locale("es", "ES"))
        assertFalse("expected no decimals in $spanish", spanish.contains(",00"))
        assertTrue("expected grouped thousands in $spanish", spanish.contains("1.200"))
    }

    @Test
    fun `the currency symbol is used and follows the locale's own placement`() {
        val english = formatMonthlyPrice(950, "EUR", Locale.US)
        assertTrue("expected a euro sign in $english", english.contains("€"))
        assertTrue("expected the symbol to lead in $english", english.startsWith("€"))

        val spanish = formatMonthlyPrice(950, "EUR", Locale("es", "ES"))
        assertTrue("expected a euro sign in $spanish", spanish.contains("€"))
        assertTrue("expected the symbol to trail in $spanish", spanish.trim().endsWith("€"))
    }

    /**
     * A currency the platform does not know must still show the AMOUNT. Losing the price
     * entirely — or worse, throwing inside a composition — over an unrecognised code would
     * be a far larger failure than printing the code instead of a symbol.
     */
    @Test
    fun `an unknown currency still prints the amount, labelled with the raw code`() {
        val formatted = formatMonthlyPrice(1200, "ZZZ", Locale.US)
        assertTrue("expected the amount in $formatted", formatted.contains("1,200"))
        assertTrue("expected the raw code in $formatted", formatted.contains("ZZZ"))
    }

    @Test
    fun `an absent currency prints the bare amount`() {
        assertEquals("1,200", formatMonthlyPrice(1200, "", Locale.US))
        assertEquals("1,200", formatMonthlyPrice(1200, "   ", Locale.US))
    }

    @Test
    fun `a lowercase currency code is still recognised`() {
        assertEquals(
            formatMonthlyPrice(1200, "EUR", Locale.US),
            formatMonthlyPrice(1200, "eur", Locale.US),
        )
    }

    /**
     * The spec line's whole reason for existing: every part of it is optional on a real
     * listing, and a naive join leaves a separator hanging with nothing on one side.
     */
    @Test
    fun `joining drops the parts that are not there`() {
        assertEquals("3 beds · 2 baths · 175 m²", joinNonBlank(listOf("3 beds", "2 baths", "175 m²"), " · "))
        assertEquals("2 baths · 30 m²", joinNonBlank(listOf("", "2 baths", "30 m²"), " · "))
        assertEquals("3 beds", joinNonBlank(listOf("3 beds", "", ""), " · "))
        assertEquals("", joinNonBlank(listOf("", "", ""), " · "))
        assertEquals("", joinNonBlank(emptyList(), " · "))
        assertEquals("3 beds · 30 m²", joinNonBlank(listOf("3 beds", "   ", "30 m²"), " · "))
    }

    @Test
    fun `the spoken description reads the card in order and ends as a sentence`() {
        assertEquals(
            "€1,200/mo. Quintana, Madrid. 3 beds · 2 baths.",
            buildCardDescription(listOf("€1,200/mo", "Quintana, Madrid", "3 beds · 2 baths")),
        )
    }

    /**
     * The bug the join replaces: a three-placeholder resource would announce
     * `"€1,200/mo. . ."` for a listing that states only its rent.
     */
    @Test
    fun `the spoken description skips the parts the card is not showing`() {
        assertEquals("€1,200/mo.", buildCardDescription(listOf("€1,200/mo", "", "")))
        assertEquals("", buildCardDescription(listOf("", "", "")))
    }

    @Test
    fun `a provider id reads as the portal it names`() {
        assertEquals("Fotocasa", formatSourceName("fotocasa", Locale.US))
        assertEquals("Idealista", formatSourceName("idealista", Locale.US))
        assertEquals("Apartments.com", formatSourceName("apartments_com", Locale.US))
        assertEquals("Olx.ro", formatSourceName("olx_ro", Locale.US))
        assertEquals("Realtor.com", formatSourceName("realtor_com", Locale.US))
        assertEquals("Immobilienscout24", formatSourceName("immobilienscout24", Locale.US))
        // A listing published on Homiio itself carries no source, and the card draws no
        // provenance line for it.
        assertEquals("", formatSourceName("", Locale.US))
        assertEquals("", formatSourceName("   ", Locale.US))
    }

    /**
     * Turkish is the locale where a naive `uppercase()` on the first letter would produce
     * a dotted capital I, so the title-casing takes the locale it was given.
     */
    @Test
    fun `provider capitalisation respects the locale`() {
        assertEquals("İdealista", formatSourceName("idealista", Locale("tr", "TR")))
    }
}
