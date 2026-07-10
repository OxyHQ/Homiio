import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';

type TrustLevelKey = 'excellent' | 'good' | 'average' | 'fair' | 'needsImprovement';

function trustLevelKey(score: number): TrustLevelKey {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'average';
  if (score >= 30) return 'fair';
  return 'needsImprovement';
}

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
  const { t } = useTranslation();

  const { color, levelKey, sizeStyle } = useMemo(() => {
    const getColor = (value: number) => {
      if (value >= 90) return colors.success;
      if (value >= 70) return colors.success;
      if (value >= 50) return colors.warning;
      if (value >= 30) return colors.warning;
      return colors.danger;
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
      levelKey: trustLevelKey(score),
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
        <Text style={[styles.label, { fontSize: sizeStyle.labelSize, color }]}>
          {t(`trust.score.levels.${levelKey}`)}
        </Text>
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
    color: colors.white,
    fontWeight: 'bold',
  },
  label: {
    fontWeight: '600',
    marginTop: 4,
  },
});
