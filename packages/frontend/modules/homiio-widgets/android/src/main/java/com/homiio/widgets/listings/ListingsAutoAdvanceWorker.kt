package com.homiio.widgets.listings

import android.content.Context
import android.os.PowerManager
import androidx.core.content.getSystemService
import androidx.glance.appwidget.updateAll
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Turns the rotation over on its own, fast enough to be seen.
 *
 * `PeriodicWork` is floored at fifteen minutes, nobody watching a home screen ever sees a
 * fifteen-minute turn, and `RemoteViews` has no gestures — a widget cannot be swiped, so
 * there is no way for a reader to ask for the next listing themselves. An automatic turn
 * is therefore the only way anyone sees more than one of the five. A chain of ONE-TIME
 * requests takes an arbitrary `setInitialDelay` and is not subject to the floor.
 *
 * ADVANCING NEEDS NO NETWORK: the batch is already in the store, so a step is a position
 * write and a redraw, and it keeps working while the device is offline.
 *
 * IT STOPS BY NOT ADVANCING, not by ending the chain — see [autoAdvanceTick] for why those
 * are different and why only the first is safe.
 */
internal class ListingsAutoAdvanceWorker(
    context: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {

    override suspend fun doWork(): Result {
        // The chain is cancelled when the last widget goes, but a link can already be
        // pending; without this it would keep re-arming itself forever against a store
        // nothing reads.
        if (!anyPlaced(applicationContext)) {
            return Result.success()
        }

        val power = applicationContext.getSystemService<PowerManager>()
        val tick = autoAdvanceTick(screenInteractive = power?.isInteractive == true)

        if (tick.advance) {
            ListingsStore.advance(applicationContext)
            ListingsWidget().updateAll(applicationContext)
        }
        if (tick.rearm) {
            ListingsRefreshScheduler.scheduleNextAutoAdvance(applicationContext)
        }
        return Result.success()
    }
}
