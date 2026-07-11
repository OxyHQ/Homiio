/**
 * PropertyImageCarousel — Airbnb-style swipeable photo carousel embedded inside
 * a property card's media box.
 *
 * Behaviour:
 *  - Horizontal, paged scroller: one photo per page, snapping per image. Native
 *    uses touch/drag, web uses mouse/trackpad drag (RN-Web maps the paged
 *    ScrollView to CSS scroll-snap). Tapping (not dragging) forwards to
 *    `onPress` so the card still opens the detail screen.
 *  - Pagination dots overlay the bottom-centre, Airbnb-style, reflecting the
 *    current index. When there are many photos the dot strip is *windowed*
 *    (a fixed number of dots, with the edge dots shrinking) so it never grows
 *    unbounded.
 *  - Virtualised: backed by a `FlatList` with windowing so a long vertical list
 *    of cards never eagerly mounts every photo of every card — only the current
 *    page and its immediate neighbours are realised.
 *  - 0 photos → a single placeholder, no dots, no scroller. 1 photo → a static
 *    image, no dots, no scroller (nothing to page through).
 *
 * Presentation only: the caller owns the aspect ratio, corner radius and any
 * overlay chrome (favourite heart, price, badges), which render on top of the
 * carousel via `children`.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/styles/colors';
import { ZoomableImage } from '@/components/ui/ZoomableImage';
import {
  type ImageDisplaySource,
  getPropertyImageSources,
} from '@/utils/propertyUtils';
import type { Property, PropertyImage } from '@homiio/shared-types';

/**
 * Largest number of dots ever rendered. Beyond this the strip is windowed:
 * the active dot stays centred and the dots nearest the ends shrink to signal
 * "more photos this way" without the strip growing with the photo count.
 * Mirrors the Instagram/Airbnb in-card dot affordance.
 */
const MAX_VISIBLE_DOTS = 5;

/**
 * Web-only hover navigation arrows. A horizontal `FlatList` renders as a
 * scroll `div` on RN-Web: wheel/trackpad scrolls it, but a mouse click-drag
 * does NOT pan it, so a desktop pointer user cannot move between photos.
 * Airbnb's answer is hover-revealed circular chevrons — these constants size
 * that affordance. Native (touch) never shows them; swipe is the gesture.
 */
const NAV_ARROW_SIZE = 30;
const NAV_ARROW_ICON_SIZE = 16;
const NAV_ARROW_INSET = 8;
/** Hover affordance is pointer-only, so it is gated to the web platform. */
const SUPPORTS_HOVER_ARROWS = Platform.OS === 'web';

interface PropertyImageCarouselProps {
  /**
   * Photos to page through. Accepts the `Property.images` union (string URLs or
   * `PropertyImage` objects) or a pre-built source array. Empty/undefined
   * renders the shared placeholder.
   */
  images: Property['images'] | (string | PropertyImage)[] | undefined;
  /**
   * Index into `images` of the host's cover photo (`Property.coverImageIndex`).
   * When valid, that photo is shown first (Airbnb cover-first). Ignored when
   * undefined/out of range. Ordering is owned by `getPropertyImageSources`.
   */
  coverIndex?: number;
  /** Width / height ratio of the media box (e.g. `1` square, `4 / 3`). */
  aspectRatio: number;
  /** Corner radius of the media box, so each page clips to the card. */
  borderRadius: number;
  /**
   * Controlled zoom signal from the enclosing card — when the whole card is
   * hovered (or pressed), the visible photo zooms inside its mask. Threaded down
   * to each page's `ZoomableImage`, OR-ed with the page's own touch press.
   */
  imageActive?: boolean;
  /** Tap (not swipe) handler — keeps the card tappable to open the detail. */
  onPress?: () => void;
  /** Fires immediately before the press settles, used to prefetch detail data. */
  onPressIn?: () => void;
  onLongPress?: () => void;
  /** Notifies the parent of the active page (e.g. to sync external chrome). */
  onIndexChange?: (index: number) => void;
  /** Accessibility label for the tappable media (the property title). */
  accessibilityLabel?: string;
  /** Overlay chrome rendered above the photos (heart, badges, price). */
  children?: React.ReactNode;
}

