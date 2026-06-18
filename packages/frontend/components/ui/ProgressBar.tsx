import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { colors } from '@/styles/colors';

/** Default corner radius for the track and fill (matches the legacy look). */
const DEFAULT_BAR_RADIUS = 4;

type ProgressBarProps = {
  progress: number; // 0 to 1
  total?: number;
  current?: number;
  showLabel?: boolean;
  label?: string;
  showPercentage?: boolean;
  color?: string;
  backgroundColor?: string;
  height?: number;
  /** Corner radius of the track and fill; pass a large value for a pill bar. */
  borderRadius?: number;
  style?: ViewStyle;
  labelStyle?: StyleProp<TextStyle>;
};

export function ProgressBar({
  progress,
  total,
  current,
  showLabel = false,
  label,
  showPercentage = false,
  color = colors.primaryColor,
  backgroundColor = colors.COLOR_BLACK_LIGHT_6,
  height = 8,
  borderRadius = DEFAULT_BAR_RADIUS,
  style,
  labelStyle,
}: ProgressBarProps) {
  // Ensure progress is between 0 and 1
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Calculate percentage for display
  const percentage = Math.round(clampedProgress * 100);

  // Generate label text
  const getLabelText = () => {
    if (label) return label;
    if (total && current !== undefined) return `${current}/${total}`;
    if (showPercentage) return `${percentage}%`;
    return '';
  };

  return (
    <View style={[styles.container, style]}>
      {showLabel && getLabelText() && (
        <View style={styles.labelContainer}>
          <Text style={[styles.label, labelStyle]}>{getLabelText()}</Text>
          {showPercentage && <Text style={[styles.percentage, labelStyle]}>{percentage}%</Text>}
        </View>
      )}

      <View style={[styles.progressContainer, { height, backgroundColor, borderRadius }]}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${clampedProgress * 100}%`,
              backgroundColor: color,
              borderRadius,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  labelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    color: colors.primaryDark,
    fontWeight: '500',
  },
  percentage: {
    fontSize: 14,
    color: colors.primaryDark_1,
    fontWeight: '500',
  },
  progressContainer: {
    width: '100%',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
});
