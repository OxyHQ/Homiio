import React from 'react'
import { View } from 'react-native'
import { ThemedText } from '../ThemedText';

export default function QRcode() {
    return (
        false ? null : (
            <View className="fixed right-2 bottom-2 lg:right-10 lg:bottom-10 flex flex-col justify-center items-center gap-5 z-50  scale-75 lg:scale-100">
                <ThemedText className="text-[#777777] text-[13px] tracking-wide">Scan to get the code</ThemedText>
                <View className="hover:scale-105 transform active:scale-95 transition-transform select-none">

                </View>
            </View>
        )
    );
}