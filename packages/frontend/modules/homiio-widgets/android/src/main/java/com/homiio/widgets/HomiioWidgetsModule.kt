package com.homiio.widgets

import com.homiio.widgets.listings.ListingsRefreshScheduler
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS side of Homiio's home-screen widget.
 *
 * Deliberately tiny, and it will stay that way. A widget has to work while the app is not
 * running — its worker fetches on a schedule of its own and it can be placed before the
 * app has ever been opened — so it owns its data end to end in Kotlin: fetch, store,
 * render, deep link. Anything JS also did would be a second copy of that path, correct
 * only for as long as both stayed in step.
 *
 * What is left for JS is CONTROL, not data.
 */
class HomiioWidgetsModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("HomiioWidgets")

        /**
         * Fetch the listings now.
         *
         * Returns as soon as the work is enqueued; the fetch itself runs in WorkManager
         * under the same network constraint as the periodic refresh, and is a no-op when
         * no listings widget is on the home screen.
         *
         * Worth calling from the app when it has reason to believe the newest listings have
         * moved — the widget's own fetch interval is three hours, and a user who has just
         * seen new results in the app should not find the widget three hours behind them.
         */
        AsyncFunction("refreshListings") {
            val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
            ListingsRefreshScheduler.refreshNow(context)
        }
    }
}