interface CarouselPageProps {
  source: ImageDisplaySource;
  width: number;
  /**
   * Explicit pixel height for the page. Required on web: the page's parent (the
   * RN-Web `FlatList` item wrapper) has no intrinsic height, so a `height: '100%'`
   * page collapses to 0 and the photo paints blank. Driving the height with the
   * measured container height (or its `aspectRatio`-derived estimate) gives the
   * page real pixels to fill.
   */
  height: number;
  /**
   * When the measured `width`/`height` is still 0 (e.g. an early/late `onLayout`
   * on web), fall back to a `100%`-sized page so the photo fills its parent
   * immediately. Only the single-image branch opts in — the multi-page
   * `FlatList` needs exact pixel page widths for its paging math, so it leaves
   * this off and gates its mount on `containerWidth > 0`.
   */
  fillWhenUnmeasured?: boolean;
  /** Card-level hover/press signal, OR-ed with this page's own touch press. */
  imageActive?: boolean;
  onPress?: () => void;
  onPressIn?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
}

/**
 * A single full-bleed photo page. Wrapped in a `Pressable` so a tap opens the
 * detail screen while a horizontal drag is consumed by the parent scroller —
 * React Native's responder system hands the gesture to the scroll view once it
 * travels horizontally, so the press only fires on a genuine tap.
 *
 * The photo zooms inside the page's rounded mask when the whole card is hovered
 * (web, via `imageActive`) or the page is pressed (native) — the Airbnb move; the
 * card never scales.
 *
 * Uses React Native's `Image` (not `expo-image`): `expo-image` fails to paint
 * remote photos on web here, leaving the page blank while the chrome renders
 * (mirrors the fix in `HomeCategoryStrip`/`PhotoGallery`). `source` is an
 * `ImageDisplaySource` (`{ uri }` web URL or the bundled placeholder module),
 * which RN `Image` accepts on both web and native.
 */
const CarouselPage: React.FC<CarouselPageProps> = ({
  source,
  width,
  height,
  fillWhenUnmeasured = false,
  imageActive,
  onPress,
  onPressIn,
  onLongPress,
  accessibilityLabel,
}) => {
  // Local press state drives the native press-zoom; the card's hover is fed in
  // via `imageActive` (web). Static-array style + state, never function-form
  // `style`. `ZoomableImage` is controlled here (the card owns hover).
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
        onPressIn?.();
      }}
      onPressOut={() => setPressed(false)}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.page,
        fillWhenUnmeasured && (width <= 0 || height <= 0)
          ? styles.pageFill
          : { width, height },
      ]}
    >
      <ZoomableImage active={Boolean(imageActive) || pressed} style={styles.pageZoom}>
        <Image source={source} style={styles.image} resizeMode="cover" />
      </ZoomableImage>
    </Pressable>
  );
};

interface NavArrowProps {
  direction: 'prev' | 'next';
  onPress: () => void;
  /** Accessibility label (e.g. "Previous photo"). */
  accessibilityLabel: string;
}

/**
 * A single circular chevron button overlaying the photo (web only). Rendered as
 * a sibling of the `FlatList` so its press is its own target and never bubbles
 * to the page tap that opens the detail screen. Owns its own pressed state — a
 * StyleSheet array (not the NativeWind-incompatible function-form `style`)
 * drives the pressed tint, per the project's NativeWind v4 constraint.
 */
const NavArrow: React.FC<NavArrowProps> = ({ direction, onPress, accessibilityLabel }) => {
  const [pressed, setPressed] = useState(false);
  const isPrev = direction === 'prev';
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.navArrow,
        isPrev ? styles.navArrowLeft : styles.navArrowRight,
        pressed ? styles.navArrowPressed : null,
      ]}
    >
      <Ionicons
        name={isPrev ? 'chevron-back' : 'chevron-forward'}
        size={NAV_ARROW_ICON_SIZE}
        color={colors.COLOR_BLACK}
      />
    </Pressable>
  );
};

interface PaginationDotsProps {
  count: number;
  activeIndex: number;
}

/**
 * Windowed pagination dots. Up to {@link MAX_VISIBLE_DOTS} dots are drawn; with
 * more photos the window slides to keep the active dot near the centre and the
 * dots at the edge of the window shrink to hint at the overflow.
 */
