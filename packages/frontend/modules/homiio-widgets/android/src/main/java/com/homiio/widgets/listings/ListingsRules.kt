package com.homiio.widgets.listings

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * When the widget goes to the network, and when it merely turns a page.
 *
 * Both decisions are pure functions so both are unit tested; the scheduling that acts on
 * them is in `ListingsRefreshScheduler.kt`.
 */

/**
 * How stale a stored rotation may get before the next tick re-fetches it — three hours.
 *
 * DERIVED FROM WHAT THE DATA DOES AND WHAT THE REQUEST COSTS, which pull in the same
 * direction here.
 *
 * The content is "recently listed homes", and it moves when an ingest pass lands. Homiio's
 * listing worker schedules discovery on an interval measured in HOURS
 * (`LISTING_DISCOVER_INTERVAL_HOURS`, read once at worker startup) — never in minutes — so
 * a widget fetching every half hour would spend six requests to observe one change.
 *
 * And the request is expensive, measured rather than assumed: `GET /properties/search`
 * returns whole property documents including a ~2,000-character description the card never
 * draws, and the API sends no `content-encoding`, so five listings are 110,857 bytes on
 * the wire. At three hours that is roughly 880KB a day while a widget is placed. At the
 * thirty minutes Mention's equivalent card uses it would be 5.3MB a day, in the background,
 * on a connection that may be metered — to redraw a card whose underlying data had not
 * changed.
 *
 * None of this makes the CARD stale. The rotation still turns every thirty seconds and the
 * periodic tick still runs every fifteen minutes; this interval governs only how often the
 * batch behind them is replaced. A newly placed widget fetches immediately, so nobody
 * waits three hours for their first listing.
 */
internal val FETCH_INTERVAL_MS = TimeUnit.HOURS.toMillis(3)

/**
 * Whether this tick should fetch, or just advance the rotation.
 *
 * An EMPTY store always fetches, whatever the clock says — that is the first run, and the
 * alternative is a widget that sits on its empty state until an interval it never started
 * has elapsed.
 *
 * `abs` rather than a plain subtraction because `fetchedAtMs` is wall-clock: a device
 * whose time is corrected backwards (a timezone change, an NTP sync, a user setting the
 * date) would otherwise produce a negative age that compares as "fresh" forever, and the
 * widget would never fetch again until it was removed and replaced.
 */
internal fun shouldFetchRotation(stored: ListingRotation, nowMs: Long): Boolean {
    if (stored.listings.isEmpty()) return true
    return abs(nowMs - stored.fetchedAtMs) >= FETCH_INTERVAL_MS
}

/** What one link of the automatic-turn chain should do. */
internal data class AutoAdvanceTick(val advance: Boolean, val rearm: Boolean)

/**
 * Whether to turn the card over now, and whether to queue another turn.
 *
 * There is no visibility signal for a widget — no AppWidget or Glance callback says "you
 * are on screen" — so the closest available proxy is whether the device is interactive at
 * all. When it is not, the turn is SKIPPED: rotating a card nobody can see spends a
 * `RemoteViews` round trip carrying a decoded photograph, twice a minute, all night.
 *
 * It still REARMS, which is the half that is easy to get wrong in the other direction. The
 * chain is the only thing that moves this rotation, and a link that declined to queue a
 * successor while the screen happened to be off would end it permanently — the widget
 * would sit on one listing until the next `onUpdate`, which on a quiet device can be days.
 * Rearming costs one queued job with a thirty-second delay.
 */
internal fun autoAdvanceTick(screenInteractive: Boolean): AutoAdvanceTick = AutoAdvanceTick(
    advance = screenInteractive,
    rearm = true,
)

/**
 * Whether any listings widget is on a home screen.
 *
 * The periodic job is cancelled when the last widget is removed, but a run can already be
 * queued when that happens, and a one-off nudge from the app does not know whether the
 * user has a widget at all. Checking in the worker covers both without either caller
 * having to.
 */
internal fun anyPlaced(context: Context): Boolean {
    val manager = AppWidgetManager.getInstance(context) ?: return false
    return manager
        .getAppWidgetIds(ComponentName(context, ListingsWidgetReceiver::class.java))
        .isNotEmpty()
}
