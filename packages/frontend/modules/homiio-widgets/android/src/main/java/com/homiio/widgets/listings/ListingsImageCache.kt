package com.homiio.widgets.listings

import android.content.Context
import android.util.Log
import com.homiio.widgets.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * The card's photographs, on disk.
 *
 * A widget composition cannot fetch anything: `provideGlance` runs while the launcher
 * waits for a `RemoteViews`, so an HTTP request in there would stall the home screen for
 * as long as the network takes. Every picture is therefore downloaded by the refresh
 * WORKER, ahead of the redraw, and the composition only ever reads a local file.
 *
 * What gets downloaded is the WHOLE ROTATION's pictures, not just the one on screen. The
 * distinction matters because the rotation turns over every thirty seconds while the fetch
 * runs on a clock measured in hours: caching only the visible listing would mean every
 * turn reveals a card whose photograph nobody has downloaded, and it would stay missing
 * until the next fetch happened to land on it. Five files is the working set, and [prune]
 * is what keeps it five over months of use rather than accumulating every listing the feed
 * has ever shown.
 */
internal object ListingsImageCache {

    private const val TAG = "HomiioListingsWidget"

    /** Where the files live, inside the app's own private cache directory. */
    private const val DIRECTORY_NAME = "homiio_widget_listing_images"

    private val CONNECT_TIMEOUT_MS = TimeUnit.SECONDS.toMillis(10).toInt()
    private val READ_TIMEOUT_MS = TimeUnit.SECONDS.toMillis(20).toInt()

    /**
     * Most bytes read from one image.
     *
     * The URLs the widget is handed are the `medium` variant, tens of kilobytes each, so
     * this is not a budget — it is a bound on a response that turns out not to be what it
     * claimed. Without it a mis-resolved URL pointing at a video file would be streamed to
     * the device's disk in full, on a metered connection, in the background.
     */
    private const val MAX_IMAGE_BYTES = 4L * 1024 * 1024

    /** Read buffer. 16KB is the JDK's own default for stream copies. */
    private const val COPY_BUFFER_BYTES = 16 * 1024

    /**
     * Whether [url] is one the widget is willing to fetch.
     *
     * A HOST ALLOWLIST of exactly ONE origin — the configured API — because the
     * alternative is a background job on someone's phone fetching whatever URL arrives in
     * a JSON body.
     *
     * One origin is enough here, and that is a property of Homiio's ingest rather than a
     * simplification: the pipeline downloads every external photograph, re-processes it
     * and re-hosts it, and the repository's own rule is that a portal CDN URL is NEVER
     * stored as a runtime image URL. So every picture this widget can be asked for is
     * served from Homiio's own API. A URL pointing anywhere else is not a picture this
     * widget was meant to load, and fetching it would leak the device's address to a
     * portal the app itself never contacts directly.
     *
     * A rejected URL costs the card its picture and is logged; it never costs the card.
     */
    private fun isAllowed(context: Context, url: URL): Boolean {
        if (url.protocol != "https" && url.protocol != "http") return false
        val allowedHost = runCatching {
            URL(context.getString(R.string.homiio_widget_api_base_url)).host
        }.getOrNull() ?: return false
        return url.host == allowedHost
    }

    /**
     * The file [url] is cached at, whether or not it has been downloaded.
     *
     * Named by a SHA-256 of the URL: a fixed-length name with no path separators or query
     * punctuation in it, so no URL can escape the cache directory or collide with another.
     * The URL is the whole key, which means two variants of one photograph are different
     * entries, as they should be.
     */
    private fun fileFor(context: Context, url: String): File {
        val digest = MessageDigest.getInstance("SHA-256").digest(url.toByteArray())
        val name = digest.joinToString(separator = "") { byte -> "%02x".format(byte) }
        return File(directory(context), name)
    }

    private fun directory(context: Context): File =
        File(context.applicationContext.cacheDir, DIRECTORY_NAME)

