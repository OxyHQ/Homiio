import React from 'react';
import { BottomSheetBackgroundProps } from '@gorhom/bottom-sheet';
import Animated from 'react-native-reanimated';

const CustomBackground: React.FC<BottomSheetBackgroundProps> = ({ style, animatedIndex }) => {
  return <Animated.View style={{ backgroundColor: 'red', pointerEvents: 'none' }} />;
};

export default CustomBackground;
