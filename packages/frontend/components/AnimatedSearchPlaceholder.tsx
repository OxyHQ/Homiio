import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, View, TextStyle } from "react-native";
import { useTranslation } from "react-i18next";

interface AnimatedSearchPlaceholderProps {
    style?: TextStyle;
    holdMs?: number;
    slideMs?: number;
    lineHeightFallback?: number; // used if style.lineHeight is not set
}

export const AnimatedSearchPlaceholder: React.FC<AnimatedSearchPlaceholderProps> = ({
    style,
    holdMs = 3000,
    slideMs = 600,
    lineHeightFallback = 24,
}) => {
    const { t } = useTranslation();

    const suggestions = useMemo(
        () => [
            t("search.placeholder.suggestion1"),
            t("search.placeholder.suggestion2"),
            t("search.placeholder.suggestion3"),
            t("search.placeholder.suggestion4"),
        ],
        [t]
    );

    const [i, setI] = useState(0);
    const next = (i + 1) % suggestions.length;

    // 0 = current fully visible, 1 = next fully visible
    const progress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        let mounted = true;
        const loop = () => {
            progress.setValue(0);
            Animated.sequence([
                Animated.delay(holdMs),
                Animated.timing(progress, {
                    toValue: 1,
                    duration: slideMs,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                if (!mounted) return;
                setI((v) => (v + 1) % suggestions.length);
                loop();
            });
        };
        loop();
        return () => {
            mounted = false;
            progress.stopAnimation();
        };
    }, [holdMs, slideMs, progress, suggestions.length]);

    // Clamp everything so there’s never a tiny “see-through” frame.
    const curOpacity = progress.interpolate({
        inputRange: [0, 0.99, 1],
        outputRange: [1, 0, 0],
        extrapolate: "clamp",
    });
    const nxtOpacity = progress.interpolate({
        inputRange: [0, 0.01, 1],
        outputRange: [0, 1, 1],
        extrapolate: "clamp",
    });

    const curY = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -20],
        extrapolate: "clamp",
    });
    const nxtY = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [20, 0],
        extrapolate: "clamp",
    });

    const oneLineHeight =
        (typeof style?.lineHeight === "number" ? style?.lineHeight : undefined) ??
        lineHeightFallback;

    return (
        <View
            style={{
                height: oneLineHeight,
                justifyContent: "center",
                overflow: "hidden",
            }}
        >
            <Animated.Text
                key={`cur-${i}`}
                numberOfLines={1}
                style={[
                    style,
                    {
                        position: "absolute",
                        width: "100%",
                        opacity: curOpacity,
                        transform: [{ translateY: curY }],
                        includeFontPadding: false,
                    },
                ]}
            >
                {suggestions[i]}
            </Animated.Text>

            <Animated.Text
                key={`next-${next}`}
                numberOfLines={1}
                style={[
                    style,
                    {
                        position: "absolute",
                        width: "100%",
                        opacity: nxtOpacity,
                        transform: [{ translateY: nxtY }],
                        includeFontPadding: false,
                    },
                ]}
            >
                {suggestions[next]}
            </Animated.Text>
        </View>
    );
};
