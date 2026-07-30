package com.homiio.widgets.listings

import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * Turning a listing's numbers into the strings the card draws.
 *
 * Pure and `Locale`-parameterised so every rule here is unit-tested on a plain JVM. The
 * locale is passed in rather than read from `Locale.getDefault()` for exactly that reason:
 * a widget is drawn by the system in the DEVICE's locale, which is a moving target a test
 * cannot pin, and the composition already has the right one from its `Configuration`.
 */

/**
 * The rent, as money, in [locale]'s own convention — `€1,200` on an English phone,
 * `1.200 €` on a Spanish one.
 *
 * NO FRACTION DIGITS, which is the one real decision in here. `NumberFormat`'s currency
 * instance defaults to the currency's own precision, so a monthly rent would print as
 * `€1,200.00` — four characters of nothing, on the card's most emphasised line, at its
 * largest type size, where they compete with the digits that matter. Rents are advertised
 * in whole units by every portal Homiio ingests from.
 *
 * The SYMBOL, not the code, wherever the platform knows one: `€1,200` reads as a price and
 * `EUR 1,200` reads as a transaction. Where it does not — an unrecognised or empty code,
 * which `Currency.getInstance` answers with an exception rather than a fallback — the
 * amount is still shown, grouped, with the raw code beside it. A price the widget cannot
 * label is still worth more than no price at all, and inventing a symbol for an unknown
 * currency would be worse than either.
 */
internal fun formatMonthlyPrice(amount: Long, currencyCode: String, locale: Locale): String {
    val currency = runCatching { Currency.getInstance(currencyCode.trim().uppercase(Locale.ROOT)) }
        .getOrNull()

    if (currency == null) {
        val plain = NumberFormat.getIntegerInstance(locale).format(amount)
        val code = currencyCode.trim()
        return if (code.isEmpty()) plain else "$plain $code"
    }

    return NumberFormat.getCurrencyInstance(locale).apply {
        setCurrency(currency)
        maximumFractionDigits = 0
        minimumFractionDigits = 0
    }.format(amount)
}

/**
 * [parts] with the blanks removed, joined by [separator].
 *
 * The blank-dropping is the point rather than a tidiness measure. Every part of the spec
 * line is optional on a real listing — a portal that publishes a floor area but no
 * bathroom count is ordinary — and a naive join would draw `2 beds ·  · 62 m²`, a
 * separator hanging in the middle of the card with nothing on one side of it. Returns an
 * empty string when nothing survives, which every caller treats as "do not draw this
 * line".
 */
internal fun joinNonBlank(parts: List<String>, separator: String): String =
    parts.map { it.trim() }.filter { it.isNotEmpty() }.joinToString(separator)

/**
 * A provider id as a name a reader recognises: `fotocasa` → `Fotocasa`,
 * `apartments_com` → `Apartments.com`, `olx_ro` → `Olx.ro`.
 *
 * Homiio's provider ids are snake_case, and the part after the underscore is invariably a
 * domain or country suffix — `realtor_com`, `imobiliare_ro`, `idealista_pt`,
 * `mercadolibre_ar`. So a dot reconstructs something very close to the portal's actual
 * name, where a space (`Apartments Com`) reconstructs nothing.
 *
 * Only the FIRST character is capitalised, deliberately. Title-casing every segment would
 * produce `Apartments.Com`, and capitalising nothing would leave a lowercase word in a
 * sentence. Everything after the first letter is left exactly as the id has it, so
 * `immobilienscout24` keeps its digits and no rule has to know about them.
 *
 * A LIGHT TRANSFORM rather than a lookup table, and that is the point: a table mapping
 * thirty-odd ids to display names would be a second list to update every time a provider
 * is added, and the failure mode of forgetting is a card that prints a raw id — which is
 * exactly what this produces anyway, only worse for having promised better.
 */
internal fun formatSourceName(source: String, locale: Locale): String {
    val cleaned = source.trim().replace('_', '.').replace('-', '.')
    if (cleaned.isEmpty()) return ""
    return cleaned.replaceFirstChar { first -> first.titlecase(locale) }
}

/**
 * What TalkBack reads for the card, which is one tap target.
 *
 * Assembled from the same strings the card DRAWS, in the order it draws them, so a reader
 * who cannot see the card hears exactly what is on it — not a paraphrase that has to be
 * kept in step by hand.
 *
 * Built by joining rather than by a format string with three placeholders, and that is the
 * bug this replaces rather than a preference: any of place, specs or provenance can be
 * absent on a real listing, and a `"%1$s. %2$s. %3$s."` resource would announce
 * `"€1,200/mo. . ."` for a listing that states only its rent. Sentences are separated so
 * a screen reader pauses between them.
 */
internal fun buildCardDescription(parts: List<String>): String {
    val body = joinNonBlank(parts, SENTENCE_SEPARATOR)
    return if (body.isEmpty()) "" else "$body$SENTENCE_TERMINATOR"
}

private const val SENTENCE_SEPARATOR = ". "
private const val SENTENCE_TERMINATOR = "."
