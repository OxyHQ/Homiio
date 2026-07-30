package com.homiio.widgets.listings

import android.graphics.Bitmap
import android.util.LruCache

/**
 * One decoded photograph per URL, shared across the compositions of a single update.
 *
 * Glance composes the card ONCE PER SIZE the launcher offers — two on a phone, more on a
 * foldable — and each composition needs the same picture. A `remember` cannot help: it is
 * per composition, so each one would decode its own copy and the `RemoteViews` would carry
 * a second 240KB bitmap that is byte-identical to the first. `RemoteViews` deduplicates by
 * INSTANCE IDENTITY (`BitmapCache.getBitmapId`), not by content, so handing every
 * composition the same object is what makes [WORST_CASE_BITMAP_BYTES] a bound on the
 * parcel rather than a bound per composition.
 *
 * Process-scoped and deliberately tiny: the working set is one picture per update, and a
 * few entries of slack cover the moment when a rotation turns over between compositions.
 * It is a cache, not a store — losing it costs one decode from a file that is already on
 * disk.
 */
internal object ListingsBitmapCache {

    /**
     * Entries kept. Two would do for a single update; four leaves room for a turn landing
     * mid-update without evicting the picture the other composition is still using.
     */
    private const val MAX_ENTRIES = 4

    private val cache = LruCache<String, Bitmap>(MAX_ENTRIES)

    /** The bitmap for [key], decoding it with [decode] on a miss. */
    fun getOrDecode(key: String, decode: () -> Bitmap?): Bitmap? {
        cache.get(key)?.let { return it }
        val decoded = decode() ?: return null
        cache.put(key, decoded)
        return decoded
    }

    /**
     * The cache key for a background.
     *
     * The size is part of it even though [cardBackgroundBitmapSize] is currently a
     * constant: if it ever stops being one, a key that named only the URL would serve a
     * bitmap of the wrong dimensions to whichever composition asked second.
     */
    fun backgroundKey(url: String, size: ListingBitmapSize): String =
        "bg:$url:${size.widthPx}x${size.heightPx}"
}
