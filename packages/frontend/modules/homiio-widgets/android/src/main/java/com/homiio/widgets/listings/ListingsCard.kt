package com.homiio.widgets.listings

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.unit.Dp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.components.FilledButton
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.Text
import androidx.glance.unit.ColorProvider
import com.homiio.widgets.R
import java.util.Locale

/**
 * THE card: ONE recently listed home, turning over, as a full-bleed photograph.
 *
 * Top to bottom: an EYEBROW saying what this is, then — pushed to the bottom, where a
 * property card puts them — the RENT as the emphasised element, WHERE it is, HOW BIG it
 * is, and which portal it came from.
 *
 * ONE LISTING AT A TIME is the load-bearing decision, and it is about payload rather than
 * taste. Several listings with their photographs means one decoded bitmap per listing per
 * size the launcher offers, in the same `RemoteViews` — exactly the shape that overruns
 * the Binder transaction and renders a blank widget. Turning over means the parcel carries
 * one picture, whatever the launcher asks for (see `ListingsBitmaps.kt`).
 *
 * The price at the bottom over a photograph is the estate-listing convention the app's own
 * `PropertyCard` uses, and it survives the launcher's crop better than a top-anchored one:
 * the reader's eye lands on the number in the same place at every size.
 */
@Composable
internal fun ListingsCardContent(rotation: ListingRotation) {
    val context = LocalContext.current
    val widgetSize = LocalSize.current
    val design = listingCardSize(widgetSize.width, widgetSize.height)
    val padding = cardPadding(design)
    val listing = rotation.current
    val background = cardBackgroundBitmap(context, listing)

    // The one place this module reads a colour the theme did not choose. Over a photograph
    // the theme's `onPrimaryContainer` is a coin toss against the picture; with no
    // photograph it is exactly right. See [OVER_IMAGE_CONTENT_COLOR].
    val contentColor = if (background == null) {
        GlanceTheme.colors.onPrimaryContainer
    } else {
        OVER_IMAGE_CONTENT_COLOR
    }

    // A plain `Box`, not `Scaffold`, and the reason is geometric rather than stylistic.
    // `Scaffold` applies a vertical padding of its own and exposes only `horizontalPadding`,
    // so the height its content actually receives is smaller than `LocalSize` by an amount
    // this file cannot name — and every decision in `visibleBlocks` is arithmetic against
    // that height. An unknown subtrahend makes the sum wrong in the one direction that
    // shows: the last child clipped.
    //
    // Nothing is lost with it. The tonal container is one `background` modifier, and the
    // rounded corner was never `Scaffold`'s to give here: the launcher clips widget content
    // to `system_app_widget_background_radius` itself.
    //
    // The tap target sits on the OUTERMOST box rather than on the padded content inside it,
    // so the launcher draws the pressed state across the whole widget instead of making the
    // card look like a smaller button floating inside itself. Only when there is a listing
    // to open: the empty state carries its own button, and a whole-card tap behind it would
    // give the reader two targets for one action.
    val cardModifier = GlanceModifier
        .fillMaxSize()
        .background(GlanceTheme.colors.primaryContainer)
        .let { base ->
            if (listing == null) {
                base
            } else {
                base
                    .semantics {
                        contentDescription =
                            cardDescription(context, listing, design, widgetSize.height)
                    }
                    .clickable(
                        actionStartActivity(openInAppIntent(context, listingUrl(context, listing))),
                    )
            }
        }

    Box(cardModifier) {
        Box(GlanceModifier.fillMaxSize()) {
            if (background != null) {
                Image(
                    provider = ImageProvider(background),
                    // The card's own description already names the listing this is a
                    // photograph of, and the picture carries no information the text does
                    // not — announcing it again would read the listing twice.
                    contentDescription = null,
                    modifier = GlanceModifier.fillMaxSize(),
                    // CROP, not FillBounds: the bitmap is decoded at a fixed size that has
                    // nothing to do with this placement (which is what lets every
                    // composition share one), so the launcher is the thing that knows how
                    // to make it fit. Cropping keeps the photograph's proportions;
                    // stretching it to the card would not.
                    contentScale = ContentScale.Crop,
                )
            }
            Box(GlanceModifier.fillMaxSize().padding(padding)) {
                if (listing == null) {
                    EmptyCard(contentColor = contentColor)
                } else {
                    ListingCard(
                        listing = listing,
                        design = design,
                        cardHeight = widgetSize.height,
                        contentColor = contentColor,
                    )
                }
            }
        }
    }
}