    /**
     * The cached file for [url] if it is ALREADY on disk, and `null` otherwise.
     *
     * What a composition is allowed to call. It never downloads: composing runs while the
     * launcher waits for its `RemoteViews`, so a fetch here would stall the home screen —
     * and if the file is missing the card falls back to its tonal container. The worker's
     * [ensureCached] is what makes it present in the first place.
     *
     * The emptiness check matters because the system may clear the cache directory at any
     * moment, including between the worker's download and the next composition.
     */
    fun fileForComposition(context: Context, url: String): File? {
        val file = fileFor(context, url)
        return if (file.isFile && file.length() > 0L) file else null
    }

    /**
     * The local file for [url], downloading it if it is not already there.
     *
     * Returns `null` for every failure — a URL off the allowlist, a dead host, a response
     * that is not an image — because the caller's only options are to draw the picture or
     * not, and it has a layout that collapses cleanly when there is none.
     *
     * An already-cached file is NEVER re-downloaded. These URLs are content-addressed (the
     * ingest names each variant after a UUID it minted when it re-hosted the picture), so
     * the bytes behind one do not change; re-fetching would spend a request to receive the
     * same image.
     */
    suspend fun ensureCached(context: Context, url: String): File? = withContext(Dispatchers.IO) {
        val parsed = try {
            URL(url)
        } catch (cause: MalformedURLException) {
            Log.w(TAG, "Listing image URL is not a URL", cause)
            return@withContext null
        }
        if (!isAllowed(context, parsed)) {
            Log.w(TAG, "Refusing to fetch a listing image from an unexpected host: ${parsed.host}")
            return@withContext null
        }

        val file = fileFor(context, url)
        if (file.isFile && file.length() > 0L) return@withContext file

        try {
            download(parsed, file)
            file
        } catch (cause: IOException) {
            Log.w(TAG, "Could not cache a listing image", cause)
            // A partial file would be indistinguishable from a good one next time.
            file.delete()
            null
        }
    }

    /**
     * Fetch [url] into [destination].
     *
     * Written to a temporary file and renamed, so a download interrupted by the process
     * being killed can never leave a half-written image that the next composition would
     * read as complete.
     */
    private fun download(url: URL, destination: File) {
        destination.parentFile?.mkdirs()
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            setRequestProperty("Accept", "image/*")
        }
        try {
            val status = connection.responseCode
            if (status != HttpURLConnection.HTTP_OK) {
                throw IOException("Image request responded $status")
            }
            // The bytes are handed to `BitmapFactory`, so a response that is not an image
            // is caught here rather than by a decode that returns null for reasons nobody
            // can distinguish afterwards.
            val contentType = connection.contentType?.substringBefore(';')?.trim().orEmpty()
            if (!contentType.startsWith("image/")) {
                throw IOException("Image request returned ${contentType.ifEmpty { "no content type" }}")
            }

            val temporary = File(destination.parentFile, "${destination.name}.part")
            try {
                connection.inputStream.use { input ->
                    temporary.outputStream().use { output ->
                        val buffer = ByteArray(COPY_BUFFER_BYTES)
                        var total = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            total += read
                            if (total > MAX_IMAGE_BYTES) {
                                throw IOException("Image exceeded $MAX_IMAGE_BYTES bytes")
                            }
                            output.write(buffer, 0, read)
                        }
                    }
                }
                if (!temporary.renameTo(destination)) {
                    throw IOException("Could not move the downloaded image into place")
                }
            } finally {
                // A no-op on the success path — the rename already moved it.
                temporary.delete()
            }
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Delete every cached image except the ones [keep] names.
     *
     * Called after each successful fetch with the URLs the stored rotation references, so
     * the directory holds what the widget can currently draw and nothing else. This is the
     * whole eviction policy: with a rotation of five there is no working set large enough
     * to need ages or sizes weighed against each other.
     */
    fun prune(context: Context, keep: Collection<String>) {
        val files = directory(context).listFiles() ?: return
        val keepNames = keep.map { fileFor(context, it).name }.toSet()
        files.forEach { file ->
            if (file.name !in keepNames && !file.delete()) {
                Log.w(TAG, "Could not evict a cached listing image: ${file.name}")
            }
        }
    }
}
