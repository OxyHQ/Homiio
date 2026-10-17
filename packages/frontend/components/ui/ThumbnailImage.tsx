/**
 * ThumbnailImage — an image with a grey-placeholder fallback.
 *
 * The list cards (applications, reservations, exchange requests) each repeated
 * the same `source ? <Image …/> : <View grey-placeholder/>` block. This owns
 * that one rule: render the image when a `source` is present, otherwise a flat
 * grey fill (`bg-muted`).
 *
 * Both branches fill a wrapping `View` (100% × 100%), so the component fills its
 * parent box by default (the cards size it via a fixed-dimension wrapper). Pass
 * `style` to size/shape that wrapper directly.
 */
import type React from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type ImageResizeMode,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export interface ThumbnailImageProps {
  /** Image source. When null/undefined the grey placeholder is shown. */
  source: ImageSourcePropType | null | undefined;
  /** Override the wrapper style (defaults to filling the parent). */
  style?: StyleProp<ViewStyle>;
  /** Image resize mode (defaults to `cover`). */
  resizeMode?: ImageResizeMode;
}

export const ThumbnailImage: React.FC<ThumbnailImageProps> = ({
  source,
  style,
  resizeMode = 'cover',
}) => (
  <View className={source ? undefined : 'bg-muted'} style={[styles.fill, style]}>
    {source ? <Image source={source} style={styles.fill} resizeMode={resizeMode} /> : null}
  </View>
);

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    height: '100%',
  },
});
