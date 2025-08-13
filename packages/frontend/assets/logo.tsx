import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { ViewStyle } from 'react-native';
import { colors } from '@/styles/colors';

export const LogoIcon = ({
  color = colors.primaryColor,
  size = 26,
  style,
}: {
  color?: string;
  size?: number;
  style?: ViewStyle;
}) => {
  return (
    <Svg viewBox="0 0 388.03 512" width={size} height={size} style={style}>
      <Path
        fill={color}
        d="M388.03 512H170.88L168.64 509.76V364.25H85.07V509.76L82.83 512H0V105.31L276.91 0L281.41 1.51L388.03 109.79V512Z"
      />
    </Svg>
  );
};