const PaginationDots: React.FC<PaginationDotsProps> = ({ count, activeIndex }) => {
  const { start, showLeadingShrink, showTrailingShrink } = useMemo(() => {
    if (count <= MAX_VISIBLE_DOTS) {
      return { start: 0, showLeadingShrink: false, showTrailingShrink: false };
    }
    const half = Math.floor(MAX_VISIBLE_DOTS / 2);
    const clampedStart = Math.min(
      Math.max(activeIndex - half, 0),
      count - MAX_VISIBLE_DOTS,
    );
    return {
      start: clampedStart,
      showLeadingShrink: clampedStart > 0,
      showTrailingShrink: clampedStart + MAX_VISIBLE_DOTS < count,
    };
  }, [count, activeIndex]);

  const windowIndices = useMemo(
    () => Array.from({ length: Math.min(MAX_VISIBLE_DOTS, count) }, (_, i) => start + i),
    [count, start],
  );

  return (
    <View style={[styles.dotsRow, { pointerEvents: 'none' }]}>
      {windowIndices.map((dotIndex, position) => {
        const isFirstInWindow = position === 0;
        const isLastInWindow = position === windowIndices.length - 1;
        const isShrunk =
          (isFirstInWindow && showLeadingShrink) ||
          (isLastInWindow && showTrailingShrink);
        const isActive = dotIndex === activeIndex;
        return (
          <View
            key={dotIndex}
            style={[
              styles.dot,
              isShrunk ? styles.dotShrunk : null,
              isActive ? styles.dotActive : null,
            ]}
          />
        );
      })}
    </View>
  );
};

