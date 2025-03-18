import React from 'react';
import { View } from 'react-native';
import { LogoIcon } from '@/assets/logo';
import { colors } from '@/styles/colors';

const WebSplashScreen = () => {
    return (
        <View className="flex-1 items-center justify-center bg-primary-light dark:bg-primary-dark">
            <LogoIcon size={80} color={colors.primaryColor} />
        </View>
    );
};

export default WebSplashScreen;
