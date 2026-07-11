/**
 * ZoomableImage — the shared Airbnb-2026 masked image-zoom primitive.
 *
 * A rounded mask (`overflow: 'hidden'`) wrapping an inner wrapper that scales the
 * image on hover (web) / press (native) while the mask — and therefore the card —
 * stays perfectly still. This is the app-wide REPLACEMENT for whole-card hover/
 * press `scale`: the photo zooms inside its rounded corners, the layout never
 * moves. Every photo tile drops this in so the interaction reads identically.
 *
 * Interaction is CONTROLLED-first: when the caller passes `active`, that drives
 * the zoom (external wins), so a card can zoom its image on hover of the WHOLE
 * card — the card owns one `onPointerEnter/Leave` on its container and feeds
 * `active={hovered || pressed}` down. When `active` is omitted, ZoomableImage
 * falls back to owning its own web hover (pointer enter/leave over the image),
 * for standalone use. Static style arrays + `useState`, per the NativeWind
 * function-form-`style` constraint (AGENTS.md §NativeWind Pressable); it's its own
 * component, so there are never hooks inside a `.map`.
 */
import React, { useState } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const IS_WEB = Platform.OS === 'web';

/** Image scale while active — a subtle Airbnb-style zoom inside the mask. */
const ZOOM = 1.05;

/**
 * Web-only CSS transition so the zoom eases instead of snapping. `transition*`
 * are web CSS values RN's `ViewStyle` lacks, so this block is web-cast (the
 * sanctioned pattern for web-only CSS in this codebase).
 */
const WEB_ZOOM_TRANSITION: ViewStyle | null = IS_WEB
  ? ({
      transitionProperty: 'transform',
      transitionDuration: '400ms',
      transitionTimingFunction: 'cubic-bezier(0.2, 0, 0.2, 1)',
    } as unknown as ViewStyle)
  : null;

/**
 * `will-change: transform` on the MASK fixes a Safari bug where the rounded
 * corners stop clipping the scaling child mid-transform. Web-only CSS → web-cast.
 */
const WEB_MASK_HINT: ViewStyle | null = IS_WEB
  ? ({ willChange: 'transform' } as unknown as ViewStyle)
  : null;

interface ZoomableImageProps {
  /** The image (or media) to zoom — rendered inside the scaling inner wrapper. */
  children: React.ReactNode;
  /** Corner radius of the mask, so the zoom clips to the card. */
  borderRadius?: number;
  /** Width / height ratio of the mask (e.g. `1` square, `4 / 3`). */
  aspectRatio?: number;
  /**
   * Controlled active signal. When provided (defined), it drives the zoom and
   * ZoomableImage does NOT attach its own hover listeners — the card owns hover
   * on its whole container and feeds `active={hovered || pressed}` here, so the
   * image zooms on hover ANYWHERE on the card. When omitted, ZoomableImage owns
   * its own web hover over the image (standalone use).
   */
  active?: boolean;
  /** Extra style for the mask (e.g. fill the parent, background). */
  style?: StyleProp<ViewStyle>;
}

export const ZoomableImage: React.FC<ZoomableImageProps> = ({
  children,
  borderRadius,
  aspectRatio,
  active,
  style,
}) => {
  const controlled = active !== undefined;
  const [hovered, setHovered] = useState(false);
  const isActive = controlled ? active : hovered;

  return (
    <View
      // Uncontrolled fallback only: pointer enter/leave (not Pressable-only
      // onHoverIn/Out) so a plain layout View hosts the hover state; they fire on
      // the mask's own boundary and map to mouseenter/mouseleave on RN-Web. When
      // the caller controls `active`, the card owns hover instead, so these are
      // omitted. No-op on native — touch has no hover.
      onPointerEnter={!controlled && IS_WEB ? () => setHovered(true) : undefined}
      onPointerLeave={!controlled && IS_WEB ? () => setHovered(false) : undefined}
      style={[
        styles.mask,
        borderRadius !== undefined ? { borderRadius } : null,
        aspectRatio !== undefined ? { aspectRatio } : null,
        WEB_MASK_HINT,
        style,
      ]}
    >
      <View
        style={[
          styles.inner,
          WEB_ZOOM_TRANSITION,
          { transform: [{ scale: isActive ? ZOOM : 1 }] },
        ]}
      >
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  mask: {
    overflow: 'hidden',
  },
  inner: {
    width: '100%',
    height: '100%',
  },
});

export default ZoomableImage;
