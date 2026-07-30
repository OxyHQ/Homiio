package com.homiio.widgets.listings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * The rotation the widget is showing: the listings, and which one is up.
 *
 * ## THIS STORE HOLDS NOTHING PRIVATE, AND THAT IS A CONTRACT
 *
 * Everything in here is the result of an ANONYMOUS request — the same public
 * `/api/properties/search` an unauthenticated visitor gets, with no bearer, no session and
 * no account behind it. So a rotation is not "someone's" rotation: two devices that fetch
 * a second apart hold the same five listings, and there is nothing on this home screen
 * that a stranger reading it over a shoulder learns about its owner.
 *
 * That is why this store has no account stamp, unlike the equivalent store behind
 * Mention's following widget, which records the account a rotation was fetched for and
 * reports a rotation belonging to any OTHER account as empty. THE MOMENT THIS WIDGET
 * AUTHENTICATES — a saved search, a shortlist, anything keyed to a person — that stamp
 * stops being unnecessary and becomes load-bearing, because a rotation left on disk across
 * an account switch would render one person's private search under another person's name.
 * Adding a bearer to `ListingsApi` without also adding the stamp here, a signed-out state
 * to the card, and a `clear` on sign-out would be a privacy regression, not a feature.
 * `FollowingSession.kt` and `FeedRotationStore.rotationFor` in Mention's widget module are
 * the worked example.
 *
 * ## Why a DataStore, and why app-scoped
 *
 * It is a [DataStore] rather than SharedPreferences for the [Flow]. A Glance session that
 * is already running does not re-enter `provideGlance` when `updateAll` is called, so a
 * widget reading a non-reactive source would sit on whatever it read when its session
 * started — which for a widget whose whole behaviour is turning over would mean it never
 * turned over.
 *
 * One store for the whole app rather than one per widget instance: two listings widgets on
 * the same home screen show the same rotation, so one store means one write per tick, and
 * a widget placed while the app is running paints real content on its first frame instead
 * of an empty box.
 */
private val Context.listingsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "homiio_widget_listings",
)

internal object ListingsStore {

    private val KEY_LISTINGS = stringPreferencesKey("listings")
    private val KEY_INDEX = intPreferencesKey("index")
    private val KEY_FETCHED_AT = longPreferencesKey("fetchedAt")

    /** Emits on every write, which is what re-renders a live widget. */
    fun rotation(context: Context): Flow<ListingRotation> =
        context.applicationContext.listingsDataStore.data.map { preferences ->
            rotationFor(
                storedListings = preferences[KEY_LISTINGS],
                storedIndex = preferences[KEY_INDEX],
                storedFetchedAtMs = preferences[KEY_FETCHED_AT],
            )
        }

    /** The rotation as it stands right now. */
    suspend fun read(context: Context): ListingRotation = rotation(context).first()

    /**
     * Store a freshly fetched rotation.
     *
     * The position resets to the top only when the CONTENT changed. The newest listings
     * are largely the same from one fetch to the next, and resetting on every fetch would
     * put the widget back on listing one every three hours — the rotation would spend most
     * of its life on the first two of five.
     */
    suspend fun saveFetched(context: Context, listings: List<WidgetListing>, fetchedAtMs: Long) {
        context.applicationContext.listingsDataStore.edit { preferences ->
            val previousIds = decodeListings(preferences[KEY_LISTINGS]).map { it.id }
            preferences[KEY_LISTINGS] = encodeListings(listings)
            preferences[KEY_FETCHED_AT] = fetchedAtMs
            if (previousIds != listings.map { it.id }) {
                preferences[KEY_INDEX] = 0
            }
        }
    }

    /**
     * Move to the next listing.
     *
     * The size is read INSIDE the transaction rather than passed in, so an advance can
     * never be computed against a rotation that a concurrent fetch has already replaced.
     */
    suspend fun advance(context: Context) {
        context.applicationContext.listingsDataStore.edit { preferences ->
            val size = decodeListings(preferences[KEY_LISTINGS]).size
            preferences[KEY_INDEX] = nextRotationIndex(preferences[KEY_INDEX] ?: 0, size)
        }
    }

    /**
     * Forget the rotation.
     *
     * Called when the last widget is removed. Nothing here is private (see the contract at
     * the top of this file), so this is housekeeping rather than a privacy measure: a
     * store nothing will read again is a store worth emptying, and a widget placed again
     * months later should fetch rather than paint a rotation from another season's market.
     */
    suspend fun clear(context: Context) {
        context.applicationContext.listingsDataStore.edit { preferences -> preferences.clear() }
    }
}

/**
 * What a store's raw values mean, as a pure function.
 *
 * Pulled out of the flow and made pure so its edge cases are pinned on a plain JVM rather
 * than being reachable only from an instrumented test: an absent index, an absent
 * timestamp, and a listings blob that will not decode all arrive here, and all three have
 * to yield a rotation the card can draw rather than an exception inside a composition the
 * launcher is waiting on.
 */
internal fun rotationFor(
    storedListings: String?,
    storedIndex: Int?,
    storedFetchedAtMs: Long?,
): ListingRotation = ListingRotation(
    listings = decodeListings(storedListings),
    index = storedIndex ?: 0,
    fetchedAtMs = storedFetchedAtMs ?: 0L,
)

/** The stored rotation. */
internal data class ListingRotation(
    val listings: List<WidgetListing>,
    /**
     * Position in [listings]. Read through [listingAt], which brings it into range — a
     * stored index can outlive the rotation it was an index into.
     */
    val index: Int,
    /**
     * When the listings were last fetched, as `System.currentTimeMillis`, or `0` when they
     * never have been. Drives the fetch/turn decision in [shouldFetchRotation].
     */
    val fetchedAtMs: Long,
) {
    /** The listing on screen, or `null` before the first successful fetch. */
    val current: WidgetListing? get() = listingAt(listings, index)
}
