package com.homiio.widgets.listings

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.util.Log
import androidx.core.graphics.createBitmap
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Turning a cached photograph FILE into the exact bitmap the card needs.
 *
 * Everything happens in ONE pass — downscale, centre-crop and darken — because each step
 * alone would allocate another full-size bitmap, and this code runs while the launcher is
 * waiting for a composition.
 *
 * The scrim is baked into the pixels because Glance cannot draw one. There is no gradient
 * primitive, no `Modifier.background(Brush)`, and no way to overlay a translucent colour
 * on an `Image` — a `Box` with a coloured child would work only if `RemoteViews`
 * composited children the way Compose does, which it does not. Baked-in also means the
 * scrim cannot be lost: it survives the launcher's crop and it cannot be defeated by a
 * theme, which is the point of the contrast floor it implements (see [IMAGE_SCRIM_ALPHA]).
 *
 * No rounding is applied. The photograph IS the card, so its corners are the card's
 * corners, and those belong to the host: the launcher clips widget content to
 * `system_app_widget_background_radius` itself. A radius baked into the bitmap would draw
 * a second, slightly different curve just inside the host's.
 *
 * Everything that decides HOW BIG the bitmap is lives in `ListingsBitmaps.kt` and is unit
 * tested. This file is the `android.graphics` calls, which are stubs off-device.
 */
internal object ListingsImageRenderer {

    private const val TAG = "HomiioListingsWidget"

    /** `Paint.alpha` is 0–255, while every scrim figure in this module is a fraction. */
    private const val MAX_ALPHA = 255f

    /**
     * Decode [file] into the card's background: [size] pixels, cropped to fill, with
     * [scrimAlpha] of black baked over it.
     *
     * Returns `null` for anything that cannot be decoded — a truncated download, a file
     * that is not an image, a device too low on memory to hold the result. The caller
     * draws no image in that case, which is the same thing it does for a listing that has
     * no photograph at all, so a failure here costs a picture and never a card.
     */
    fun decodeCardBackground(file: File, size: ListingBitmapSize, scrimAlpha: Float): Bitmap? {
        val source = decodeSampled(file, size) ?: return null
        return try {
            cropToFill(source, size, scrimAlpha)
        } catch (cause: OutOfMemoryError) {
            // Caught deliberately, and only around the allocation: a widget must not be
            // the reason a launcher dies, and the honest fallback for a picture that will
            // not fit in memory is no picture.
            Log.w(TAG, "Not enough memory to draw a ${size.widthPx}×${size.heightPx} listing image", cause)
            null
        } finally {
            // `cropToFill` draws `source` into a new bitmap, so the decoded original is
            // dead the moment it returns — including on the failure path above.
            source.recycle()
        }
    }

    /**
     * Decode [file] at the smallest power-of-two reduction that still covers [target].
     *
     * See [sampleSizeFor] for why powers of two and why the exact size is reached by the
     * scaling draw afterwards.
     */
    private fun decodeSampled(file: File, target: ListingBitmapSize): Bitmap? {
        if (!file.isFile || file.length() == 0L) return null

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            Log.w(TAG, "Cached listing image is not a decodable image: ${file.name}")
            return null
        }

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, target)
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return BitmapFactory.decodeFile(file.path, options)
    }

    /**
     * Draw [source] into a [size] bitmap, scaled to COVER and centred, with [scrimAlpha] of
     * black over the result.
     *
     * Cover rather than fit, because the bitmap has a shape of its own that the photograph
     * may not share: fitting would letterbox a portrait shot and leave two transparent
     * columns, where cropping shows the middle of the picture — which is what a reader
     * expects from every other image in a property feed.
     */
    private fun cropToFill(source: Bitmap, size: ListingBitmapSize, scrimAlpha: Float): Bitmap {
        val scale = max(
            size.widthPx.toFloat() / source.width.toFloat(),
            size.heightPx.toFloat() / source.height.toFloat(),
        )
        val matrix = Matrix().apply {
            setScale(scale, scale)
            postTranslate(
                (size.widthPx - source.width * scale) / 2f,
                (size.heightPx - source.height * scale) / 2f,
            )
        }

        val output = createBitmap(size.widthPx, size.heightPx)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply {
                setLocalMatrix(matrix)
            }
        }
        val canvas = Canvas(output)
        canvas.drawPaint(paint)

        if (scrimAlpha > 0f) {
            canvas.drawColor(
                Color.argb(
                    (scrimAlpha.coerceIn(0f, 1f) * MAX_ALPHA).roundToInt(),
                    Color.red(Color.BLACK),
                    Color.green(Color.BLACK),
                    Color.blue(Color.BLACK),
                ),
            )
        }
        return output
    }
}
