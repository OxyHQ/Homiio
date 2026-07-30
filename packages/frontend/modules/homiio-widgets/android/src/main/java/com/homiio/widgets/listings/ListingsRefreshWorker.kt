package com.homiio.widgets.listings

import android.content.Context
import android.util.Log
import androidx.glance.appwidget.updateAll
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONException
import java.io.IOException

/**
 * The widget's one background job: turn the rotation over, fetch when the batch is stale,
 * and make sure the photographs it is about to show are on disk.
 *
 * TURNING AND FETCHING ARE THE SAME TICK, at different rates — the job runs on the
 * shortest interval WorkManager offers periodic work and moves the rotation on every run,
 * but only re-fetches once the stored batch is older than [FETCH_INTERVAL_MS].
 *
 * The failure contract has one rule: this worker never writes an empty or partial
 * rotation. A fetch that does not produce a parsed list leaves the store exactly as it
 * was, and the rotation still advances — so a phone that has been offline for a day shows
 * yesterday's listings, cycling, rather than a blank box.
 */
internal class ListingsRefreshWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(appContext, parameters) {

    override suspend fun doWork(): Result {
        // The periodic job is cancelled when the last widget is removed, but a run can
        // already be queued when that happens, and a one-off nudge from the app does not
        // know whether the user has a widget at all. Checking here covers both without
        // either caller having to.
        if (!anyPlaced(applicationContext)) {
            return Result.success()
        }

        val stored = ListingsStore.read(applicationContext)
        val now = System.currentTimeMillis()

        val outcome = if (shouldFetchRotation(stored, now)) {
            fetchInto(now)
        } else {
            ListingsStore.advance(applicationContext)
            Result.success()
        }

        // Runs whatever happened above, INCLUDING after a failed fetch: the listing about
        // to be drawn is the one the rotation now points at, and it needs its photograph
        // regardless of whether this tick refreshed anything.
        cacheRotationImages()
        ListingsWidget().updateAll(applicationContext)
        return outcome
    }

    private suspend fun fetchInto(nowMs: Long): Result = try {
        val listings = ListingsApi.fetch(applicationContext)
        if (listings.isEmpty()) {
            // A 200 with nothing drawable in it. Not stored and not retried, so a widget
            // that already has listings keeps them and a first run shows the empty card.
            Log.w(TAG, "The listing search returned nothing drawable; keeping the rotation")
            Result.success()
        } else {
            ListingsStore.saveFetched(applicationContext, listings, nowMs)
            // Pruned against the NEW rotation, and before the images are cached below, so
            // the directory holds exactly what the widget can now draw. Doing it the other
            // way round would evict the files this tick just downloaded.
            ListingsImageCache.prune(applicationContext, rotationImageUrls(listings))
            Result.success()
        }
    } catch (cause: IOException) {
        // Transient by nature — no network, a timeout, a 5xx.
        Log.w(TAG, "Could not refresh the listings widget", cause)
        // Only worth retrying while there is nothing to show. Once the widget has content
        // the periodic tick is the next attempt, and backing off on a network that is still
        // down would wake the device to fail again.
        val firstRun = ListingsStore.read(applicationContext).listings.isEmpty()
        when {
            !firstRun -> Result.success()
            runAttemptCount >= MAX_ATTEMPTS -> Result.failure()
            else -> Result.retry()
        }
    } catch (cause: JSONException) {
        // The response was not the shape this build knows how to read. Retrying would fetch
        // the same body again, so it stops here and the widget keeps its last good content
        // until the contract is fixed.
        Log.e(TAG, "The listing search returned a body the widget cannot read", cause)
        Result.failure()
    }

    /**
     * Download every photograph the ROTATION needs, not just the one on screen.
     *
     * Caching only the current listing's picture would be reasoning about the
     * `RemoteViews` payload — a real constraint — and applying it to the DISK cache, which
     * has none. The rotation turns over every thirty seconds with no fetch of its own, so
     * each turn would reveal a listing whose photograph nobody had downloaded, and the card
     * would fall back to flat colour until a fetch hours later happened to land on it.
     *
     * At most five files, and only the ones not already cached. Failures are per-file and
     * silent by design — a picture that will not download costs that card its picture,
     * never the card.
     */
    private suspend fun cacheRotationImages() {
        val listings = ListingsStore.read(applicationContext).listings
        rotationImageUrls(listings).forEach { url ->
            ListingsImageCache.ensureCached(applicationContext, url)
        }
    }

    private companion object {
        const val TAG = "HomiioListingsWidget"

        /**
         * Attempts before a first-run fetch gives up. `runAttemptCount` is zero-based, so
         * this allows the first try plus two retries; past that the periodic schedule is
         * the next opportunity anyway.
         */
        const val MAX_ATTEMPTS = 3
    }
}