/**
 * The listing's photograph, decoded once for every composition of this update, or `null`
 * when there is nothing to draw.
 *
 * `null` covers both "this listing has no picture" and "the worker has not cached it yet",
 * and the card treats them the same: it falls back to the tonal container. Distinguishing
 * them would mean drawing a placeholder, which makes a perfectly ordinary listing look
 * like a failed image load.
 *
 * The decode goes through [ListingsBitmapCache] rather than a `remember`, and that is not
 * an optimisation: `remember` is per composition, and Glance composes this card once per
 * size the launcher offers, so a remembered bitmap would be a second copy of the same
 * photograph in the same parcel. See [WORST_CASE_BITMAP_BYTES]. The `remember` that is
 * still here only keeps a redraw that changes nothing from re-entering the cache on the
 * launcher's clock.
 */
@Composable
private fun cardBackgroundBitmap(context: Context, listing: WidgetListing?): Bitmap? {
    val url = listing?.imageUrl ?: return null
    return remember(url) {
        val size = cardBackgroundBitmapSize()
        ListingsBitmapCache.getOrDecode(ListingsBitmapCache.backgroundKey(url, size)) {
            val file = ListingsImageCache.fileForComposition(context, url)
                ?: return@getOrDecode null
            ListingsImageRenderer.decodeCardBackground(file, size, IMAGE_SCRIM_ALPHA)
        }
    }
}

@Composable
private fun ListingCard(
    listing: WidgetListing,
    design: ListingCardSize,
    cardHeight: Dp,
    contentColor: ColorProvider,
) {
    val context = LocalContext.current
    // The user's font-size setting. Left out, a card at a 1.3 scale would be handed more
    // blocks than fit and the column would clip the last one.
    val fontScale = context.resources.configuration.fontScale
    val blocks = visibleBlocks(design, cardHeight, fontScale)

    Column(modifier = GlanceModifier.fillMaxSize()) {
        if (blocks.eyebrow) {
            EyebrowRow(contentColor = contentColor)
        }

        // The leftover goes here, so the eyebrow stays at the top and everything else hugs
        // the bottom whatever the card's height. It also absorbs the gap `visibleBlocks`
        // charged the eyebrow but the layout does not draw explicitly — reserving a little
        // more than is spent is the safe direction, since the cost of the opposite is a
        // clipped line.
        Spacer(GlanceModifier.defaultWeight())

        Text(
            text = monthlyPriceText(context, listing),
            style = ListingCardTextStyles.price(contentColor, design),
            maxLines = 1,
            // Every text block here is silenced individually because the whole card is one
            // tap target with one description; without this a screen reader would read the
            // card's description and then each line again.
            modifier = GlanceModifier.semantics { contentDescription = "" },
        )

        if (blocks.place && listing.place.isNotEmpty()) {
            Spacer(GlanceModifier.height(ListingCardDimensions.BLOCK_SPACING))
            Text(
                text = listing.place,
                style = ListingCardTextStyles.place(contentColor, design),
                // One line, ellipsized by the `TextView` against a width it has actually
                // measured. This is why this module has no character-budget estimator —
                // see the note at the top of `ListingsCardStyle.kt`.
                maxLines = 1,
                modifier = GlanceModifier.semantics { contentDescription = "" },
            )
        }

        val specs = specsText(context, listing)
        if (blocks.specs && specs.isNotEmpty()) {
            Spacer(GlanceModifier.height(ListingCardDimensions.BLOCK_SPACING))
            Text(
                text = specs,
                style = ListingCardTextStyles.specs(contentColor, design),
                maxLines = 1,
                modifier = GlanceModifier.semantics { contentDescription = "" },
            )
        }

        val source = sourceText(context, listing)
        if (blocks.source && source.isNotEmpty()) {
            Spacer(GlanceModifier.height(ListingCardDimensions.BLOCK_SPACING))
            Text(
                text = source,
                style = ListingCardTextStyles.source(contentColor),
                maxLines = 1,
                modifier = GlanceModifier.semantics { contentDescription = "" },
            )
        }
    }
}

/**
 * What this is, and whose widget it is.
 *
 * Deliberately the quietest thing on the card and the first content block to go as the
 * card shrinks: a reader can see it is a home from the photograph and the price, so the
 * eyebrow is context rather than a headline.
 */
@Composable
private fun EyebrowRow(contentColor: ColorProvider) {
    val context = LocalContext.current
    Row(
        modifier = GlanceModifier.fillMaxWidth(),
        verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
        // The words lead and the mark sits at the far end, pushed there by the weight
        // between them rather than by a fixed gap — so it stays pinned to the right edge at
        // every width the launcher can hand out instead of trailing the text.
        Text(
            text = context.getString(R.string.homiio_listings_widget_eyebrow),
            style = ListingCardTextStyles.eyebrow(contentColor),
            maxLines = 1,
            modifier = GlanceModifier.defaultWeight().semantics { contentDescription = "" },
        )
        Spacer(GlanceModifier.width(ListingCardDimensions.BRAND_SPACING))
        Image(
            provider = ImageProvider(R.drawable.homiio_widget_brand),
            // The launcher's own widget label already names the app, and the words beside
            // it say what the card is.
            contentDescription = null,
            modifier = GlanceModifier
                .width(ListingCardDimensions.BRAND_MARK_WIDTH)
                .height(ListingCardDimensions.BRAND_MARK_HEIGHT),
            colorFilter = ColorFilter.tint(contentColor),
        )
    }
}

