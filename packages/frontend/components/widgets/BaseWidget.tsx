import React, { ReactNode } from 'react';
import { View } from 'react-native';

import { Text as BloomText } from '@oxyhq/bloom/typography';

type BaseWidgetProps = {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
};

/**
 * Flat section shell for the right-rail widgets — the rail reads as ONE
 * continuous panel, so this primitive adds NO card chrome: no border, no
 * rounded box, no shadow, no filled surface. Content sits directly on the
 * rail background (WidgetManager + RightBar own the gap rhythm between widgets).
 *
 * Horizontal inset lives on `RightBar` (`px-4`) only — same as Mention — so
 * widgets do not add a second gutter.
 */
export function BaseWidget({ title, icon, children }: BaseWidgetProps) {
  return (
    <View className="pointer-events-auto gap-2">
      {title && (
        <View className="flex-row items-center justify-between gap-4">
          <BloomText
            className="shrink text-xl font-bold text-foreground"
            style={{ letterSpacing: -0.2 }}
          >
            {title}
          </BloomText>
          {icon ? <View className="shrink-0">{icon}</View> : null}
        </View>
      )}
      {children}
    </View>
  );
}
