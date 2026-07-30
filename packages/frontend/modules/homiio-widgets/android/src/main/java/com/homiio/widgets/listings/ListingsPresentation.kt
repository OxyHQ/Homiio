package com.homiio.widgets.listings

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import com.homiio.widgets.R

/**
 * Where the widget's taps go, and which pictures its rotation needs.
 */

/** The configured web origin, without a trailing slash. */
internal fun webBaseUrl(context: Context): String =
    context.getString(R.string.homiio_widget_web_base_url).trimEnd('/')

/**
 * The listing's page — the app's own property screen, reached through the `https://`
 * app link the manifest already verifies.
 *
 * An `https` URL rather than the `homiio://` scheme, deliberately. The app link opens the
 * app on a device where Android has verified it, and falls back to the same listing on the
 * website where it has not — whereas a custom scheme on an unverified device opens
 * nothing. The widget therefore never needs to know the app's scheme.
 *
 * It also links to HOMIIO's page for the listing rather than to the portal it came from,
 * even for an ingested listing that carries a `sourceUrl`. That is not an oversight: the
 * property screen is what knows an external listing has no in-app enquiry and offers the
 * portal link itself, so routing through it keeps the widget on the one path that already
 * handles the distinction — and a widget that sent a reader straight to a portal would be
 * handing Homiio's traffic away at the first tap.
 */
internal fun listingUrl(context: Context, listing: WidgetListing): String =
    "${webBaseUrl(context)}/properties/${Uri.encode(listing.id)}"

/**
 * The intent a tap fires.
 *
 * `FLAG_ACTIVITY_NEW_TASK` because it is started from a `RemoteViews` in the launcher's
 * process, where there is no task of ours to add it to.
 */
internal fun openInAppIntent(context: Context, url: String): Intent =
    Intent(Intent.ACTION_VIEW, url.toUri()).apply {
        `package` = context.packageName
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

/**
 * Every picture the stored rotation references.
 *
 * Both the set the refresh worker downloads and the set [ListingsImageCache.prune] is
 * allowed to KEEP, from one function, so the cache can never evict something the rotation
 * is about to want — the bug that shape prevents is a card that shows no photograph for
 * however long the fetch interval is, on a rotation that turns every thirty seconds.
 */
internal fun rotationImageUrls(listings: List<WidgetListing>): List<String> =
    listings.mapNotNull { it.imageUrl }