/**
 * Shown only when there has never been a successful fetch.
 *
 * A failed refresh leaves the previous rotation in place, so this is a first-run state
 * rather than an error state — and there is deliberately no spinner: a widget that rests
 * on a spinner looks broken every time the user glances at it.
 */
@Composable
private fun EmptyCard(contentColor: ColorProvider) {
    val context = LocalContext.current
    Column(
        modifier = GlanceModifier.fillMaxSize(),
        verticalAlignment = Alignment.Vertical.CenterVertically,
        horizontalAlignment = Alignment.Horizontal.CenterHorizontally,
    ) {
        Text(
            text = context.getString(R.string.homiio_listings_widget_empty),
            style = ListingCardTextStyles.emptyMessage(contentColor),
            maxLines = 2,
        )
        Spacer(GlanceModifier.height(ListingCardDimensions.BLOCK_SPACING))
        FilledButton(
            text = context.getString(R.string.homiio_widget_open_app),
            onClick = actionStartActivity(openInAppIntent(context, webBaseUrl(context))),
            maxLines = 1,
        )
    }
}

/**
 * The rent, formatted in the device's locale and labelled with its period.
 *
 * The amount and the suffix come from different places on purpose: the number is a
 * `NumberFormat` problem the platform already solves per locale, and `/mo` is a
 * translation. Joining them in a resource keeps the two orders straight — Spanish puts the
 * symbol after the digits, and the suffix still follows both.
 */
private fun monthlyPriceText(context: Context, listing: WidgetListing): String =
    context.getString(
        R.string.homiio_listings_widget_price_monthly,
        formatMonthlyPrice(listing.monthlyAmount, listing.currency, currentLocale(context)),
    )

/**
 * Bedrooms, bathrooms and floor area, with whatever the listing does not state left out.
 *
 * A zero means NOT STATED rather than none, which is why each part is gated on being
 * positive. That reading is exactly right for bathrooms and floor area, and it costs one
 * honest omission: a studio, which genuinely has zero bedrooms, shows its bathroom and its
 * area and simply says nothing about bedrooms. Printing "0 beds" would be worse — it reads
 * as missing data on a listing that is not missing anything — and printing "Studio" would
 * mean inferring a property type from a bedroom count rather than from the `type` field.
 */
private fun specsText(context: Context, listing: WidgetListing): String = joinNonBlank(
    parts = listOf(
        if (listing.bedrooms > 0) {
            context.resources.getQuantityString(
                R.plurals.homiio_listings_widget_beds,
                listing.bedrooms,
                listing.bedrooms,
            )
        } else {
            ""
        },
        if (listing.bathrooms > 0) {
            context.resources.getQuantityString(
                R.plurals.homiio_listings_widget_baths,
                listing.bathrooms,
                listing.bathrooms,
            )
        } else {
            ""
        },
        if (listing.squareMetres > 0) {
            context.getString(R.string.homiio_listings_widget_area, listing.squareMetres)
        } else {
            ""
        },
    ),
    separator = context.getString(R.string.homiio_listings_widget_spec_separator),
)

/** Which portal this was ingested from, or nothing for a listing published on Homiio. */
private fun sourceText(context: Context, listing: WidgetListing): String {
    val name = formatSourceName(listing.source, currentLocale(context))
    return if (name.isEmpty()) "" else context.getString(R.string.homiio_listings_widget_source, name)
}

/**
 * What TalkBack reads for the whole card.
 *
 * Built from the same strings the card DRAWS, in the order it draws them, and gated on the
 * same [visibleBlocks] answer — so a reader who cannot see the card hears exactly what is
 * on it, including the fact that a small placement is showing less.
 */
private fun cardDescription(
    context: Context,
    listing: WidgetListing,
    design: ListingCardSize,
    cardHeight: Dp,
): String {
    // The design and the height are passed in rather than read again, so the description
    // is gated on the same answer the layout below was given and the two cannot disagree.
    val blocks = visibleBlocks(design, cardHeight, context.resources.configuration.fontScale)
    return buildCardDescription(
        listOf(
            monthlyPriceText(context, listing),
            if (blocks.place) listing.place else "",
            if (blocks.specs) specsText(context, listing) else "",
            if (blocks.source) sourceText(context, listing) else "",
        ),
    )
}

/** The device's locale, for the number and title-case rules the card applies. */
private fun currentLocale(context: Context): Locale =
    context.resources.configuration.locales[0] ?: Locale.getDefault()
