package com.homiio.widgets.theme

import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.glance.GlanceComposable
import androidx.glance.GlanceTheme
// Two different `ColorProvider`s, and both are needed: `androidx.glance.unit` is the TYPE,
// `androidx.glance.color` is the day/night factory that builds one. Same split as
// androidx.glance:glance-material3's own theme file.
import androidx.glance.color.ColorProvider
import androidx.glance.color.ColorProviders
import androidx.glance.color.colorProviders

/**
 * The theme Homiio's widget is drawn in.
 *
 * Material You first: on Android 12+ the widget takes its colours from the user's
 * wallpaper. That is what a bare [GlanceTheme] already does — its default `colors` is
 * Glance's own `DynamicThemeColorProviders`, resolving to the `@android:color/system_*`
 * palette on API 31+ — so the dynamic branch passes no colours at all rather than
 * reimplementing the lookup.
 *
 * ## Why the widget follows the wallpaper when the app deliberately does not
 *
 * Homiio's app pins itself to Bloom's YELLOW preset in LIGHT mode (`app/_layout.tsx`), and
 * that is right for a surface the app owns. A widget is not such a surface: it sits on the
 * user's home screen among other apps' widgets, and Android's whole widget design language
 * asks it to blend with the wallpaper rather than to plant a brand colour on it. So the two
 * diverge on purpose, and it costs almost nothing visually — this card is a photograph
 * behind a scrim with fixed light text, so the theme shows only on the tonal container
 * behind a listing with no photograph and on the first-run card's button.
 *
 * Below API 31 there is no wallpaper palette to read, and Glance's fallback is the Material
 * BASELINE scheme (the stock purple). A Homiio widget sitting next to the Homiio app should
 * not be purple, so the fallback is [HomiioWidgetColors].
 */
@Composable
fun HomiioGlanceTheme(content: @GlanceComposable @Composable () -> Unit) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        GlanceTheme(content = content)
    } else {
        GlanceTheme(colors = HomiioWidgetColors, content = content)
    }
}

/**
 * Homiio's palette as a Material 3 role set, for the devices that have no dynamic colour.
 *
 * GENERATED, not authored. Every value below is Bloom's colour engine resolving the
 * `yellow` preset — seed `#ffc300`, variant `vivid`, the preset `app/_layout.tsx` pins —
 * into the full Material 3 role set for light and dark:
 *
 *     const base = 'node_modules/@oxyhq/bloom/lib/commonjs/theme/'
 *     const { generateRoleColors } = require(base + 'color-engine/index.js')
 *     const { APP_COLOR_PRESETS } = require(base + 'color-presets.js')
 *     const p = APP_COLOR_PRESETS.yellow
 *     generateRoleColors({ seed: p.hex, variant: p.variant, isDark: false })
 *
 * Both day AND night are provided even though the app itself runs light-only, for the same
 * reason the dynamic branch exists: this is the user's home screen, and a light card on a
 * dark one is a bright rectangle at night.
 *
 * `widgetBackground` is the one role Bloom has no equivalent for — it is a widget-only
 * Material role — so it is derived the way `glance-material3` derives it: take
 * `secondaryContainer` into HCT and shift its tone by +5 when the tone is above 50, by −10
 * otherwise (see `adjustColorToneForWidgetBackground` in androidx.glance:glance-material3).
 *
 * Regenerate rather than hand-edit if the app's preset ever changes.
 */
internal val HomiioWidgetColors: ColorProviders = colorProviders(
    primary = ColorProvider(day = Color(0xFF785A00), night = Color(0xFFF8BE00)),
    onPrimary = ColorProvider(day = Color(0xFFFFFFFF), night = Color(0xFF3F2E00)),
    primaryContainer = ColorProvider(day = Color(0xFFFFDF9A), night = Color(0xFF5A4300)),
    onPrimaryContainer = ColorProvider(day = Color(0xFF5A4300), night = Color(0xFFFFDF9A)),
    secondary = ColorProvider(day = Color(0xFF6F5D00), night = Color(0xFFE8C400)),
    onSecondary = ColorProvider(day = Color(0xFFFFFFFF), night = Color(0xFF3A3000)),
    secondaryContainer = ColorProvider(day = Color(0xFFFFE168), night = Color(0xFF544600)),
    onSecondaryContainer = ColorProvider(day = Color(0xFF544600), night = Color(0xFFFFE168)),
    tertiary = ColorProvider(day = Color(0xFF666000), night = Color(0xFFD5CB00)),
    onTertiary = ColorProvider(day = Color(0xFFFFFFFF), night = Color(0xFF353200)),
    tertiaryContainer = ColorProvider(day = Color(0xFFF3E700), night = Color(0xFF4C4800)),
    onTertiaryContainer = ColorProvider(day = Color(0xFF4C4800), night = Color(0xFFF3E700)),
    error = ColorProvider(day = Color(0xFFBA1A1A), night = Color(0xFFFFB4AB)),
    errorContainer = ColorProvider(day = Color(0xFFFFDAD6), night = Color(0xFF93000A)),
    onError = ColorProvider(day = Color(0xFFFFFFFF), night = Color(0xFF690005)),
    onErrorContainer = ColorProvider(day = Color(0xFF93000A), night = Color(0xFFFFDAD6)),
    background = ColorProvider(day = Color(0xFFFFF8F2), night = Color(0xFF181306)),
    onBackground = ColorProvider(day = Color(0xFF211B0D), night = Color(0xFFEEE1CA)),
    surface = ColorProvider(day = Color(0xFFFFF8F2), night = Color(0xFF181306)),
    onSurface = ColorProvider(day = Color(0xFF211B0D), night = Color(0xFFEEE1CA)),
    surfaceVariant = ColorProvider(day = Color(0xFFF0E1C5), night = Color(0xFF4F4631)),
    onSurfaceVariant = ColorProvider(day = Color(0xFF4F4631), night = Color(0xFFD3C5AA)),
    outline = ColorProvider(day = Color(0xFF82765F), night = Color(0xFF9C8F77)),
    inverseOnSurface = ColorProvider(day = Color(0xFFFDEFD8), night = Color(0xFF373020)),
    inverseSurface = ColorProvider(day = Color(0xFF373020), night = Color(0xFFEEE1CA)),
    inversePrimary = ColorProvider(day = Color(0xFFF8BE00), night = Color(0xFF785A00)),
    widgetBackground = ColorProvider(day = Color(0xFFFFF0C0), night = Color(0xFF3A3000)),
)
