package com.homiio.widgets.listings

import android.content.Context
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.glance.GlanceId
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import androidx.glance.state.GlanceStateDefinition
import com.homiio.widgets.theme.HomiioGlanceTheme
import kotlinx.coroutines.flow.first

/**
 * The listings widget: one recently listed home at a time, turning over.
 *
 * [SizeMode.Exact] rather than [SizeMode.Responsive], and the choice matters twice.
 *
 * Correctness first: which blocks the card draws is derived from the height the launcher
 * actually gave it ([visibleBlocks]), so composing against a DECLARED bucket instead of
 * the real placement would hand that derivation the wrong number and the whole design
 * would quietly do the wrong thing at every size the buckets did not name.
 *
 * Payload second: `Responsive` composes EVERY declared size into the same `RemoteViews`,
 * and this card carries a decoded photograph. `Exact` composes for the sizes the launcher
 * genuinely offers, which is what keeps the parcel inside the bound in
 * `ListingsBitmaps.kt`.
 *
 * The content comes only from the store, never from a fetch started here: composing
 * happens while the launcher waits for its `RemoteViews`, so the only thing that touches
 * the network is `ListingsRefreshWorker`.
 */
internal class ListingsWidget : GlanceAppWidget() {

    override val sizeMode: SizeMode = SizeMode.Exact

    /**
     * No per-widget state. Two listings widgets show the same rotation from one app-scoped
     * store, so the default `PreferencesGlanceStateDefinition` would only create an empty
     * preferences file per widget id.
     */
    override val stateDefinition: GlanceStateDefinition<*>? = null

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        // Built once, OUTSIDE the composition: `rotation` returns a fresh Flow per call, and
        // collecting a new instance on every recomposition would resubscribe to DataStore
        // each time.
        val state = ListingsStore.rotation(context)
        val initial = state.first()

        provideContent {
            val current by state.collectAsState(initial = initial)
            HomiioGlanceTheme {
                ListingsCardContent(rotation = current)
            }
        }
    }
}
