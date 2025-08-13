import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

type TrustScoreCompactProps = {
  score: number;
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
  showPercentage?: boolean;
};

export function TrustScoreCompact({
  score,
  size = 'medium',
  showLabel = true,
  showPercentage = false,
}: TrustScoreCompactProps) {
  // Memoize expensive calculations
  const { color, trustLevel, sizeStyle } = useMemo(() => {
    const getColor = (score: number) => {
      if (score >= 90) return '#4CAF50';
      if (score >= 70) return '#8BC34A';
      if (score >= 50) return '#FFC107';
      if (score >= 30) return '#FF9800';
      return '#F44336';
    };

    const getTrustLevel = (score: number) => {
      if (score >= 90) return 'Excellent';
      if (score >= 70) return 'Good';
      if (score >= 50) return 'Average';
      if (score >= 30) return 'Fair';
      return 'Needs Improvement';
    };

    const sizeStyles = {
      small: {
        container: { height: 24, width: 24 },
        innerCircle: { height: 20, width: 20 },
        fontSize: 10,
        labelSize: 10,
      },
      medium: {
        container: { height: 32, width: 32 },
        innerCircle: { height: 26, width: 26 },
        fontSize: 14,
        labelSize: 12,
      },
      large: {
        container: { height: 48, width: 48 },
        innerCircle: { height: 40, width: 40 },
        fontSize: 20,
        labelSize: 14,
      },
    };

    return {
      color: getColor(score),
      trustLevel: getTrustLevel(score),
      sizeStyle: sizeStyles[size],
    };
  }, [score, size]);

  return (
    <View style={styles.wrapper}>
      <View style={[styles.container, sizeStyle.container, { borderColor: color }]}>
        <View style={[styles.innerCircle, sizeStyle.innerCircle, { backgroundColor: color }]}>
          <Text style={[styles.scoreText, { fontSize: sizeStyle.fontSize }]}>
            {showPercentage ? `${score}%` : score}
          </Text>
        </View>
      </View>
      {showLabel && (
        <Text style={[styles.label, { fontSize: sizeStyle.labelSize, color }]}>{trustLevel}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  container: {
    borderWidth: 2,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerCircle: {
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreText: {
    color: 'white',
    fontWeight: 'bold',
  },
  label: {
    fontWeight: '600',
    marginTop: 4,
  },
});