export const PropertyImageCarousel: React.FC<PropertyImageCarouselProps> = ({
  images,
  coverIndex,
  aspectRatio,
  borderRadius,
  imageActive,
  onPress,
  onPressIn,
  onLongPress,
  onIndexChange,
  accessibilityLabel,
  children,
}) => {
  const sources = useMemo<ImageDisplaySource[]>(
    () => getPropertyImageSources(images, coverIndex, 'medium'),
    [images, coverIndex],
  );

  const listRef = useRef<FlatList<ImageDisplaySource>>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // Web-only: the hover arrows are hidden until the pointer is over the media.
  const [hovered, setHovered] = useState(false);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
    setContainerHeight(event.nativeEvent.layout.height);
  }, []);

  /**
   * Pixel height each page fills. On web a `height: '100%'` page collapses to 0
   * (the RN-Web `FlatList` item wrapper has no intrinsic height), so pages get
   * an explicit pixel height. Prefer the measured container height; before
   * `onLayout` settles, derive it from the known `aspectRatio` so the first
   * paint already has a height (0 only when width is also still unmeasured).
   */
  const pageHeight = useMemo(
    () => (containerHeight > 0 ? containerHeight : containerWidth / aspectRatio),
    [containerHeight, containerWidth, aspectRatio],
  );

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (containerWidth <= 0) return;
      const next = Math.round(event.nativeEvent.contentOffset.x / containerWidth);
      const clamped = Math.max(0, Math.min(next, sources.length - 1));
      setActiveIndex((prev) => {
        if (prev !== clamped) onIndexChange?.(clamped);
        return clamped;
      });
    },
    [containerWidth, sources.length, onIndexChange],
  );

  /**
   * Page to a specific photo from the web hover arrows. The web scroll-end
   * event can be flaky, so we drive the dots/index optimistically here in
   * addition to asking the list to scroll — `getItemLayout` makes
   * `scrollToIndex` exact and safe even for not-yet-realised pages.
   */
  const goToIndex = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(target, sources.length - 1));
      listRef.current?.scrollToIndex({ index: clamped, animated: true });
      setActiveIndex((prev) => {
        if (prev !== clamped) onIndexChange?.(clamped);
        return clamped;
      });
    },
    [sources.length, onIndexChange],
  );

  const goPrev = useCallback(() => goToIndex(activeIndex - 1), [goToIndex, activeIndex]);
  const goNext = useCallback(() => goToIndex(activeIndex + 1), [goToIndex, activeIndex]);

  const keyExtractor = useCallback(
    (item: ImageDisplaySource, index: number) =>
      typeof item === 'object' && item !== null && 'uri' in item
        ? `${item.uri}-${index}`
        : `placeholder-${index}`,
    [],
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<ImageDisplaySource> | null | undefined, index: number) => ({
      length: containerWidth,
      offset: containerWidth * index,
      index,
    }),
    [containerWidth],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ImageDisplaySource>) => (
      <CarouselPage
        source={item}
        width={containerWidth}
        height={pageHeight}
        imageActive={imageActive}
        onPress={onPress}
        onPressIn={onPressIn}
        onLongPress={onLongPress}
        accessibilityLabel={accessibilityLabel}
      />
    ),
    [containerWidth, pageHeight, imageActive, onPress, onPressIn, onLongPress, accessibilityLabel],
  );

  const isMultiPage = sources.length > 1;
  // Web pointer users can't drag a scroll div between photos, so reveal Airbnb-
  // style chevrons on hover. Hidden on the first/last page (no wrap-around).
  const showArrows = SUPPORTS_HOVER_ARROWS && isMultiPage && hovered;
  const showPrevArrow = showArrows && activeIndex > 0;
  const showNextArrow = showArrows && activeIndex < sources.length - 1;

  return (
    <View
      style={[styles.container, { aspectRatio, borderRadius }]}
      onLayout={handleLayout}
      // Pointer enter/leave (not the Pressable-only onHoverIn/Out) so a plain
      // layout View can host the hover state. enter/leave fire on the View's own
      // boundary (they don't bubble from the photo pages), and map to mouseenter/
      // mouseleave on RN-Web. No-ops on native — touch never produces hover.
      onPointerEnter={SUPPORTS_HOVER_ARROWS ? () => setHovered(true) : undefined}
      onPointerLeave={SUPPORTS_HOVER_ARROWS ? () => setHovered(false) : undefined}
    >
      {isMultiPage && containerWidth > 0 ? (
        <FlatList
          ref={listRef}
          data={sources}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          onMomentumScrollEnd={handleMomentumEnd}
          // Virtualisation: realise only the current page and its neighbours so
          // a long vertical list of cards never mounts every photo at once.
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
          decelerationRate="fast"
          // Disallow the outer vertical list from stealing the gesture mid-swipe
          // on Android so a horizontal drag pages cleanly.
          disableIntervalMomentum
        />
      ) : (
        <CarouselPage
          source={sources[0]}
          width={containerWidth}
          height={pageHeight}
          fillWhenUnmeasured
          imageActive={imageActive}
          onPress={onPress}
          onPressIn={onPressIn}
          onLongPress={onLongPress}
          accessibilityLabel={accessibilityLabel}
        />
      )}

      {/* Caller chrome (heart, badges, price) — rendered UNDER the dots + arrows
          so it can never paint over or intercept the nav arrows. Its own
          absolutely-positioned bits sit in the corners, clear of the arrows. */}
      {children}

      {isMultiPage ? (
        <PaginationDots count={sources.length} activeIndex={activeIndex} />
      ) : null}

      {/* Web hover arrows — the TOPMOST interactive layer over the photo, and
          siblings of the FlatList so each is its own press target that never
          bubbles to the page tap that opens the detail. */}
      {showPrevArrow ? (
        <NavArrow direction="prev" onPress={goPrev} accessibilityLabel="Previous photo" />
      ) : null}
      {showNextArrow ? (
        <NavArrow direction="next" onPress={goNext} accessibilityLabel="Next photo" />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  // The page's size comes from the explicit `width`/`height` props (or the
  // `pageFill` fallback) — never `height: '100%'`, which collapses to 0 on web
  // against the unsized RN-Web FlatList item wrapper. `overflow: hidden` clips
  // the cover-resized image to the page bounds.
  page: {
    overflow: 'hidden',
  },
  pageFill: {
    width: '100%',
    height: '100%',
  },
  // The masked zoom wrapper fills the page so the photo scales inside the page
  // bounds (and the carousel's rounded container) without moving the layout.
  pageZoom: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  dotsRow: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    zIndex: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  dotShrunk: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.7,
  },
  dotActive: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.white,
  },
  // Web hover navigation arrows. Vertically centred over the photo and inset
  // from each edge, layered above the dots. White circle + subtle shadow +
  // dark chevron, matching the Airbnb in-card affordance.
  navArrow: {
    position: 'absolute',
    top: '50%',
    width: NAV_ARROW_SIZE,
    height: NAV_ARROW_SIZE,
    borderRadius: NAV_ARROW_SIZE / 2,
    marginTop: -NAV_ARROW_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    zIndex: 2,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }
      : null),
  },
  navArrowLeft: {
    left: NAV_ARROW_INSET,
  },
  navArrowRight: {
    right: NAV_ARROW_INSET,
  },
  navArrowPressed: {
    backgroundColor: colors.white,
    opacity: 0.9,
  },
});

export default PropertyImageCarousel;
