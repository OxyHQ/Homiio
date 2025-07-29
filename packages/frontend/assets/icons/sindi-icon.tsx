import React from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { IconProps } from './types';
import { colors } from '@/styles/colors';

export const SindiIcon: React.FC<IconProps> = ({
    size = 24,
    color = '#5baaff'
}) => {
    return (
        <View style={{ width: size, height: size }}>
            <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
                {/* Outer circle outline */}
                <Path
                    d="M19.1105 4.95984C15.2005 1.04984 8.85045 1.04984 4.94045 4.95984C0.960454 8.93984 1.03045 15.4298 5.14045 19.3298C8.94045 22.9198 15.1005 22.9198 18.9005 19.3298C23.0205 15.4298 23.0905 8.93984 19.1105 4.95984Z"
                    stroke={color}
                    strokeWidth="2"
                    fill="none"
                />
                {/* Inner smile outline */}
                <Path
                    d="M16.3805 16.6498C15.1805 17.7898 13.6005 18.3598 12.0205 18.3598C10.4405 18.3598 8.86045 17.7898 7.66045 16.6498C7.36045 16.3598 7.35045 15.8898 7.63045 15.5898C7.92045 15.2898 8.39045 15.2798 8.69045 15.5598C10.5205 17.2898 13.5105 17.2998 15.3505 15.5598C15.6505 15.2798 16.1305 15.2898 16.4105 15.5898C16.7005 15.8898 16.6805 16.3598 16.3805 16.6498Z"
                    stroke={color}
                    fill={color}
                />
            </Svg>
        </View>
    );
};

export const SindiIconActive = ({ color = colors.primaryColor, size = 26, style }: { color?: string; size?: number; style?: ViewStyle }) => {
    return (
        <View style={{ width: size, height: size }}>
            <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
                <Path
                    d="M19.1105 4.95984C15.2005 1.04984 8.85045 1.04984 4.94045 4.95984C0.960454 8.93984 1.03045 15.4298 5.14045 19.3298C8.94045 22.9198 15.1005 22.9198 18.9005 19.3298C23.0205 15.4298 23.0905 8.93984 19.1105 4.95984ZM16.3805 16.6498C15.1805 17.7898 13.6005 18.3598 12.0205 18.3598C10.4405 18.3598 8.86045 17.7898 7.66045 16.6498C7.36045 16.3598 7.35045 15.8898 7.63045 15.5898C7.92045 15.2898 8.39045 15.2798 8.69045 15.5598C10.5205 17.2898 13.5105 17.2998 15.3505 15.5598C15.6505 15.2798 16.1305 15.2898 16.4105 15.5898C16.7005 15.8898 16.6805 16.3598 16.3805 16.6498Z"
                    fill={color}
                />
            </Svg>
        </View>
    );
};