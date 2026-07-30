package com.homiio.widgets.listings

import android.appwidget.AppWidgetManager
import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver

/**
 * The widget's manifest entry point, and the only place its ticks are started or stopped.
 *
 * Tying the WorkManager jobs to these callbacks is what keeps the widget from costing
 * anything until someone uses one: nothing is scheduled before the first is placed, and
 * nothing survives the last one being removed.
 */
class ListingsWidgetReceiver : GlanceAppWidgetReceiver() {

    override val glanceAppWidget: GlanceAppWidget = ListingsWidget()

    /** First widget placed: start both ticks and fill it immediately. */
    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        ListingsRefreshScheduler.ensureScheduled(context)
        ListingsRefreshScheduler.ensureAutoAdvance(context)
        ListingsRefreshScheduler.refreshNow(context)
    }

    /**
     * The system asking for a redraw — after a reboot, an app update, or a locale change.
     *
     * `ensureScheduled` is repeated here rather than left to `onEnabled` alone because
     * `onEnabled` fires once, ever, for the first instance: if WorkManager's own records
     * are lost (a "clear data", a restore onto a new device) there would otherwise be no
     * second chance to reschedule, and the widget would sit on one listing forever.
     * `ExistingPeriodicWorkPolicy.KEEP` makes the repeat a no-op when the job is there.
     *
     * The automatic-turn chain is restarted from here for a second reason: it deliberately
     * stops itself whenever the screen is off, rather than turning a card nobody can see.
     * This is where it picks back up — `onUpdate` fires when the launcher comes back to a
     * home screen holding the widget — and `ExistingWorkPolicy.KEEP` is what stops a burst
     * of updates from forking the chain or resetting its delay forever.
     */
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        ListingsRefreshScheduler.ensureScheduled(context)
        ListingsRefreshScheduler.ensureAutoAdvance(context)
    }

    /**
     * Last one removed: stop every job, and drop the rotation.
     *
     * The jobs are cancelled FIRST so nothing can write the rotation back after it has been
     * dropped. Both are housekeeping rather than privacy — this widget holds nothing
     * private, see `ListingsStore.kt` — but a self-rescheduling chain that outlives the
     * widget it belongs to never stops, which is the leak that actually matters here.
     */
    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        ListingsRefreshScheduler.cancel(context)
        ListingsRefreshScheduler.forgetRotation(context)
    }
}
