import React, { useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Carousel, CarouselItem } from '@oxy.so/bloom/carousel';
import { IconCircle } from '@oxy.so/bloom/icon-circle';
import { RiChatSmile2Line, RiFileTextLine, RiShieldCheckLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';

interface SindiExplanationBottomSheetProps {
  onClose: () => void;
}

interface Slide {
  title: string;
  description: string;
  image?: ImageSourcePropType;
}

/** The story, one slide each. The fourth ("How it works") draws its own steps. */
const SLIDES: readonly Slide[] = [
  {
    title: 'Hi, welcome to Sindi!',
    description: 'Sindi is your AI ally for tenant rights.',
    image: require('@/assets/images/illustrations/welcome.png'),
  },
  {
    title: 'Renting can feel unfair.',
    description: 'Hidden clauses, confusing contracts, landlords with tricks…',
    image: require('@/assets/images/illustrations/sign-contract.png'),
  },
  {
    title: 'We’ve got your back.',
    description: 'We scan your contract, explain your rights, and spot abuses.',
    image: require('@/assets/images/illustrations/relax.png'),
  },
  {
    title: 'How it works',
    description: '',
  },
  {
    title: 'Ready to stand stronger?',
    description: 'Start your first conversation with Sindi.',
  },
];

const HOW_IT_WORKS = [
  { icon: RiFileTextLine, label: 'Upload contract' },
  { icon: RiChatSmile2Line, label: 'Sindi explains' },
  { icon: RiShieldCheckLine, label: 'You act' },
] as const;

const LAST_SLIDE = SLIDES.length - 1;

/**
 * "Learn how Sindi works": a five-slide story in a Bloom `Carousel` (swipe,
 * snap, prev/next arrows and position dots), with Skip until the last slide
 * and a Start call to action on it.
 */
export function SindiExplanationBottomSheet({ onClose }: SindiExplanationBottomSheetProps) {
  const { colors } = useTheme();
  const [index, setIndex] = useState(0);
  const onLastSlide = index === LAST_SLIDE;

  return (
    <View style={styles.container}>
      <Carousel
        accessibilityLabel="How Sindi works"
        align="center"
        onIndexChange={setIndex}
        previousLabel="Previous"
        nextLabel="Next"
      >
        {SLIDES.map((slide, slideIndex) => (
          <CarouselItem key={slide.title}>
            <View style={styles.slide}>
              {slide.image ? (
                <Image source={slide.image} style={styles.image} resizeMode="contain" />
              ) : null}
              <Text
                variant={slideIndex === 0 ? 'title-1-bold' : 'title-2-bold'}
                style={[styles.center, { color: colors.text }]}
              >
                {slide.title}
              </Text>
              {slide.description ? (
                <Text variant="body-regular" style={[styles.center, { color: colors.textSecondary }]}>
                  {slide.description}
                </Text>
              ) : null}
              {slideIndex === 3 ? (
                <View style={styles.steps}>
                  {HOW_IT_WORKS.map(({ icon, label }) => (
                    <View key={label} style={styles.step}>
                      <IconCircle icon={icon} size="lg" />
                      <Text variant="body-2-medium" style={[styles.center, { color: colors.text }]}>
                        {label}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </CarouselItem>
        ))}
      </Carousel>

      <Button variant={onLastSlide ? 'primary' : 'ghost'} onPress={onClose} fullWidth>
        {onLastSlide ? 'Start with Sindi' : 'Skip'}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 280,
    paddingHorizontal: 8,
  },
  image: {
    width: '100%',
    height: 150,
  },
  center: {
    textAlign: 'center',
  },
  steps: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  step: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
});
